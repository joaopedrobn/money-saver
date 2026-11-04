import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SyncClient,
  SyncLabDatabase,
  TransportError,
  type SessionIdentity,
  type SyncTransport,
} from './outbox'
import { fixture, owner } from './fixtures.test-data'
import { applyDelta, wireData } from './incremental'
import { entities, canonicalJson } from './protocol'
import worker from '@/worker'

const databases: SyncLabDatabase[] = []
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete()
  vi.restoreAllMocks()
})
const date = '2026-11-04' as const
async function setup() {
  const db = new SyncLabDatabase('money-saver-sync-lab:unit:' + crypto.randomUUID())
  databases.push(db)
  let identity: SessionIdentity | null = {
    userId: owner,
    accessToken: 'not-a-real-token-unit-only',
  }
  const transport: SyncTransport = {
    view: vi.fn(async () => ({ revision: 1, data: wireData(fixture(), owner) })),
    send: vi.fn(async () => {
      throw new Error('Offline unit test')
    }),
    page: vi.fn(async () => ({ until: 1, events: [] })),
  }
  const client = new SyncClient(db, owner, transport, () => identity, date)
  await client.bootstrap()
  return {
    db,
    client,
    transport,
    session: () => identity,
    setIdentity: (next: SessionIdentity | null) => {
      identity = next
    },
  }
}
const create = (client: SyncClient) =>
  client.mutate('account-create', (r) =>
    r.accounts.create({
      name: 'Fictícia',
      institution: 'Teste',
      type: 'cash',
      openingBalanceCents: 1000,
      openingDate: date,
      color: 'sage',
    }),
  )

