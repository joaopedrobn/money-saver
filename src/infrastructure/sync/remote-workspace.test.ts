import { afterEach, expect, it, vi } from 'vitest'
import { createRemoteSyncWorkspace, remoteProject, remoteSyncConfig } from './remote-workspace'
import { fixture, owner } from './fixtures.test-data'
import { wireData } from './incremental'
import { canonicalJson, entities, reconciliationManifest, sha256 } from './protocol'
import { TransportError, type SyncClient, type SyncTransport } from './outbox'
import { authConfig } from '../supabase/config'

const clients: SyncClient[] = []
afterEach(async () => {
  const opened = clients.splice(0)
  for (const client of opened) {
    client.stop()
    client.db.close()
  }
  for (const db of new Map(opened.map((c) => [c.db.name, c.db])).values()) await db.delete()
  vi.restoreAllMocks()
})
const env = {
  VITE_REMOTE_SYNC_ENABLED: 'true',
  VITE_SUPABASE_URL: remoteProject,
  VITE_SYNC_ALLOWED_USER_IDS: owner,
  VITE_SYNC_API_URL: 'https://money-saver.quem-votar-jp.workers.dev/sync-api',
}
const session = () => ({ userId: owner, accessToken: 'unit-test' })
function port(): SyncTransport {
  const data = Object.fromEntries(entities.map((e) => [e, []])) as unknown as ReturnType<
    typeof wireData
  >
  return {
    view: vi.fn(async () => ({ revision: 0, data })),
    page: vi.fn(async () => ({ until: 0, events: [] })),
    send: vi.fn(),
  }
}
it('requires remote project, enabled flag, allowed user and an HTTPS API; localhost needs no Docker', () => {
  expect(remoteSyncConfig({}, 'http://127.0.0.1:5173', owner)).toBeNull()
  expect(
    remoteSyncConfig({ ...env, VITE_SYNC_ALLOWED_USER_IDS: '' }, 'http://127.0.0.1:5173', owner),
  ).toBeNull()
  expect(() =>
    remoteSyncConfig(
      { ...env, VITE_SYNC_API_URL: 'http://127.0.0.1:8787/sync-api' },
      'http://127.0.0.1:5173',
      owner,
    ),
  ).toThrow('HTTPS')
  expect(remoteSyncConfig(env, 'http://localhost:5173', owner)?.projectUrl).toBe(remoteProject)
})
it('keeps the remote replica separate and only pulls on explicit initialization', async () => {
  const transport = port()
  const c = createRemoteSyncWorkspace(
    remoteSyncConfig(env, 'http://localhost:5173', owner)!,
    session,
    transport,
  )
  clients.push(c)
  expect(c.db.name).toBe(`money-saver-sync-remote:${encodeURIComponent(remoteProject)}:${owner}`)
  expect(transport.view).not.toHaveBeenCalled()
  await c.bootstrap()
  expect(await c.db.accounts.count()).toBe(0)
  expect(await c.pending()).toHaveLength(0)
  expect(() =>
    createRemoteSyncWorkspace(
      remoteSyncConfig(env, 'http://localhost:5173', owner)!,
      () => null,
      transport,
    ),
  ).toThrow('sessão')
})
it('stages only explicitly selected backups in an empty replica and blocks pull/edit until confirmed import', async () => {
  const c = createRemoteSyncWorkspace(
    remoteSyncConfig(env, 'http://localhost:5173', owner)!,
    session,
    port(),
  )
  clients.push(c)
  await c.bootstrap()
  await expect(c.stageInitialBackup(fixture(), '')).rejects.toThrow('Confirmação')
  await c.stageInitialBackup(fixture(), 'PREPARAR IMPORTAÇÃO DE BACKUP')
  expect(await c.pending()).toHaveLength(0)
  await expect(c.pull()).rejects.toThrow('Importação preparada')
  await expect(c.repositories.accounts.remove(fixture().data.accounts[0].id)).rejects.toThrow(
    'integridade',
  )
  const { plan } = await c.prepareMigration()
  expect(plan.projectUrl).toBe(remoteProject)
  await expect(c.importInitial(plan, '', plan.backupHash)).rejects.toThrow()
  expect(await c.db.accounts.count()).toBe(1)
})
it('reconciles a persisted operation using its original civil date after reload on another day', async () => {
  const transport = port(),
    config = remoteSyncConfig(env, 'http://localhost:5173', owner)!
  const c = createRemoteSyncWorkspace(config, session, transport)
  clients.push(c)
  await c.bootstrap()
  await c.repositories.accounts.create({
    name: 'Fake',
    institution: 'Fake',
    type: 'cash',
    openingDate: '2026-01-01',
    openingBalanceCents: 100,
    color: 'sage',
  })
  const op = (await c.pending())[0]
  const payload = JSON.parse(op.payloadText)
  payload.asOf = '2026-01-02'
  const backup = await c.repositories.backup.export()
  const hash = await sha256(canonicalJson(await reconciliationManifest(backup, payload.asOf)))
  await c.db.outbox.update(op.id, { payloadText: canonicalJson(payload), manifestHash: hash })
  vi.mocked(transport.send).mockImplementation(async (queued) => ({
    operationId: queued.id,
    revision: 1,
    payloadHash: await sha256(queued.payloadText),
    reconciliationHash: hash,
  }))
  vi.mocked(transport.page).mockResolvedValue({
    until: 1,
    events: payload.changes.map(
      (r: { entity: string; id: string; row: Record<string, unknown> }) => ({
        revision: 1,
        entity: r.entity,
        id: r.id,
        row_data: r.row,
      }),
    ),
  })
  c.stop()
  c.db.close()
  const reopened = createRemoteSyncWorkspace(config, session, transport)
  clients.push(reopened)
  await reopened.bootstrap()
  await reopened.flush()
  expect(await reopened.pending()).toHaveLength(0)
})
it('uses the current deployment callback when no override is provided and rejects an explicit foreign origin', () => {
  const auth = {
    VITE_SUPABASE_AUTH_ENABLED: 'true',
    VITE_SUPABASE_URL: remoteProject,
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  }
  expect(authConfig(auth, 'https://money-saver.quem-votar-jp.workers.dev/login')).toMatchObject({
    enabled: true,
    redirectUrl: 'https://money-saver.quem-votar-jp.workers.dev/',
  })
  expect(
    authConfig(
      { ...auth, VITE_SUPABASE_AUTH_REDIRECT_URL: 'http://127.0.0.1:5173/' },
      'https://money-saver.quem-votar-jp.workers.dev/',
    ).enabled,
  ).toBe(false)
})

it('resumes a 401-paused replica only after the verified observer supplies a different token', async () => {
  const transport = port()
  let identity = session()
  const c = createRemoteSyncWorkspace(
    remoteSyncConfig(env, 'http://localhost:5173', owner)!,
    () => identity,
    transport,
  )
  clients.push(c)
  await c.bootstrap()
  vi.mocked(transport.page).mockRejectedValueOnce(new TransportError(401))
  await expect(c.pull()).rejects.toThrow('401')
  c.resumeAfterTokenRefresh()
  expect(transport.page).toHaveBeenCalledTimes(1)
  identity = { ...identity, accessToken: 'unit-refreshed-verified-token' }
  c.resumeAfterTokenRefresh()
  await vi.waitFor(async () =>
    expect(await c.status()).toMatchObject({ phase: 'verified', message: '' }),
  )
  expect(transport.page).toHaveBeenCalledTimes(2)
})
