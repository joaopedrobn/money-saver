import { afterEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createApplicationSyncWorkspace, type LocalTestMode } from './application-workspace'
import type { SyncTransport } from './outbox'
import { fixture, owner } from './fixtures.test-data'
import { wireData, applyDelta } from './incremental'
import { App } from '@/App'

const workspaces: ReturnType<typeof createApplicationSyncWorkspace>[] = []
afterEach(async () => {
  for (const w of workspaces.splice(0)) {
    w.close()
    await w.client.db.delete()
  }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
const mode = (): LocalTestMode => ({
  enabled: true,
  development: true,
  appOrigin: 'http://127.0.0.1:5173',
  workerUrl: 'http://127.0.0.1:8787',
  projectUrl: 'http://127.0.0.1:54321',
  userId: owner,
  runId: crypto.randomUUID(),
  deviceId: 'app-pc',
  asOf: '2026-11-04',
})
const session = () => ({ userId: owner, accessToken: 'unit-only-no-network' })
function transport(): SyncTransport {
  return {
    view: vi.fn(async () => ({ revision: 1, data: wireData(fixture(), owner) })),
    page: vi.fn(async () => ({ until: 1, events: [] })),
    send: vi.fn(),
  }
}
it('requires explicit local development activation before opening a synchronized workspace', () => {
  for (const override of [
    { enabled: false },
    { development: false },
    { projectUrl: 'https://iwzmsbkbuerleocismhj.supabase.co' },
    { workerUrl: 'https://remote.example.com' },
    { appOrigin: 'https://app.example.com' },
  ])
    expect(() => createApplicationSyncWorkspace({ ...mode(), ...override }, session)).toThrow(
      'homologação',
    )
  expect(() =>
    createApplicationSyncWorkspace(mode(), () => ({ ...session(), userId: crypto.randomUUID() })),
  ).toThrow('Sessão')
})
it('mounts the main app behind explicit activation and does not contact a backend during rendering', () => {
  const port = transport(),
    workspace = createApplicationSyncWorkspace(mode(), session, port)
  workspaces.push(workspace)
  vi.stubGlobal('window', { location: { hostname: '127.0.0.1' } })
  const html = renderToStaticMarkup(createElement(App, { testWorkspace: workspace }))
  expect(html).toContain('Ativar sincronização local de testes')
  expect(port.view).not.toHaveBeenCalled()
  expect(port.send).not.toHaveBeenCalled()
  expect(() => workspace.start()).toThrow('backend')
})
it('uses the main app repository workspace with atomic outbox and no upload events for remote reads', async () => {
  const workspace = createApplicationSyncWorkspace(mode(), session, transport())
  workspaces.push(workspace)
  await workspace.initialize()
  await workspace.client.pull()
  expect(await workspace.client.db.outbox.count()).toBe(0)
  await workspace.repositories.accounts.create({
    name: 'Conta do app',
    institution: 'Teste',
    type: 'cash',
    openingBalanceCents: 0,
    openingDate: '2026-01-01',
    color: 'sage',
  })
  expect(await workspace.client.db.accounts.count()).toBe(2)
  expect((await workspace.client.pending())[0].type).toBe('accounts.create')
  workspace.stop()
  await expect(
    workspace.repositories.accounts.remove(fixture().data.accounts[0].id),
  ).rejects.toThrow('401')
})
it('persists an offline read state across workspace reload instead of showing synchronized', async () => {
  const config = mode(),
    port = transport(),
    workspace = createApplicationSyncWorkspace(config, session, port)
  workspaces.push(workspace)
  await workspace.initialize()
  vi.mocked(port.page).mockRejectedValueOnce(new TypeError('offline'))
  await expect(workspace.client.pull()).rejects.toThrow('offline')
  workspace.close()
  const reopened = createApplicationSyncWorkspace(config, session, port)
  workspaces.push(reopened)
  await reopened.initialize()
  expect(await reopened.client.status()).toMatchObject({ phase: 'offline', pending: 0 })
  await reopened.client.pull()
  expect(await reopened.client.status()).toMatchObject({ phase: 'verified' })
})
it('preserves the original payment in a fresh immutable audit and rejects reuse of a prior audit', async () => {
  const workspace = createApplicationSyncWorkspace(mode(), session, transport())
  workspaces.push(workspace)
  await workspace.initialize()
  const before = wireData(await workspace.repositories.backup.export(), owner)
  const id = fixture().data.payments[0].id
  await workspace.repositories.credit.correctPayment(id, {
    invoiceId: fixture().data.invoices[0].id,
    accountId: fixture().data.accounts[0].id,
    amountCents: 400,
    date: '2026-10-10',
  })
  const op = (await workspace.client.pending())[0],
    delta = JSON.parse(op.payloadText)
  const after = applyDelta(before, delta, owner)
  expect(after.payments[0].amount_cents).toBe(400)
  const audit = delta.changes.find((c: { entity: string }) => c.entity === 'audit')
  expect(audit.row.before_data.amountCents).toBe(500)
  expect(() => applyDelta({ ...before, audit: [audit.row] }, delta, owner)).toThrow('histórico')
})
