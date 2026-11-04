import type { SupabaseClient, User, Session } from '@supabase/supabase-js'

export interface RemoteIdentity {
  user: User | null
  loading: boolean
  error: string
}
type AuthPort = Pick<SupabaseClient['auth'], 'getUser' | 'onAuthStateChange'>
export const SESSION_CHECK_TIMEOUT_MS = 15_000
const expiredMessage = 'Sua sessão expirou. Entre novamente. Os dados locais continuam disponíveis.'

/** Auth-only observer. Does not import financial repositories or change browser datasets. */
export function observeRemoteSession(
  auth: AuthPort,
  publish: (state: RemoteIdentity) => void,
  onRecovery: () => void,
) {
  let stopped = false,
    revision = 0,
    verifiedUser: User | null = null
  let expiresAt: number | null = null
  let verificationTimer: ReturnType<typeof setTimeout> | undefined
  let expiryTimer: ReturnType<typeof setTimeout> | undefined
  let eventTimer: ReturnType<typeof setTimeout> | undefined
  const emit = (state: RemoteIdentity) => {
    if (!stopped) publish(state)
  }
  const cancelVerification = () => {
    clearTimeout(verificationTimer)
    clearTimeout(eventTimer)
  }
  const expire = () => {
    revision++
    cancelVerification()
    verifiedUser = null
    emit({ user: null, loading: false, error: expiredMessage })
  }
  const verify = () => {
    if (stopped) return
    cancelVerification()
    const expected = ++revision
    if (expiresAt !== null && expiresAt <= Date.now()) {
      expire()
      return
    }
    emit({ user: verifiedUser, loading: !verifiedUser, error: '' })
    verificationTimer = setTimeout(() => {
      if (stopped || expected !== revision) return
      revision++
      verifiedUser = null
      emit({
        user: null,
        loading: false,
        error: 'A verificação da sessão demorou demais. Tente novamente ou continue no modo local.',
      })
    }, SESSION_CHECK_TIMEOUT_MS)
    void auth
      .getUser()
      .then(({ data, error }) => {
        if (stopped || expected !== revision) return
        clearTimeout(verificationTimer)
        if (expiresAt !== null && expiresAt <= Date.now()) {
          expire()
          return
        }
        verifiedUser = error ? null : data.user
        emit({
          user: verifiedUser,
          loading: false,
          error:
            error && error.name !== 'AuthSessionMissingError'
              ? 'Não foi possível verificar a sessão. Tente novamente ou entre de novo.'
              : '',
        })
      })
      .catch(() => {
        if (stopped || expected !== revision) return
        clearTimeout(verificationTimer)
        verifiedUser = null
        emit({
          user: null,
          loading: false,
          error: 'Não foi possível verificar a sessão. Tente novamente ou entre de novo.',
        })
      })
  }
  const acceptSession = (session: Session | null) => {
    revision++
    cancelVerification()
    clearTimeout(expiryTimer)
    expiresAt = session?.expires_at ? session.expires_at * 1000 : null
    if (!session) {
      verifiedUser = null
      emit({ user: null, loading: false, error: '' })
      return
    }
    if (verifiedUser?.id !== session.user.id) verifiedUser = null
    if (expiresAt !== null) {
      if (expiresAt <= Date.now()) {
        expire()
        return
      }
      expiryTimer = setTimeout(expire, Math.min(expiresAt - Date.now(), 2_147_483_647))
    }
    emit({ user: verifiedUser, loading: !verifiedUser, error: '' })
    // Leave the SDK callback/lock before making another Auth call.
    eventTimer = setTimeout(verify, 0)
  }
  const {
    data: { subscription },
  } = auth.onAuthStateChange((event, session) => {
    if (stopped) return
    acceptSession(session)
    if (event === 'PASSWORD_RECOVERY' && session) onRecovery()
  })
  verify()
  return {
    retry: verify,
    stop: () => {
      stopped = true
      revision++
      cancelVerification()
      clearTimeout(expiryTimer)
      subscription.unsubscribe()
    },
  }
}
