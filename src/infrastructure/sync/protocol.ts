import { validateBackup, type Backup } from '@/domain/backup'
import { balancesAt, monthlySummary } from '@/domain/finance'
import { cardSummary, invoiceSummary } from '@/domain/credit'
import { budgetUsage } from '@/domain/planning'
import { civilDateSchema, today } from '@/domain/financial-validation'
import type { CivilDate } from '@/domain/models'
import { financialDatabaseName, type FinancialScope } from '../financial-scope'
import {
  decodeRemoteBackup,
  remoteFields,
  toRemoteRow,
  type RemoteEntity,
} from '../supabase/mapping'

export const SYNC_ENABLED = false
export const SYNC_PROTOCOL = 1
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024
export const MAX_IMPORT_ROWS = 10_000
export const entities = Object.keys(remoteFields) as RemoteEntity[]
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function requireUuid(value: string) {
  if (!uuid.test(value)) throw new Error('Identificador de operação ou usuário inválido.')
}
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const json = JSON.stringify(value)
    if (json === undefined || (typeof value === 'number' && !Number.isFinite(value)))
      throw new Error('Conteúdo não serializável.')
    return json
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
    .join(',')}}`
}
export async function sha256(text: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
function normalizedBackup(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value)).length
  if (bytes > MAX_IMPORT_BYTES)
    throw new Error('Backup excede 10 MB; importação em partes não está habilitada.')
  const source = value as Backup
  if (
    !source?.data ||
    Object.values(source.data).reduce(
      (n, rows) => n + (Array.isArray(rows) ? rows.length : MAX_IMPORT_ROWS + 1),
      0,
    ) > MAX_IMPORT_ROWS
  )
    throw new Error('Quantidade de registros excede o limite da importação.')
  const backup = validateBackup(value)
  // Normalize UUID spelling and timestamps, without regenerating any identifier.
  const wire = Object.fromEntries(
    entities.map((entity) => [
      entity,
      backup.data[entity].map((row) => {
        const mapped = toRemoteRow(entity, row, '00000000-0000-4000-8000-000000000000')
        for (const key of Object.keys(mapped))
          if (key === 'id' || key.endsWith('_id')) mapped[key] = String(mapped[key]).toLowerCase()
        return mapped
      }),
    ]),
  )
  const normalized = decodeRemoteBackup(wire, '00000000-0000-4000-8000-000000000000')
  for (const entity of entities)
    normalized.data[entity].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return normalized
}
export async function reconciliationManifest(value: unknown, date: CivilDate) {
  const asOf = civilDateSchema.parse(date) as CivilDate
  if (asOf > today()) throw new Error('A data de reconciliação não pode estar no futuro.')
  const { data } = normalizedBackup(value)
  const dates = new Set<string>([asOf])
  const months = new Set<string>([asOf.slice(0, 7)])
  for (const rows of Object.values(data))
    for (const row of rows)
      for (const [key, item] of Object.entries(row)) {
        if (
          (key === 'date' || key.endsWith('Date')) &&
          typeof item === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test(item)
        ) {
          if (item <= asOf) dates.add(item)
          months.add(item.slice(0, 7))
        }
        if ((key === 'period' || key === 'month') && typeof item === 'string') months.add(item)
      }
  if (dates.size > 512 || months.size > 240)
    throw new Error(
      'Histórico excede os limites desta prévia; requer revisão, sem importação parcial.',
    )
  const orderedMonths = [...months].sort()
  return {
    asOf,
    dataHash: await sha256(canonicalJson(data)),
    counts: Object.fromEntries(entities.map((entity) => [entity, data[entity].length])),
    ids: Object.fromEntries(entities.map((entity) => [entity, data[entity].map((row) => row.id)])),
    balances: [...dates]
      .sort()
      .map((date) => ({ date, values: balancesAt(data, date as CivilDate) })),
    invoices: data.invoices.map((invoice) => {
      const s = invoiceSummary(data, invoice, asOf)
      return {
        id: invoice.id,
        original: s.original,
        financedFees: s.financedFees,
        charges: s.charges,
        adjustments: s.adjustments,
        paid: s.paid,
        remaining: s.remaining,
        credit: s.credit,
      }
    }),
    cards: data.cards.map((card) => {
      const s = cardSummary(data, card, asOf)
      return {
        id: card.id,
        used: s.used,
        available: s.available,
        debt: s.debt,
        credit: s.credit,
        committed: s.committed,
      }
    }),
    months: orderedMonths.map((month) => ({
      month,
      regimes: (['purchase', 'installment'] as const).map((regime) => {
        const s = monthlySummary(data, new Date(`${month}-01T12:00:00`), asOf, regime)
        return {
          regime,
          income: s.income,
          expense: s.expense,
          net: s.net,
          categories: s.categories,
        }
      }),
      budgets: budgetUsage(data, month, asOf),
    })),
  }
}
export type Manifest = Awaited<ReturnType<typeof reconciliationManifest>>
export interface RemoteHead {
  revision: number
  counts: Record<RemoteEntity, number>
}
export interface ImportPlan {
  operationId: string
  userId: string
  projectUrl: string
  localDatabase: string
  expectedRevision: 0
  payloadText: string
  payloadHash: string
  backupHash: string
  manifest: Manifest
}
export async function prepareInitialImport(input: {
  operationId: string
  scope: FinancialScope
  localDatabase: string
  backup: unknown
  remoteHead: RemoteHead
  asOf: CivilDate
}): Promise<ImportPlan> {
  requireUuid(input.operationId)
  requireUuid(input.scope.userId)
  if (
    !/^https:\/\/[a-z0-9.-]+\.supabase\.co$/.test(input.scope.projectUrl) &&
    input.scope.projectUrl !== 'http://127.0.0.1:54321'
  )
    throw new Error('Projeto de destino inválido.')
  const isolatedLab =
    input.scope.projectUrl === 'http://127.0.0.1:54321' &&
    input.localDatabase.startsWith(`money-saver-sync-lab:${input.scope.userId}:`)
  const isolatedRemote =
    input.scope.projectUrl === 'https://iwzmsbkbuerleocismhj.supabase.co' &&
    input.localDatabase ===
      `money-saver-sync-remote:${encodeURIComponent(input.scope.projectUrl)}:${input.scope.userId}`
  if (input.localDatabase !== financialDatabaseName(input.scope) && !isolatedLab && !isolatedRemote)
    throw new Error('O espaço local não corresponde ao usuário/projeto selecionado.')
  if (
    input.remoteHead.revision !== 0 ||
    entities.some((entity) => input.remoteHead.counts[entity] !== 0)
  )
    throw new Error(
      'Destino não vazio ou revisão divergente. É necessária resolução explícita de conflito.',
    )
  const backup = normalizedBackup(input.backup)
  if (backup.data.settings.length > 1) throw new Error('Configurações duplicadas.')
  const manifest = await reconciliationManifest(backup, input.asOf)
  const data = Object.fromEntries(
    entities.map((entity) => [
      entity,
      backup.data[entity].map((row) => toRemoteRow(entity, row, input.scope.userId.toLowerCase())),
    ]),
  )
  const payloadText = canonicalJson({ protocol: SYNC_PROTOCOL, asOf: input.asOf, data, manifest })
  if (new TextEncoder().encode(payloadText).length > MAX_IMPORT_BYTES)
    throw new Error('Payload excede 10 MB.')
  return Object.freeze({
    operationId: input.operationId.toLowerCase(),
    userId: input.scope.userId.toLowerCase(),
    projectUrl: input.scope.projectUrl,
    localDatabase: input.localDatabase,
    expectedRevision: 0,
    payloadText,
    payloadHash: await sha256(payloadText),
    backupHash: await sha256(canonicalJson(validateBackup(input.backup))),
    manifest,
  })
}
export function assertSameOperation(saved: ImportPlan, retry: ImportPlan) {
  if (
    saved.operationId !== retry.operationId ||
    saved.userId !== retry.userId ||
    saved.projectUrl !== retry.projectUrl ||
    saved.payloadHash !== retry.payloadHash ||
    saved.expectedRevision !== retry.expectedRevision
  )
    throw new Error(
      'A operação não pode ser reutilizada com conteúdo, usuário, projeto ou revisão diferentes.',
    )
}
export async function confirmImportPreview(
  plan: ImportPlan,
  input: {
    confirmation: string
    savedBackupHash: string
    currentBackup: unknown
    userId: string
    projectUrl: string
  },
) {
  if (
    input.confirmation !== 'IMPORTAR PARA A NUVEM' ||
    input.savedBackupHash !== plan.backupHash ||
    input.userId !== plan.userId ||
    input.projectUrl !== plan.projectUrl
  )
    throw new Error('Backup e confirmação explícita vinculados à prévia são obrigatórios.')
  const current = await reconciliationManifest(input.currentBackup, plan.manifest.asOf)
  if (
    current.dataHash !== plan.manifest.dataHash ||
    (await sha256(plan.payloadText)) !== plan.payloadHash
  )
    throw new Error('Os dados mudaram após a prévia. Gere um novo backup e uma nova prévia.')
  return {
    operationId: plan.operationId,
    expectedRevision: plan.expectedRevision,
    payloadText: plan.payloadText,
  }
}
export async function assertReconciled(expected: Manifest, remote: unknown, userId: string) {
  const actual = await reconciliationManifest(decodeRemoteBackup(remote, userId), expected.asOf)
  if (canonicalJson(expected) !== canonicalJson(actual))
    throw new Error(
      'Reconciliação divergente. Preserve o IndexedDB e encaminhe para revisão; não tente reenviar como nova operação.',
    )
}
/** Deployment gate, deliberately independent of VITE_* and Supabase Auth. No network call. */
export async function submitFinancialImport(): Promise<never> {
  throw new Error('Sincronização desativada na Fase 3.2A. Nenhum dado foi enviado.')
}
