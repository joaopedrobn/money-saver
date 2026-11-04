import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { UserRound, HardDrive } from 'lucide-react'
import { getAuthClient, remoteAuthConfig } from '@/infrastructure/supabase/client'
import { remoteAuth } from '@/infrastructure/supabase/auth'
import { Button } from '@/components/ui/button'
import { LocalFinanceProvider } from '@/infrastructure/financial-workspace'
import { financialDatabaseName } from '@/infrastructure/financial-context'
import { observeRemoteSession, type RemoteIdentity } from '@/infrastructure/supabase/session'
import { AuthPages, AuthLink, AuthLayout } from './AuthPages'
import {
  authCallback,
  entryDestination,
  localModeKey,
  readPreference,
  readRecovery,
  recoveryKey,
  routeFromUrl,
  saveProgress,
  validRecovery,
  writePreference,
  type AuthRoute,
  type RecoveryGrant,
} from './access-state'
import './auth.css'
import { RemoteFinanceProvider } from '@/infrastructure/sync/RemoteFinanceProvider'
import { StorageNotice } from './StorageNotice'

const AccountContext = createContext<ReactNode>(null)
export function UserAccountMenu() {
  return useContext(AccountContext)
}

/** Verified sessions enter directly; anonymous and account-local datasets stay separate. */
export function RemoteAccess({ children }: { children: ReactNode }) {
  const [callback] = useState(() => authCallback(window.location.href))
  const [callbackError, setCallbackError] = useState(callback.error)
  const [callbackPending, setCallbackPending] = useState(callback.present && !callback.error)
  const [route, setRoute] = useState(() => routeFromUrl(window.location.href))
  const [local, setLocal] = useState(() => {
    const url = new URL(window.location.href)
    return (
      url.pathname === '/' &&
      url.hash !== '#online' &&
      !callback.present &&
      readPreference(localModeKey) === 'true'
    )
  })
  const [identity, setIdentity] = useState<RemoteIdentity>({ user: null, loading: true, error: '' })
  const [recovery, setRecovery] = useState<RecoveryGrant | null>(readRecovery)
  const [busy, setBusy] = useState(false)
  const leaving = useRef(false)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const retrySession = useRef<(() => void) | null>(null)
  const config = remoteAuthConfig()

  useEffect(() => {
    // A direct login/callback must not revive an older anonymous choice on the next hash change.
    if (!local) writePreference(localModeKey, null)
  }, [local])

  const navigate = useCallback((next: AuthRoute, replace = false) => {
    writePreference(localModeKey, null)
    setLocal(false)
    setCallbackError('')
    setCallbackPending(false)
    setActionError('')
    window.history[replace ? 'replaceState' : 'pushState'](null, '', next)
    setRoute(next)
  }, [])

  const continueLocally = useCallback(() => {
    writePreference(localModeKey, 'true')
    writePreference(recoveryKey, null)
    setRecovery(null)
    setLocal(true)
    setCallbackError('')
    setCallbackPending(false)
    window.history.pushState(null, '', '/#dashboard')
    setRoute('/login')
  }, [])

  useEffect(() => {
    const changed = () => {
      const url = new URL(window.location.href)
      if (url.hash === '#online') {
        navigate('/login')
        return
      }
      setRoute(routeFromUrl(url.href))
      setLocal(url.pathname === '/' && readPreference(localModeKey) === 'true')
      setCallbackError('')
      setCallbackPending(false)
    }
    window.addEventListener('popstate', changed)
    window.addEventListener('hashchange', changed)
    return () => {
      window.removeEventListener('popstate', changed)
      window.removeEventListener('hashchange', changed)
    }
  }, [navigate])

  useEffect(() => {
    let mounted = true
    let hadVerifiedUser = false
    let observer: ReturnType<typeof observeRemoteSession> | undefined
    void getAuthClient()
      .then((client) => {
        if (!mounted) return
        if (!client) {
          setIdentity({ user: null, loading: false, error: '' })
          return
        }
        observer = observeRemoteSession(
          client.auth,
          (state) => {
            if (!mounted) return
            setIdentity(state)
            if (state.user) hadVerifiedUser = true
            if (!state.user && !state.loading) {
              if (hadVerifiedUser) {
                setRoute('/login')
                setNotice(
                  state.error ? '' : 'Sua sessão foi encerrada. Entre novamente para continuar.',
                )
                hadVerifiedUser = false
              }
              setRecovery(null)
              writePreference(recoveryKey, null)
            }
          },
          (user) => {
            if (!mounted) return
            const grant = { userId: user.id, until: Date.now() + 15 * 60_000 }
            writePreference(recoveryKey, JSON.stringify(grant))
            setRecovery(grant)
            navigate('/redefinir-senha', true)
          },
        )
        retrySession.current = observer.retry
      })
      .catch(() => {
        if (mounted)
          setIdentity({
            user: null,
            loading: false,
            error: 'Não foi possível iniciar a conexão. Tente novamente ou continue sem conta.',
          })
      })
    return () => {
      mounted = false
      retrySession.current = null
      observer?.stop()
    }
  }, [navigate])

  useEffect(() => {
    if (!recovery) return
    const timer = window.setTimeout(
      () => {
        setRecovery(null)
        writePreference(recoveryKey, null)
      },
      Math.max(0, recovery.until - Date.now()),
    )
    return () => window.clearTimeout(timer)
  }, [recovery])

  const canReset = validRecovery(recovery, identity.user?.id)
  const effectiveRoute = entryDestination({
    route,
    local,
    userId: identity.user?.id,
    loading: identity.loading,
    canReset,
  })
  useEffect(() => {
    if (identity.loading && !local) return
    // Wait for the SDK to consume external codes before canonicalizing the URL.
    const url = new URL(window.location.href)
    if (url.pathname !== effectiveRoute || url.hash === '#online')
      window.history.replaceState(null, '', effectiveRoute)
  }, [local, identity.loading, effectiveRoute])

  async function leave(switchAccount: boolean) {
    if (leaving.current) return
    leaving.current = true
    setBusy(true)
    setActionError('')
    try {
      await remoteAuth.signOut()
      setIdentity({ user: null, loading: false, error: '' })
      setRecovery(null)
      writePreference(recoveryKey, null)
      saveProgress(null)
      setNotice(
        switchAccount
          ? 'Você saiu. Entre com a outra conta para continuar.'
          : 'Você saiu da conta. Seus dados neste navegador foram preservados.',
      )
      navigate('/login', true)
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Não foi possível sair. Tente novamente.',
      )
    } finally {
      leaving.current = false
      setBusy(false)
    }
  }
  const menu = (
    <details className="user-account-menu">
      <summary aria-label="Abrir menu de usuário">
        {identity.user ? <UserRound size={18} /> : <HardDrive size={18} />}
        <span>{identity.user ? 'Minha conta' : 'Modo local'}</span>
      </summary>
      <div className="user-account-popover">
        <strong>
          {identity.loading
            ? 'Verificando sessão…'
            : identity.user
              ? 'Conta conectada'
              : 'Sem conta conectada'}
        </strong>
        {identity.user && <p className="account-email">{identity.user.email}</p>}
        <StorageNotice local={local} />
        {actionError && <p role="alert">{actionError}</p>}
        {identity.user && (
          <p>
            {identity.user.email_confirmed_at
              ? 'E-mail confirmado'
              : 'Confirmação de e-mail pendente'}
          </p>
        )}
        {identity.error && <p role="alert">{identity.error}</p>}
        {!identity.user && (
          <Button variant="outline" onClick={() => navigate('/login')}>
            Entrar ou criar conta
          </Button>
        )}
        {local && identity.user && (
          <Button variant="outline" onClick={() => navigate('/')}>
            Abrir meu espaço local separado
          </Button>
        )}
        {identity.user && (
          <>
            <Button variant="outline" disabled={busy} onClick={() => void leave(false)}>
              Sair da conta
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void leave(true)}>
              Trocar de conta
            </Button>
          </>
        )}
        {!local && identity.user && (
          <Button variant="ghost" onClick={continueLocally}>
            Usar espaço sem conta
          </Button>
        )}
      </div>
    </details>
  )
  if (effectiveRoute === '/' && (local || (!identity.loading && identity.user && config.enabled))) {
    const scope =
      !local && identity.user && config.enabled
        ? { projectUrl: config.url, userId: identity.user.id }
        : null
    return (
      <AccountContext.Provider value={menu}>
        <LocalFinanceProvider key={financialDatabaseName(scope)} scope={scope}>
          <RemoteFinanceProvider
            key={financialDatabaseName(scope)}
            identity={local ? { user: null, loading: false, error: '' } : identity}
          >
            {children}
          </RemoteFinanceProvider>
        </LocalFinanceProvider>
      </AccountContext.Provider>
    )
  }

  const linkError = callbackError
  const callbackNotice =
    callbackPending && !identity.loading && !identity.user && !identity.error && !linkError
      ? 'Não foi possível entrar automaticamente. Use seu e-mail e senha para continuar, ou solicite um novo link se necessário.'
      : ''
  const disabled = !config.enabled || identity.loading
  return (
    <AuthLayout route={effectiveRoute} navigate={navigate}>
      {!config.enabled && (
        <p className="auth-feedback is-error" role="alert">
          A entrada com conta está indisponível no momento. Você pode continuar sem conta.
        </p>
      )}
      {identity.error && (
        <div className="auth-feedback is-error" role="alert">
          <p>{identity.error}</p>
          <button
            className="auth-inline-link"
            onClick={() =>
              retrySession.current ? retrySession.current() : window.location.reload()
            }
          >
            Tentar novamente
          </button>
        </div>
      )}
      {linkError && (
        <div className="auth-feedback is-error" role="alert">
          <p>{linkError}</p>
          <div className="auth-recovery-links">
            <AuthLink to="/verificar-email" navigate={navigate}>
              Novo link de confirmação
            </AuthLink>
            <AuthLink to="/recuperar-senha" navigate={navigate}>
              Recuperar senha
            </AuthLink>
          </div>
        </div>
      )}
      {callbackNotice && (
        <p className="auth-feedback" role="status">
          {callbackNotice}
        </p>
      )}
      {actionError && (
        <p className="auth-feedback is-error" role="alert">
          {actionError}
        </p>
      )}
      {notice && effectiveRoute === '/login' && (
        <p role="status" className="auth-feedback">
          {notice}
        </p>
      )}
      <AuthPages
        key={effectiveRoute}
        route={effectiveRoute === '/conta' ? '/login' : effectiveRoute}
        navigate={navigate}
        disabled={disabled}
        canReset={canReset}
        onPasswordUpdated={() => {
          // Keep the success screen visible even when recovery resumed from another route.
          setRoute('/redefinir-senha')
          setRecovery(null)
          writePreference(recoveryKey, null)
          saveProgress(null)
        }}
      />
      <div className="auth-local-access">
        <button onClick={continueLocally} disabled={canReset}>
          {identity.user ? 'Abrir espaço local' : 'Continuar sem conta'}
          <span aria-hidden="true">→</span>
        </button>
      </div>
      {identity.loading && (
        <p className="auth-checking" role="status">
          Verificando sessão…
        </p>
      )}
    </AuthLayout>
  )
}
