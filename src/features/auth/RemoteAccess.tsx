import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { getAuthClient, remoteAuthConfig } from '@/infrastructure/supabase/client'
import { remoteAuth } from '@/infrastructure/supabase/auth'
import { Button } from '@/components/ui/button'
import { observeRemoteSession, type RemoteIdentity } from '@/infrastructure/supabase/session'

/** Only #online is protected. Financial routes and IndexedDB are always local and accessible. */
export function RemoteAccess({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(() => window.location.hash === '#online')
  const [identity, setIdentity] = useState<RemoteIdentity>({
    user: null,
    loading: true,
    error: '',
  })
  const [recovery, setRecovery] = useState(false)
  const retrySession = useRef<(() => void) | null>(null)
  const config = remoteAuthConfig()
  useEffect(() => {
    const changed = () => setOnline(window.location.hash === '#online')
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [])
  useEffect(() => {
    let mounted = true
    let observer: ReturnType<typeof observeRemoteSession> | undefined
    void getAuthClient()
      .then((client) => {
        if (!client || !mounted) return
        observer = observeRemoteSession(
          client.auth,
          (state) => {
            if (!mounted) return
            setIdentity(state)
            if (!state.user && !state.loading) setRecovery(false)
          },
          () => {
            setRecovery(true)
            window.location.hash = 'online'
          },
        )
        retrySession.current = observer.retry
      })
      .catch(() => {
        if (mounted)
          setIdentity({
            user: null,
            loading: false,
            error: 'Falha ao iniciar Auth. Recarregue ou continue no modo local.',
          })
      })
    return () => {
      mounted = false
      retrySession.current = null
      observer?.stop()
    }
  }, [])
  if (!online) return children
  return (
    <main className="content" style={{ maxWidth: 640, margin: '0 auto' }}>
      <section className="panel settings-panel">
        <h1>Conta online</h1>
        <p>
          Autenticação separada do armazenamento financeiro. Seus dados continuam neste navegador;
          entrar ou sair não os envia nem os apaga.
        </p>
        <p>
          <a className="text-link" href="#settings">
            Continuar no modo local
          </a>
        </p>
        {!config.enabled ? (
          <p role="status">
            {config.error || 'Supabase não configurado. O modo local está disponível normalmente.'}
          </p>
        ) : identity.loading ? (
          <p role="status">Verificando sessão…</p>
        ) : (
          <>
            {identity.error && (
              <p role="alert" className="error-banner">
                {identity.error}
                <Button
                  variant="outline"
                  onClick={() =>
                    retrySession.current ? retrySession.current() : window.location.reload()
                  }
                >
                  Verificar sessão novamente
                </Button>
              </p>
            )}
            {identity.user ? (
              <AuthenticatedAccount
                key={identity.user.id}
                user={identity.user}
                recovery={recovery}
                onUpdated={() => setRecovery(false)}
              />
            ) : (
              <AuthForm />
            )}
          </>
        )}
      </section>
    </main>
  )
}

function AuthForm() {
  const [mode, setMode] = useState<'login' | 'signup' | 'recover'>('login')
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      if (mode === 'login') await remoteAuth.signIn(email, password)
      else if (mode === 'signup') {
        await remoteAuth.signUp(email, password)
        setMessage(
          'Se o cadastro puder ser concluído, você receberá instruções por e-mail. Confira sua caixa de entrada.',
        )
      } else {
        await remoteAuth.recover(email)
        setMessage('Se houver uma conta para este e-mail, você receberá um link de recuperação.')
      }
      setPassword('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível concluir a autenticação.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <div className="dialog-actions">
        {(['login', 'signup', 'recover'] as const).map((value) => (
          <Button
            key={value}
            variant={mode === value ? 'default' : 'outline'}
            disabled={busy}
            onClick={() => {
              setMode(value)
              setPassword('')
              setError('')
              setMessage('')
            }}
          >
            {value === 'login' ? 'Entrar' : value === 'signup' ? 'Cadastrar' : 'Recuperar senha'}
          </Button>
        ))}
      </div>
      <form className="account-form" onSubmit={submit}>
        <label>
          E-mail
          <input
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        {mode !== 'recover' && (
          <label>
            Senha
            <input
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              required
              minLength={mode === 'signup' ? 12 : 1}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        <Button disabled={busy} type="submit">
          {busy
            ? 'Aguarde…'
            : mode === 'login'
              ? 'Entrar'
              : mode === 'signup'
                ? 'Criar conta'
                : 'Enviar recuperação'}
        </Button>
      </form>
    </>
  )
}

function AuthenticatedAccount({
  user,
  recovery,
  onUpdated,
}: {
  user: User
  recovery: boolean
  onUpdated: () => void
}) {
  const [password, setPassword] = useState(''),
    [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('')
  async function action(update: boolean) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      if (update) {
        if (password !== confirmation) throw new Error('As senhas devem ser iguais.')
        await remoteAuth.updatePassword(password)
        setPassword('')
        setConfirmation('')
        setMessage('Senha atualizada.')
        onUpdated()
      } else await remoteAuth.signOut()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível concluir a operação.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <h2>{recovery ? 'Definir nova senha' : 'Sessão autenticada'}</h2>
      <p>{user.email}</p>
      <p>A sincronização financeira ainda não está disponível.</p>
      <form
        className="account-form"
        onSubmit={(e) => {
          e.preventDefault()
          void action(true)
        }}
      >
        <label>
          Nova senha
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          Confirmar nova senha
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
        </label>
        <Button disabled={busy} type="submit">
          Atualizar senha
        </Button>
      </form>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <Button variant="outline" disabled={busy} onClick={() => void action(false)}>
        Sair da conta online
      </Button>
    </>
  )
}