describe('durable outbox and domain boundary', () => {
  it('keeps the existing purchase history guard while allowing an atomic edit before settlement', async () => {
    const { client, db } = await setup()
    const input = {
      cardId: fixture().data.cards[0].id,
      categoryId: fixture().data.categories[0].id,
      description: 'Compra sem liquidação',
      amountCents: 600,
      installmentCount: 2,
      feeCents: 0,
      date: '2026-11-03' as const,
    }
    const purchase = await client.repositories.credit.createPurchase(input)
    const parts = await db.installments.where('purchaseId').equals(purchase.id).toArray()
    await client.repositories.credit.updatePurchase(purchase.id, { ...input, amountCents: 700 })
    expect((await db.purchases.get(purchase.id))!.amountCents).toBe(700)
    const delta = JSON.parse((await client.pending())[1].payloadText)
    expect(
      delta.changes.filter(
        (c: { entity: string; row: unknown }) => c.entity === 'installments' && c.row === null,
      ),
    ).toHaveLength(parts.length)
    const before = wireData(fixture(), owner)
    expect(() =>
      applyDelta(
        before,
        {
          protocol: 2,
          asOf: date,
          changes: [
            {
              entity: 'purchases',
              id: fixture().data.purchases[0].id,
              row: {
                ...before.purchases[0],
                status: 'cancelled',
                cancellation_reason: 'Cancelamento indevido',
              },
            },
          ],
        },
        owner,
      ),
    ).toThrow('histórico')
  })
  it('blocks a mismatched authoritative receipt instead of retrying it as an offline failure', async () => {
    const { client, transport, db } = await setup()
    await create(client)
    vi.mocked(transport.send).mockImplementationOnce(async (op) => ({
      operationId: op.id,
      revision: op.expectedRevision + 1,
      payloadHash: 'wrong',
      reconciliationHash: op.manifestHash,
    }))
    await expect(client.flush()).rejects.toThrow('Recibo divergente')
    expect((await client.pending())[0]).toMatchObject({
      state: 'error',
      lastError: expect.stringContaining('Recibo divergente'),
    })
    expect(await client.status()).toMatchObject({ phase: 'error', pending: 1 })
    await client.flush()
    expect(transport.send).toHaveBeenCalledOnce()
    expect(await db.accounts.count()).toBe(2)
  })
  it('stops the sender after a real HTTP authorization failure even if the cached identity remains', async () => {
    const { client, transport } = await setup()
    await create(client)
    vi.mocked(transport.send).mockRejectedValueOnce(new TransportError(401))
    await expect(client.flush()).rejects.toThrow('401')
    await expect(client.flush()).rejects.toThrow('401')
    expect(transport.send).toHaveBeenCalledOnce()
    expect((await client.pending())[0].state).toBe('pending')
  })
  it('does not mark an inconsistent incremental read as synchronized, including after reopening', async () => {
    const { client, transport, db, session } = await setup()
    const before = await db.accounts.toArray()
    vi.mocked(transport.page).mockResolvedValueOnce({
      until: 2,
      events: [
        {
          revision: 2,
          entity: 'accounts',
          id: crypto.randomUUID(),
          row_data: { user_id: crypto.randomUUID(), id: crypto.randomUUID() },
        },
      ],
    })
    await expect(client.pull()).rejects.toThrow('inconsistente')
    expect(await client.status()).toMatchObject({ phase: 'error', pending: 0 })
    expect(await db.accounts.toArray()).toEqual(before)
    const replacement = new SyncClient(db, owner, transport, session, date)
    expect(await replacement.status()).toMatchObject({ phase: 'error' })
    await replacement.pull()
    expect(await replacement.status()).toMatchObject({ phase: 'verified' })
  })
  it('previews an owned lab source and requires backup/confirmation without changing local finance', async () => {
    const db = new SyncLabDatabase(`money-saver-sync-lab:${owner}:${crypto.randomUUID()}`)
    databases.push(db)
    const source = fixture()
    await db.transaction('rw', db.tables, async () => {
      for (const entity of entities) await db.table(entity).bulkAdd(source.data[entity])
    })
    const empty = wireData(fixture(), owner)
    for (const entity of entities) empty[entity] = []
    const transport: SyncTransport = {
      view: vi.fn(async () => ({ revision: 0, data: empty })),
      send: vi.fn(),
      page: vi.fn(),
    }
    const client = new SyncClient(
      db,
      owner,
      transport,
      () => ({ userId: owner, accessToken: 'unit-only' }),
      date,
    )
    const preview = await client.prepareMigration()
    expect(preview.plan.localDatabase).toBe(db.name)
    expect(preview.plan.manifest.counts.payments).toBe(1)
    await expect(
      client.importInitial(
        { ...preview.plan, localDatabase: 'outro-espaço' },
        'IMPORTAR PARA A NUVEM',
        preview.plan.backupHash,
      ),
    ).rejects.toThrow('homologação')
    await expect(
      client.importInitial(preview.plan, 'SIM', preview.plan.backupHash),
    ).rejects.toThrow('confirmação')
    expect(await db.outbox.count()).toBe(0)
    await client.importInitial(preview.plan, 'IMPORTAR PARA A NUVEM', preview.plan.backupHash)
    expect((await client.pending())[0]).toMatchObject({
      id: preview.plan.operationId,
      state: 'pending',
      kind: 'initial-import',
    })
    expect(await db.payments.count()).toBe(1)
    expect(transport.send).not.toHaveBeenCalled()
  })
  it('automatically wraps existing repository mutation methods in the durable transaction', async () => {
    const { db, client } = await setup()
    const account = await client.repositories.accounts.create({
      name: 'Adaptador',
      institution: 'Teste',
      type: 'cash',
      openingBalanceCents: 1,
      openingDate: date,
      color: 'sage',
    })
    const [operation] = await client.pending()
    expect(operation.type).toBe('accounts.create')
    expect(operation.payloadText).toContain(account.id)
    expect(await db.audit.count()).toBe(1)
  })
  it('ignores a successful response received after logout and preserves its pending operation', async () => {
    const { client, transport, setIdentity } = await setup()
    await create(client)
    let release!: () => void
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.mocked(transport.send).mockImplementationOnce(async (op) => {
      await barrier
      return { operationId: op.id, revision: 2, payloadHash: '', reconciliationHash: '' }
    })
    const sending = client.flush()
    await vi.waitFor(() => expect(transport.send).toHaveBeenCalledOnce())
    setIdentity(null)
    client.stop()
    release()
    await expect(sending).rejects.toThrow('401')
    expect((await client.pending())[0].state).toBe('pending')
    expect(transport.page).not.toHaveBeenCalled()
  })
  it('rolls back the financial write if durable enqueue fails', async () => {
    const { db, client } = await setup()
    vi.spyOn(db.outbox, 'add').mockRejectedValueOnce(new Error('Quota fixture'))
    await expect(create(client)).rejects.toThrow('Quota fixture')
    expect(await db.accounts.count()).toBe(1)
    expect(await db.audit.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
  })
  it('retains UUID, payload, revision and backoff across reopening IndexedDB', async () => {
    const { db, client } = await setup()
    await create(client)
    const [before] = await client.pending()
    await expect(client.flush()).rejects.toThrow('Offline')
    db.close()
    const reopened = new SyncLabDatabase(db.name)
    databases.push(reopened)
    const saved = await reopened.outbox.get(before.id)
    expect(saved).toMatchObject({
      id: before.id,
      idempotencyKey: before.id,
      userId: owner,
      expectedRevision: 1,
      payloadText: before.payloadText,
      state: 'pending',
      attempts: 1,
    })
    expect(saved!.nextAttempt).toBeGreaterThan(Date.now())
    expect(await reopened.accounts.count()).toBe(2)
  })
  it('claims a shared IDB operation once across two concurrent processors', async () => {
    const { db, client, transport, session } = await setup()
    await create(client)
    let release!: () => void
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.mocked(transport.send).mockImplementationOnce(async () => {
      await barrier
      throw new Error('Offline')
    })
    const first = client.flush()
    await vi.waitFor(() => expect(transport.send).toHaveBeenCalledOnce())
    const other = new SyncClient(db, owner, transport, session, date)
    await other.flush()
    expect(transport.send).toHaveBeenCalledOnce()
    release()
    await expect(first).rejects.toThrow('Offline')
    expect((await client.pending())[0].state).toBe('pending')
  })
  it('rejects logout and account switching before any transport call', async () => {
    const { db, client, transport, setIdentity, session } = await setup()
    await create(client)
    setIdentity(null)
    client.stop()
    await expect(client.flush()).rejects.toThrow('401')
    setIdentity({ userId: crypto.randomUUID(), accessToken: 'another-user-fixture' })
    await expect(new SyncClient(db, owner, transport, session, date).flush()).rejects.toThrow('401')
    expect(transport.send).not.toHaveBeenCalled()
    expect(await db.accounts.count()).toBe(2)
    expect((await client.pending()).length).toBe(1)
  })
  it('does not expose another owner’s existing IDB dataset through repository reads', async () => {
    const { db, transport } = await setup()
    const other = crypto.randomUUID()
    const client = new SyncClient(
      db,
      other,
      transport,
      () => ({ userId: other, accessToken: 'different-user-unit-only' }),
      date,
    )
    await expect(client.repositories.accounts.list()).rejects.toThrow('usuário')
    await expect(client.repositories.backup.export()).rejects.toThrow('usuário')
    await expect(client.flush()).rejects.toThrow('usuário')
    expect(transport.send).not.toHaveBeenCalled()
  })
  it('exports financial tables only and blocks restore from erasing sync metadata', async () => {
    const { db, client } = await setup()
    await create(client)
    const exported = await client.repositories.backup.export()
    expect(Object.keys(exported.data).sort()).toEqual([...entities].sort())
    await expect(client.repositories.backup.restore(exported, 'RESTAURAR')).rejects.toThrow('fila')
    expect(await db.outbox.count()).toBe(1)
  })
  it('preserves the entire local transaction when a historical payment is edited', async () => {
    const { db, client } = await setup()
    const payment = fixture().data.payments[0]
    await expect(
      client.mutate('invalid-edit', async () => {
        await db.payments.update(payment.id, { amountCents: 1 })
      }),
    ).rejects.toThrow('histórico')
    expect((await db.payments.get(payment.id))!.amountCents).toBe(500)
    expect(await db.outbox.count()).toBe(0)
  })
  it('rejects duplicate mutations, cross-owner rows, historical deletion and opening-balance replacement', () => {
    const before = wireData(fixture(), owner)
    const change = { entity: 'payments', id: String(before.payments[0].id), row: null }
    expect(() => applyDelta(before, { protocol: 2, asOf: date, changes: [change] }, owner)).toThrow(
      'apagado',
    )
    const account = {
      entity: 'accounts',
      id: String(before.accounts[0].id),
      row: { ...before.accounts[0] },
    }
    expect(() =>
      applyDelta(before, { protocol: 2, asOf: date, changes: [account, account] }, owner),
    ).toThrow('repetido')
    expect(() =>
      applyDelta(
        before,
        {
          protocol: 2,
          asOf: date,
          changes: [{ ...account, row: { ...account.row, user_id: crypto.randomUUID() } }],
        },
        owner,
      ),
    ).toThrow('Proprietário')
    expect(() =>
      applyDelta(
        before,
        {
          protocol: 2,
          asOf: date,
          changes: [{ ...account, row: { ...account.row, opening_balance_cents: 0 } }],
        },
        owner,
      ),
    ).toThrow('ajuste')
  })
  it('normalizes PostgreSQL timestamps and nullable columns before validating edits', () => {
    const before = wireData(fixture(), owner)
    const row: Record<string, unknown> = { ...before.transactions[0], amount_cents: 150 }
    before.transactions[0].created_at = '2026-10-01T12:00:00+00:00'
    before.transactions[0].notes = null
    const after = applyDelta(
      before,
      { protocol: 2, asOf: date, changes: [{ entity: 'transactions', id: String(row.id), row }] },
      owner,
    )
    expect(after.transactions[0].amount_cents).toBe(150)
  })
  it('does not report synchronized while offline or pending', async () => {
    const { client } = await setup()
    await create(client)
    expect(await client.status()).toMatchObject({
      phase: 'prepared',
      pending: 1,
      lastCompletedAt: null,
    })
    await expect(client.flush()).rejects.toThrow('Offline')
    expect(await client.status()).toMatchObject({
      phase: 'offline',
      pending: 1,
      lastCompletedAt: null,
    })
  })
  it('fails closed before network access for production configuration or missing JWT', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected I/O'))
    const env = {
      LAB_ONLY: 'true',
      SUPABASE_URL: 'https://iwzmsbkbuerleocismhj.supabase.co',
      SUPABASE_PUBLIC_KEY: 'fixture',
      SYNC_VALIDATOR_TOKEN: 'fixture',
    }
    expect((await worker.fetch(new Request('http://localhost/view'), env)).status).toBe(503)
    expect(
      (
        await worker.fetch(new Request('http://localhost/view'), {
          ...env,
          SUPABASE_URL: 'http://127.0.0.1:54321',
        })
      ).status,
    ).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
    expect(canonicalJson({ pending: 1 })).toBe('{"pending":1}')
  })
})
