import { afterEach, expect, it, vi } from 'vitest'
import type { SupabaseClient, AuthChangeEvent, Session, User } from '@supabase/supabase-js'
import { observeRemoteSession, SESSION_CHECK_TIMEOUT_MS, type RemoteIdentity } from './session'
import { entryDestination } from '@/features/auth/access-state'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
const user = (id = 'a') => ({ id }) as User
const session = (id = 'a', seconds = 3600) =>
  ({ user: user(id), expires_at: Math.floor(Date.now() / 1000) + seconds }) as Session
function harness() {
  vi.useFakeTimers()
  let event: (event: AuthChangeEvent, session: Session | null) => void = () => {}
  const getUser = vi
    .fn()
    .mockResolvedValue({ data: { user: null }, error: { name: 'AuthSessionMissingError' } })
  const unsubscribe = vi.fn()
  const auth = {
    getUser,
    onAuthStateChange: (callback: typeof event) => {
      event = callback
      return { data: { subscription: { unsubscribe } } }
    },
  } as unknown as SupabaseClient['auth']
  const states: RemoteIdentity[] = [],
    recovered = vi.fn()
  const controller = observeRemoteSession(auth, (state) => states.push(state), recovered)
  return {
    getUser,
    unsubscribe,
    states,
    recovered,
    controller,
    event: (name: AuthChangeEvent, value: Session | null) => event(name, value),
  }
}

it('restores only a server-verified identity and handles a missing session as signed out', async () => {
  const h = harness()
  await vi.advanceTimersByTimeAsync(0)
  expect(h.states.at(-1)).toEqual({ user: null, loading: false, error: '' })
  h.getUser.mockResolvedValue({ data: { user: user() }, error: null })
  h.event('INITIAL_SESSION', session())
  expect(h.states.at(-1)?.user).toBeNull()
  expect(h.states.at(-1)?.loading).toBe(true)
  await vi.advanceTimersByTimeAsync(0)
  expect(h.states.at(-1)?.user?.id).toBe('a')
  h.controller.stop()
})
it('ignores stale verification after logout and when switching identities', async () => {
  const h = harness()
  await vi.advanceTimersByTimeAsync(0)
  let finish: (value: unknown) => void = () => {}
  h.getUser.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  h.event('SIGNED_IN', session('a'))
  await vi.advanceTimersByTimeAsync(0)
  h.event('SIGNED_OUT', null)
  finish({ data: { user: user('a') }, error: null })
  await vi.advanceTimersByTimeAsync(0)
  expect(h.states.at(-1)?.user).toBeNull()
  h.getUser.mockResolvedValue({ data: { user: user('b') }, error: null })
  h.event('SIGNED_IN', session('b'))
  await vi.advanceTimersByTimeAsync(0)
  expect(h.states.at(-1)?.user?.id).toBe('b')
  h.controller.stop()
})
it('ends indefinite loading on network timeout, rejects late responses and supports retry', async () => {
  const h = harness()
  await vi.advanceTimersByTimeAsync(0)
  let finish: (value: unknown) => void = () => {}
  h.getUser.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  h.event('SIGNED_IN', session())
  await vi.advanceTimersByTimeAsync(SESSION_CHECK_TIMEOUT_MS + 1)
  expect(h.states.at(-1)).toMatchObject({ user: null, loading: false })
  expect(h.states.at(-1)?.error).toContain('demorou')
  finish({ data: { user: user() }, error: null })
  await vi.advanceTimersByTimeAsync(0)
  expect(h.states.at(-1)?.user).toBeNull()
  h.getUser.mockResolvedValue({ data: { user: user() }, error: null })
  h.controller.retry()
  await vi.advanceTimersByTimeAsync(0)
  expect(h.states.at(-1)?.user?.id).toBe('a')
  h.controller.stop()
})
it('handles token renewal and clears the remote identity when the token expires', async () => {
  const h = harness()
  h.getUser.mockResolvedValue({ data: { user: user() }, error: null })
  h.event('SIGNED_IN', session('a', 20))
  await vi.advanceTimersByTimeAsync(10_000)
  h.event('TOKEN_REFRESHED', session('a', 20))
  await vi.advanceTimersByTimeAsync(11_000)
  expect(h.states.at(-1)?.user?.id).toBe('a')
  await vi.advanceTimersByTimeAsync(10_000)
  expect(h.states.at(-1)).toMatchObject({ user: null, loading: false })
  expect(h.states.at(-1)?.error).toContain('expirou')
  h.controller.stop()
})
it('opens password recovery, reports verification errors, and cleans up timers and subscriptions', async () => {
  const h = harness()
  await vi.advanceTimersByTimeAsync(0)
  h.getUser.mockRejectedValue(new Error('network'))
  h.event('PASSWORD_RECOVERY', session())
  expect(h.recovered).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(0)
  expect(h.states.at(-1)?.error).toContain('Não foi possível verificar')
  h.controller.stop()
  const count = h.states.length
  h.event('SIGNED_IN', session())
  await vi.advanceTimersByTimeAsync(60_000)
  expect(h.states).toHaveLength(count)
  expect(h.unsubscribe).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})

it('waits for verification on restored/login sessions and gives recovery priority over the dashboard', async () => {
  const h = harness()
  await vi.advanceTimersByTimeAsync(0)
  h.getUser.mockResolvedValue({ data: { user: user() }, error: null })
  h.event('PASSWORD_RECOVERY', session())
  const destination = () => {
    const state = h.states.at(-1)!
    return entryDestination({
      route: '/',
      local: false,
      userId: state.user?.id,
      loading: state.loading,
      canReset: h.recovered.mock.calls.length > 0 && !!state.user,
    })
  }
  expect(destination()).not.toBe('/')
  await vi.advanceTimersByTimeAsync(0)
  expect(destination()).toBe('/redefinir-senha')
  h.event('SIGNED_OUT', null)
  expect(destination()).toBe('/login')
  h.controller.stop()
})
