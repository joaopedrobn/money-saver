import { afterEach, expect, it, vi } from 'vitest'
import worker from './cloudflare'
import { owner } from '../infrastructure/sync/fixtures.test-data'

const origin = 'https://money-saver.quem-votar-jp.workers.dev'
const token = `e30.${btoa(JSON.stringify({ role: 'money_saver_sync_validator', exp: 9999999999 }))}.unit`
const env = () => ({
  LAB_ONLY: 'false',
  REMOTE_SYNC_ENABLED: 'true',
  SUPABASE_URL: 'https://iwzmsbkbuerleocismhj.supabase.co',
  SUPABASE_PUBLIC_KEY: 'sb_publishable_test',
  SYNC_VALIDATOR_TOKEN: token,
  SYNC_ALLOWED_USER_IDS: owner,
  APP_ORIGINS: `${origin},http://localhost:5173`,
  ASSETS: { fetch: vi.fn(async () => new Response('SPA')) },
})
afterEach(() => vi.unstubAllGlobals())
it('serves SPA routes while the financial API stays closed before activation', async () => {
  const e = { ...env(), REMOTE_SYNC_ENABLED: 'false' }
  const network = vi.fn()
  vi.stubGlobal('fetch', network)
  expect(await (await worker.fetch(new Request(`${origin}/redefinir-senha`), e)).text()).toBe('SPA')
  expect((await worker.fetch(new Request(`${origin}/sync-api/view`), e)).status).toBe(503)
  expect(network).not.toHaveBeenCalled()
})
it('rejects unknown origins and allows only configured localhost preflights', async () => {
  const e = env(),
    network = vi.fn()
  vi.stubGlobal('fetch', network)
  expect(
    (
      await worker.fetch(
        new Request(`${origin}/sync-api/view`, { headers: { Origin: 'https://other.invalid' } }),
        e,
      )
    ).status,
  ).toBe(403)
  const response = await worker.fetch(
    new Request(`${origin}/sync-api/view`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173', 'Sec-Fetch-Site': 'cross-site' },
    }),
    e,
  )
  expect(response.status).toBe(204)
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
  expect(network).not.toHaveBeenCalled()
})
it('uses verified JWT identity and refuses a non-allowlisted owner before any RPC', async () => {
  const network = vi.fn<typeof fetch>(async () =>
    Response.json({ id: owner, email_confirmed_at: '2026-11-04T00:00:00Z' }),
  )
  vi.stubGlobal('fetch', network)
  const response = await worker.fetch(
    new Request(`${origin}/sync-api/view`, { headers: { Authorization: 'Bearer unit' } }),
    { ...env(), SYNC_ALLOWED_USER_IDS: crypto.randomUUID() },
  )
  expect(response.status).toBe(403)
  expect(network).toHaveBeenCalledTimes(1)
  expect(String(network.mock.calls[0]?.[0])).toContain('/auth/v1/user')
})
it('rejects admin or expired validator tokens and an unexpected Supabase target', async () => {
  const network = vi.fn()
  vi.stubGlobal('fetch', network)
  for (const patch of [
    {
      SYNC_VALIDATOR_TOKEN: `e30.${btoa(JSON.stringify({ role: 'service_role', exp: 9999999999 }))}.unit`,
    },
    {
      SYNC_VALIDATOR_TOKEN: `e30.${btoa(JSON.stringify({ role: 'money_saver_sync_validator', exp: 1 }))}.unit`,
    },
    { SUPABASE_URL: 'https://other.supabase.co' },
  ])
    expect(
      (await worker.fetch(new Request(`${origin}/sync-api/view`), { ...env(), ...patch })).status,
    ).toBe(503)
  expect(network).not.toHaveBeenCalled()
})

it('forwards the verified user JWT to the existing view RPC without using validator privileges', async () => {
  const network = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ id: owner, email_confirmed_at: '2026-11-04T00:00:00Z' }))
    .mockResolvedValueOnce(Response.json({ revision: 0, data: {} }))
  vi.stubGlobal('fetch', network)
  const response = await worker.fetch(
    new Request(`${origin}/sync-api/view`, {
      headers: { Authorization: 'Bearer unit-user-token', Origin: origin },
    }),
    env(),
  )
  expect(response.status).toBe(200)
  expect(String(network.mock.calls[0][0])).toContain('/auth/v1/user')
  expect(String(network.mock.calls[1][0])).toContain('/rest/v1/rpc/ms_sync_view')
  for (const [, init] of network.mock.calls)
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer unit-user-token')
})

it('stops before RPCs when Supabase rejects the session or the e-mail is unconfirmed', async () => {
  for (const authResponse of [
    new Response(null, { status: 401 }),
    Response.json({ id: owner, email_confirmed_at: null }),
  ]) {
    const network = vi.fn<typeof fetch>().mockResolvedValueOnce(authResponse)
    vi.stubGlobal('fetch', network)
    const response = await worker.fetch(
      new Request(`${origin}/sync-api/view`, {
        headers: { Authorization: 'Bearer unit-invalid-token' },
      }),
      env(),
    )
    expect(response.ok).toBe(false)
    expect(network).toHaveBeenCalledTimes(1)
  }
})
