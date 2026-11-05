import Dexie, { type Table } from 'dexie'
import { FinancialDatabase } from '../database'
import { createLocalRepositories } from '../repositories'
import { validateBackup, type Backup } from '@/domain/backup'
import type { CivilDate } from '@/domain/models'
import { decodeRemoteBackup, type RemoteEntity } from '../supabase/mapping'
import {
  canonicalJson,
  confirmImportPreview,
  entities,
  reconciliationManifest,
  sha256,
  type ImportPlan,
  prepareInitialImport,
} from './protocol'
import { applyDelta, diffData, wireData, type WireData } from './incremental'
import type { SyncState } from './state'
import type { FinancialRepositories } from '@/domain/repositories'

export interface QueuedOperation {
  id: string
  userId: string
  type: string
  kind: 'changes' | 'initial-import'
  payloadText: string
  expectedRevision: number
  createdAt: string
  idempotencyKey: string
  state: 'pending' | 'sending' | 'conflict' | 'error' | 'confirmed' | 'archived'
  attempts: number
  nextAttempt: number
  leaseUntil: number
  leaseOwner?: string
  manifestHash: string
  sequence: number
  lastError?: string
}
interface Head {
  id: string
  userId: string
  revision: number
  data: WireData
  lastCompletedAt: string | null
  lastServerCommittedAt?: string | null
  verificationError?: string
  connectionError?: string
  importStaged?: boolean
}
interface Resolution {
  id: string
  userId: string
  at: string
  operationIds: string[]
  localBackup: Backup
  choice: 'server'
}
/** Separate, opt-in laboratory namespace. Never upgrades an application/user database. */
export class SyncLabDatabase extends FinancialDatabase {
  outbox!: Table<QueuedOperation, string>
  syncHead!: Table<Head, string>
  syncResolutions!: Table<Resolution, string>
  constructor(name: string) {
    if (
      !name.startsWith('money-saver-sync-lab:') &&
      !/^money-saver-sync-remote:https%3A%2F%2Fiwzmsbkbuerleocismhj\.supabase\.co:[0-9a-f-]{36}$/.test(
        name,
      )
    )
      throw new Error('Use um banco isolado de homologação.')
    super(name)
    this.version(5).stores({
      outbox: 'id,userId,sequence,state',
      syncHead: 'id',
      syncResolutions: 'id,userId',
    })
  }
}
async function backupOf(db: FinancialDatabase): Promise<Backup> {
  const rows = await Promise.all(entities.map((e) => db.table(e).toArray()))
  return validateBackup({
    app: 'money-saver',
    version: 2,
    schemaVersion: 4,
    exportedAt: new Date().toISOString(),
    data: Object.fromEntries(entities.map((e, i) => [e, rows[i]])),
  })
}
export interface SessionIdentity {
  userId: string
  accessToken: string
}
export interface Receipt {
  operationId: string
  revision: number
  payloadHash: string
  reconciliationHash: string
  committedAt?: string
}
export class SyncIntegrityError extends Error {}
export interface FeedEvent {
  revision: number
  entity: RemoteEntity
  id: string
  row_data: Record<string, unknown> | null
}
export interface SyncTransport {
  send(operation: QueuedOperation, token: string, signal: AbortSignal): Promise<Receipt>
  view(token: string, signal: AbortSignal): Promise<{ revision: number; data: WireData }>
  page(
    cursor: Record<string, unknown>,
    token: string,
    signal: AbortSignal,
  ): Promise<{ until: number; events: FeedEvent[] }>
}
export class TransportError extends Error {
  constructor(
    public status: number,
    public serverCode?: string,
  ) {
    super(`HTTP ${status}${serverCode ? ': ' + serverCode : ''}`)
  }
}
export function localWorkerTransport(baseUrl: string): SyncTransport {
  if (!/^http:\/\/127\.0\.0\.1:\d+(?:\/sync-api)?$/.test(baseUrl))
    throw new Error('Somente Worker local nesta fase.')
  return workerTransport(baseUrl)
}
/** Remote caller must first validate its deployment configuration and explicit opt-in. */
export function workerTransport(baseUrl: string): SyncTransport {
  async function call(path: string, body: unknown, token: string, signal: AbortSignal) {
    const response = await fetch(baseUrl + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
      redirect: 'error',
    })
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      const code =
        typeof body?.error?.code === 'string' && /^[A-Z0-9_]{1,100}$/.test(body.error.code)
          ? body.error.code
          : undefined
      throw new TransportError(response.status, code)
    }
    return (await response.json()).data
  }
  return {
    send: (op, token, signal) =>
      call(
        '/operations',
        {
          operationId: op.id,
          expectedRevision: op.expectedRevision,
          payloadText: op.payloadText,
          kind: op.kind,
        },
        token,
        signal,
      ),
    view: (token, signal) => call('/view', undefined, token, signal),
    page: (cursor, token, signal) => call('/changes', cursor, token, signal),
  }
}
export class SyncClient {
  readonly repositories: FinancialRepositories
  private readonly localRepositories: FinancialRepositories
  private controller = new AbortController()
  private readonly workerId = crypto.randomUUID()
  private stopped = false
  private offline = false
  private running = false
  private tickBusy = false
  private stoppedToken: string | undefined
  private wakeScheduled: (() => void) | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  constructor(
    readonly db: SyncLabDatabase,
    readonly userId: string,
    private transport: SyncTransport,
    private session: () => SessionIdentity | null,
    private asOf: CivilDate,
    private clock = () => Date.now(),
    readonly projectUrl = 'http://127.0.0.1:54321',
  ) {
    this.localRepositories = createLocalRepositories(db)
    const commands: Record<string, readonly string[]> = {
      accounts: ['create', 'update', 'remove'],
      categories: ['create', 'update', 'archive'],
      movements: ['create', 'update', 'remove', 'settle'],
      settings: ['setCreditRegime'],
      planning: ['saveRecurring', 'status', 'realize', 'saveBudget', 'removeBudget'],
      credit: [
        'createCard',
        'updateCard',
        'archiveCard',
        'createPurchase',
        'updatePurchase',
        'cancelPurchase',
        'refundPurchase',
        'pay',
        'correctPayment',
        'reversePayment',
        'addCharge',
        'applyCredit',
        'reverseCharge',
      ],
    }
    this.repositories = new Proxy(this.localRepositories, {
      get: (repositories, key: keyof FinancialRepositories) => {
        const group = repositories[key]
        if (typeof group === 'function')
          return async (...args: unknown[]) => {
            await this.head()
            return Reflect.apply(group, repositories, args)
          }
        if (typeof group !== 'object') return group
        return new Proxy(group, {
          get: (target, method: string) => {
            const fn: unknown = Reflect.get(target, method)
            if (typeof fn !== 'function') return fn
            return commands[key]?.includes(method)
              ? (...args: unknown[]) =>
                  this.mutate(`${key}.${method}`, async () => Reflect.apply(fn, target, args))
              : ['list', 'get', 'export'].includes(method)
                ? async (...args: unknown[]) => {
                    await this.head()
                    return Reflect.apply(fn, target, args)
                  }
                : fn.bind(target)
          },
        })
      },
    })
  }
  /** Call on logout/account change from the existing Auth observer. Never clears data. */
  stop(expiredToken = this.session()?.accessToken) {
    this.stoppedToken = expiredToken
    this.stopped = true
    this.controller.abort()
    clearTimeout(this.timer)
    this.wakeScheduled = undefined
  }
  wake() {
    this.wakeScheduled?.()
  }
  /** Only a new token from the existing verified Auth observer can resume a 401-paused client. */
  resumeAfterTokenRefresh() {
    const identity = this.session()
    if (
      !this.stopped ||
      !identity ||
      identity.userId !== this.userId ||
      identity.accessToken === this.stoppedToken
    )
      return
    this.controller = new AbortController()
    this.stopped = false
    this.running = false
    this.start()
  }
  /** Explicit opt-in only; the production application never calls this scheduler. */
  start() {
    this.identity()
    if (this.running) return
    this.running = true
    const tick = async () => {
      if (this.tickBusy || this.stopped) return
      clearTimeout(this.timer)
      this.tickBusy = true
      try {
        this.identity()
        await this.drain()
        if (!(await this.pending()).length) await this.pull()
      } catch (error) {
        if (error instanceof TransportError && error.status === 401) {
          if (!this.stopped) this.stop()
          this.resumeAfterTokenRefresh()
        } else {
          this.offline = !(error instanceof TransportError) || error.status >= 500
        }
      } finally {
        this.tickBusy = false
      }
      if (!this.stopped)
        this.timer = setTimeout(() => {
          void tick()
        }, 3000)
    }
    this.wakeScheduled = () => {
      void tick()
    }
    this.wake()
  }
  private identity() {
    const identity = this.session()
    if (this.stopped || !identity || identity.userId !== this.userId) throw new TransportError(401)
    return identity
  }
  private async head() {
    const head = await this.db.syncHead.get('head')
    if (!head || head.userId !== this.userId)
      throw new Error('Espaço não inicializado para este usuário.')
    return head
  }
  /** Pull is allowed only into a fresh, explicitly isolated lab dataset. */
  async bootstrap() {
    const identity = this.identity()
    if (await this.db.syncHead.count()) {
      await this.head()
      return
    }
    const local = await backupOf(this.db)
    if (entities.some((e) => e !== 'categories' && local.data[e].length))
      throw new Error('Importação explícita necessária; não substituir dados locais.')
    const remote = await this.transport.view(identity.accessToken, this.controller.signal)
    this.identity()
    await this.db.transaction('rw', this.db.tables, async () => {
      this.identity()
      if (await this.db.syncHead.count()) {
        await this.head()
        return
      }
      const current = await backupOf(this.db)
      if (entities.some((e) => e !== 'categories' && current.data[e].length))
        throw new Error('Dados locais mudaram; importação explícita necessária.')
      await this.install(remote.data, remote.revision)
    })
    this.offline = false
  }
  async importInitial(plan: ImportPlan, confirmation: string, savedBackupHash: string) {
    const identity = this.identity()
    if (
      plan.userId !== this.userId ||
      plan.projectUrl !== this.projectUrl ||
      plan.localDatabase !== this.db.name
    )
      throw new Error('Prévia fora da homologação local.')
    const remote = await this.transport.view(identity.accessToken, this.controller.signal)
    if (remote.revision !== 0 || entities.some((e) => remote.data[e].length))
      throw new Error('Destino não vazio.')
    await this.db.transaction('rw', this.db.tables, async () => {
      const currentBackup = await backupOf(this.db)
      await Dexie.waitFor(
        confirmImportPreview(plan, {
          confirmation,
          savedBackupHash,
          currentBackup,
          userId: this.userId,
          projectUrl: plan.projectUrl,
        }),
      )
      this.identity()
      const previousHead = await this.db.syncHead.get('head')
      if (
        (previousHead &&
          (previousHead.userId !== this.userId ||
            previousHead.revision !== 0 ||
            entities.some((e) => previousHead.data[e].length))) ||
        (await this.db.outbox.count())
      )
        throw new Error('Importação já preparada.')
      await this.db.syncHead.put({
        id: 'head',
        userId: this.userId,
        revision: 0,
        data: remote.data,
        lastCompletedAt: null,
      })
      await this.db.outbox.add({
        id: plan.operationId,
        userId: this.userId,
        kind: 'initial-import',
        type: 'explicit-initial-import',
        payloadText: plan.payloadText,
        expectedRevision: 0,
        createdAt: new Date(this.clock()).toISOString(),
        idempotencyKey: plan.operationId,
        state: 'pending',
        attempts: 0,
        nextAttempt: 0,
        leaseUntil: 0,
        manifestHash: await Dexie.waitFor(sha256(canonicalJson(plan.manifest))),
        sequence: 1,
      })
    })
  }
  async prepareMigration() {
    const identity = this.identity()
    const existing = await this.db.syncHead.get('head')
    if (existing && existing.userId !== this.userId)
      throw new Error('O espaço pertence a outro usuário.')
    if ((await this.pending()).length)
      throw new Error('Resolva a fila antes de preparar a migração.')
    const remote = await this.transport.view(identity.accessToken, this.controller.signal)
    const backup = await this.db.transaction(
      'r',
      entities.map((e) => this.db.table(e)),
      () => backupOf(this.db),
    )
    const plan = await prepareInitialImport({
      operationId: crypto.randomUUID(),
      scope: { userId: this.userId, projectUrl: this.projectUrl },
      localDatabase: this.db.name,
      backup,
      remoteHead: {
        revision: remote.revision,
        counts: Object.fromEntries(entities.map((e) => [e, remote.data[e].length])) as Record<
          RemoteEntity,
          number
        >,
      },
      asOf: this.asOf,
    })
    this.identity()
    return { backup, plan }
  }
  async inspectExternalBackup(value: unknown) {
    const identity = this.identity()
    const backup = validateBackup(value)
    const remote = await this.transport.view(identity.accessToken, this.controller.signal)
    return {
      revision: remote.revision,
      local: await reconciliationManifest(backup, this.asOf),
      remote: await reconciliationManifest(decodeRemoteBackup(remote.data, this.userId), this.asOf),
    }
  }
  /** Explicit file selection only. Original browser datasets are never read or changed. */
  async stageInitialBackup(value: unknown, confirmation: string) {
    if (
      this.projectUrl === 'http://127.0.0.1:54321' ||
      confirmation !== 'PREPARAR IMPORTAÇÃO DE BACKUP'
    )
      throw new Error('Confirmação explícita de preparação obrigatória.')
    const identity = this.identity()
    const backup = validateBackup(value)
    const remote = await this.transport.view(identity.accessToken, this.controller.signal)
    if (remote.revision !== 0 || entities.some((e) => remote.data[e].length))
      throw new Error('Destino não vazio.')
    await prepareInitialImport({
      operationId: crypto.randomUUID(),
      scope: { projectUrl: this.projectUrl, userId: this.userId },
      localDatabase: this.db.name,
      backup,
      asOf: this.asOf,
      remoteHead: {
        revision: remote.revision,
        counts: Object.fromEntries(entities.map((e) => [e, remote.data[e].length])) as Record<
          RemoteEntity,
          number
        >,
      },
    })
    await this.db.transaction('rw', this.db.tables, async () => {
      this.identity()
      const head = await this.head()
      const local = await backupOf(this.db)
      if (
        head.revision !== 0 ||
        entities.some((e) => head.data[e].length || local.data[e].length) ||
        (await this.pending()).length
      )
        throw new Error('A réplica deve estar vazia para preparar importação.')
      for (const e of entities) await this.db.table(e).bulkAdd(backup.data[e])
      await this.db.syncHead.update('head', {
        importStaged: true,
        verificationError:
          'Importação preparada: conclua backup, prévia e confirmação antes de editar.',
        lastCompletedAt: null,
      })
    })
  }
  private async install(data: WireData, revision: number, committedAt?: string) {
    const backup = decodeRemoteBackup(data, this.userId)
    await this.db.transaction('rw', this.db.tables, async () => {
      const previous = await this.db.syncHead.get('head')
      for (const entity of entities) {
        await this.db.table(entity).clear()
        await this.db.table(entity).bulkAdd(backup.data[entity])
      }
      await this.db.syncHead.put({
        id: 'head',
        userId: this.userId,
        revision,
        data,
        lastCompletedAt: new Date(this.clock()).toISOString(),
        lastServerCommittedAt: committedAt ?? previous?.lastServerCommittedAt ?? null,
        verificationError: '',
        connectionError: '',
      })
    })
  }
  /** Existing repository commands execute inside the same IDB transaction as their outbox entry. */
  async mutate<T>(
    type: string,
    command: (repositories: typeof this.repositories) => Promise<T>,
  ): Promise<T> {
    this.identity()
    return this.db.transaction('rw', this.db.tables, async () => {
      const head = await this.head()
      if (head.verificationError)
        throw new SyncIntegrityError(
          'Confirme a integridade remota antes de registrar novas operações sincronizadas.',
        )
      const before = await backupOf(this.db)
      const result = await command(this.localRepositories)
      const after = await backupOf(this.db)
      const delta = diffData(wireData(before, this.userId), wireData(after, this.userId), this.asOf)
      applyDelta(wireData(before, this.userId), delta, this.userId)
      const pending = await this.pending()
      const sequence = Math.max(head.revision, ...pending.map((o) => o.sequence)) + 1
      const manifest = await Dexie.waitFor(reconciliationManifest(after, this.asOf))
      const manifestHash = await Dexie.waitFor(sha256(canonicalJson(manifest)))
      const id = crypto.randomUUID()
      this.identity()
      await this.db.outbox.add({
        id,
        userId: this.userId,
        type,
        kind: 'changes',
        payloadText: canonicalJson(delta),
        expectedRevision: sequence - 1,
        createdAt: new Date(this.clock()).toISOString(),
        idempotencyKey: id,
        state: 'pending',
        attempts: 0,
        nextAttempt: 0,
        leaseUntil: 0,
        manifestHash,
        sequence,
      })
      return result
    })
  }
  async pending() {
    return (await this.db.outbox.where('userId').equals(this.userId).sortBy('sequence')).filter(
      (o) => !['confirmed', 'archived'].includes(o.state),
    )
  }
  async retryRejected(operationId: string, confirmation: string) {
    this.identity()
    if (confirmation !== 'REPETIR OPERAÇÃO VALIDADA')
      throw new Error('Confirmação explícita obrigatória.')
    await this.db.transaction('rw', this.db.outbox, async () => {
      const op = (await this.pending())[0]
      if (!op || op.id !== operationId || op.state !== 'error')
        throw new Error(
          'Somente a primeira operação rejeitada pode ser repetida. Conflitos exigem resolução.',
        )
      await this.db.outbox.update(op.id, { state: 'pending', nextAttempt: 0, leaseUntil: 0 })
    })
  }
  private async claim() {
    return this.db.transaction('rw', this.db.outbox, async () => {
      const op = (await this.pending())[0]
      if (
        !op ||
        ['conflict', 'error'].includes(op.state) ||
        op.nextAttempt > this.clock() ||
        op.leaseUntil > this.clock()
      )
        return null
      await this.db.outbox.update(op.id, {
        state: 'sending',
        leaseUntil: this.clock() + 60000,
        leaseOwner: this.workerId,
        attempts: op.attempts + 1,
      })
      return op
    })
  }
  private async readChanges(head: Head, token: string, until?: number) {
    const data = structuredClone(head.data)
    let watermark = until
    let cursor: Record<string, unknown> = {
      p_after: head.revision,
      p_until: until ?? null,
      p_limit: 100,
    }
    for (let pages = 0; pages < 1000; pages++) {
      const page = await this.transport.page(cursor, token, this.controller.signal)
      this.identity()
      if (watermark !== undefined && page.until !== watermark)
        throw new SyncIntegrityError('Cursor divergente. Dados locais preservados.')
      watermark = page.until
      for (const event of page.events) {
        if (
          !entities.includes(event.entity) ||
          event.revision <= head.revision ||
          event.revision > watermark
        )
          throw new SyncIntegrityError('Evento inválido. Dados locais preservados.')
        data[event.entity] = data[event.entity].filter((r) => r.id !== event.id)
        if (event.row_data) data[event.entity].push(event.row_data)
      }
      if (page.events.length < 100) {
        try {
          decodeRemoteBackup(data, this.userId)
        } catch {
          throw new SyncIntegrityError('Conjunto remoto inconsistente. Dados locais preservados.')
        }
        return { data, revision: watermark }
      }
      const last = page.events.at(-1)!
      cursor = {
        ...cursor,
        p_until: watermark,
        p_revision: last.revision,
        p_entity: last.entity,
        p_id: last.id,
      }
    }
    throw new SyncIntegrityError('Limite de páginas; nenhum dado parcial foi aplicado.')
  }
  async flush() {
    const identity = this.identity()
    await this.head()
    const op = await this.claim()
    if (!op) return
    try {
      const receipt = await this.transport.send(op, identity.accessToken, this.controller.signal)
      this.offline = false
      this.identity()
      if (
        receipt.operationId !== op.id ||
        receipt.revision !== op.expectedRevision + 1 ||
        receipt.payloadHash !== (await sha256(op.payloadText)) ||
        receipt.reconciliationHash !== op.manifestHash
      )
        throw new SyncIntegrityError('Recibo divergente. Operação preservada para revisão.')
      const remote = await this.readChanges(
        await this.head(),
        identity.accessToken,
        receipt.revision,
      )
      const manifest = await reconciliationManifest(
        decodeRemoteBackup(remote.data, this.userId),
        JSON.parse(op.payloadText).asOf as CivilDate,
      )
      if ((await sha256(canonicalJson(manifest))) !== op.manifestHash)
        throw new SyncIntegrityError('Reconciliação divergente. Operação preservada para revisão.')
      await this.db.transaction('rw', this.db.tables, async () => {
        this.identity()
        const current = await this.db.outbox.get(op.id)
        if (current?.leaseOwner !== this.workerId)
          throw new Error('Lease perdida; confirmação adiada.')
        await this.db.outbox.update(op.id, { state: 'confirmed', leaseUntil: 0, lastError: '' })
        if (!(await this.pending()).length)
          await this.install(remote.data, remote.revision, receipt.committedAt)
        else
          await this.db.syncHead.put({
            id: 'head',
            userId: this.userId,
            ...remote,
            lastCompletedAt: null,
            lastServerCommittedAt: receipt.committedAt ?? null,
          })
      })
    } catch (error) {
      const status = error instanceof TransportError ? error.status : 0
      const integrity = error instanceof SyncIntegrityError
      this.offline = !integrity && (status === 0 || status >= 500)
      const lastError = integrity
        ? error.message
        : status === 409
          ? 'A revisão remota mudou. Preserve a fila e resolva o conflito explicitamente.'
          : status === 401
            ? 'Sessão inválida ou expirada. Envio interrompido; dados preservados.'
            : [400, 413, 422].includes(status)
              ? 'Servidor rejeitou a operação. Revise os dados antes de repetir.'
              : 'Conexão interrompida ou resposta desconhecida. Será repetido o mesmo identificador.'
      await this.db.transaction('rw', [this.db.outbox, this.db.syncHead], async () => {
        if ((await this.db.outbox.get(op.id))?.leaseOwner !== this.workerId) return
        await this.db.outbox.update(op.id, {
          state:
            status === 409
              ? 'conflict'
              : integrity || [400, 413, 422].includes(status)
                ? 'error'
                : 'pending',
          lastError,
          leaseUntil: 0,
          nextAttempt: this.clock() + Math.min(30000, 1000 * 2 ** Math.min(op.attempts, 5)),
        })
        if (!integrity && (status === 0 || status >= 500 || status === 401))
          await this.db.syncHead.update('head', { connectionError: lastError })
      })
      if (status === 401) this.stop(identity.accessToken)
      throw error
    }
  }
  async pull() {
    const identity = this.identity()
    if ((await this.pending()).length)
      throw new Error('Resolva a fila antes de aplicar dados remotos.')
    const head = await this.head()
    if (head.importStaged)
      throw new Error('Importação preparada: leitura remota suspensa até confirmação explícita.')
    let remote: Awaited<ReturnType<SyncClient['readChanges']>>
    try {
      remote = await this.readChanges(head, identity.accessToken)
    } catch (error) {
      if (error instanceof SyncIntegrityError)
        await this.db.syncHead.update('head', { verificationError: error.message })
      if (error instanceof TransportError && error.status === 401) this.stop(identity.accessToken)
      this.offline =
        error instanceof TypeError || (error instanceof TransportError && error.status >= 500)
      if (this.offline || (error instanceof TransportError && error.status === 401))
        await this.db.syncHead.update('head', {
          connectionError:
            'Conexão ou sessão indisponível. A réplica local e as operações foram preservadas.',
        })
      throw error
    }
    await this.db.transaction('rw', this.db.tables, async () => {
      this.identity()
      if (
        (await this.pending()).length ||
        (await this.head()).revision !== head.revision ||
        (await this.head()).importStaged
      )
        throw new Error('Estado local mudou durante a leitura.')
      await this.install(remote.data, remote.revision)
    })
    this.offline = false
  }
  /** Explicit server choice preserves the rejected operations and a full recovery backup.
   * The resolution is itself queued as an append-only audit event; no financial replay. */
  async resolveUsingServer(confirmation: string) {
    if (confirmation !== 'USAR VERSÃO DO SERVIDOR')
      throw new Error('Confirmação explícita obrigatória.')
    const identity = this.identity()
    const remote = await this.transport.view(identity.accessToken, this.controller.signal)
    const id = crypto.randomUUID()
    await this.db.transaction('rw', this.db.tables, async () => {
      this.identity()
      const pending = await this.pending()
      if (
        !pending.some((o) => o.state === 'conflict') ||
        pending.some((o) => o.state === 'sending')
      )
        throw new Error('Conflito não disponível para resolução.')
      await this.db.syncResolutions.add({
        id,
        userId: this.userId,
        at: new Date(this.clock()).toISOString(),
        operationIds: pending.map((o) => o.id),
        localBackup: await backupOf(this.db),
        choice: 'server',
      })
      for (const op of pending) await this.db.outbox.update(op.id, { state: 'archived' })
      await this.install(remote.data, remote.revision)
      await this.mutate('conflict-resolution', async () => {
        await this.db.audit.add({
          id,
          entityId: id,
          entityType: 'backup',
          action: 'update',
          at: new Date(this.clock()).toISOString(),
          after: {
            id,
            createdAt: new Date(this.clock()).toISOString(),
            updatedAt: new Date(this.clock()).toISOString(),
            name: JSON.stringify({
              resolution: 'server',
              operations: pending.map((o) => o.id),
              revision: remote.revision,
            }),
          },
        })
      })
    })
  }
  /** Scheduler belongs to the existing session owner; stop() cancels its active request.
   * No automatic scheduler is installed by the application in this phase. */
  async drain(maxOperations = 100) {
    for (let i = 0; i < maxOperations; i++) {
      this.identity()
      const first = (await this.pending())[0]
      if (
        !first ||
        ['conflict', 'error'].includes(first.state) ||
        first.nextAttempt > this.clock() ||
        first.leaseUntil > this.clock()
      )
        return
      await this.flush()
    }
  }
  async status(): Promise<SyncState> {
    const pending = await this.pending()
    const head = await this.db.syncHead.get('head')
    if (head && head.userId !== this.userId) throw new Error('O espaço pertence a outro usuário.')
    return {
      enabled: true,
      operationId: pending[0]?.id ?? null,
      message: this.stopped
        ? 'Sessão encerrada. Fila preservada.'
        : pending[0]?.lastError || head?.verificationError || head?.connectionError || '',
      phase: pending.some((o) => o.state === 'conflict')
        ? 'conflict'
        : pending.some((o) => o.state === 'error') || head?.verificationError
          ? 'error'
          : pending.some((o) => o.state === 'sending' && o.leaseUntil > this.clock())
            ? 'sending'
            : this.offline || head?.connectionError
              ? 'offline'
              : pending.length
                ? 'prepared'
                : head
                  ? 'verified'
                  : 'local',
      pending: pending.length,
      lastCompletedAt: pending.length ? null : (head?.lastCompletedAt ?? null),
      lastServerCommittedAt: head?.lastServerCommittedAt ?? null,
    }
  }
}
