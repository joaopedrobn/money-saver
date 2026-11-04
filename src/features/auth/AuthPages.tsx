import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  ArrowLeft,
  Check,
  CheckCheck,
  Eye,
  EyeOff,
  LoaderCircle,
  Mail,
  ShieldCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { passwordRequirements, validateNewPassword } from '@/domain/auth-validation'
import { remoteAuth, UnconfirmedEmailError } from '@/infrastructure/supabase/auth'
import {
  cooldownSeconds,
  maskEmail,
  readProgress,
  saveProgress,
  startEmailCooldown,
  type AuthRoute,
} from './access-state'

export type Navigate = (route: AuthRoute, replace?: boolean) => void
export function AuthLink({
  to,
  navigate,
  children,
  disabled = false,
}: {
  to: AuthRoute
  navigate: Navigate
  children: ReactNode
  disabled?: boolean
}) {
  return (
    <a
      href={to}
      aria-disabled={disabled || undefined}
      onClick={(event) => {
        if (disabled) {
          event.preventDefault()
          return
        }
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
          return
        event.preventDefault()
        navigate(to)
      }}
    >
      {children}
    </a>
  )
}

const titles: Record<AuthRoute, string> = {
  '/': 'Visão geral',
  '/login': 'Entrar',
  '/cadastro': 'Criar conta',
  '/verificar-email': 'Verificar e-mail',
  '/recuperar-senha': 'Recuperar senha',
  '/redefinir-senha': 'Redefinir senha',
  '/conta': 'Sua conta',
}
export function AuthLayout({
  route,
  navigate,
  children,
}: {
  route: AuthRoute
  navigate: Navigate
  children: ReactNode
}) {
  const heading = useRef<HTMLDivElement>(null)
  useEffect(() => {
    document.title = `${titles[route]} · Money Saver`
    heading.current?.focus({ preventScroll: true })
  }, [route])
  return (
    <main className="auth-page">
      <header className="auth-header">
        <AuthLink to="/login" navigate={navigate}>
          <span className="auth-brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32">
              <path d="M7 23V9l9 8 9-8v14" />
            </svg>
          </span>
          <span>
            money<span className="auth-brand-light">saver</span>
            <span className="auth-brand-dot">.</span>
          </span>
        </AuthLink>
      </header>
      <div className="auth-stage">
        <div className="auth-surface" key={route} ref={heading} tabIndex={-1}>
          {children}
        </div>
      </div>
      <footer className="auth-footer">
        <ShieldCheck size={14} aria-hidden="true" />
        <span>Seus dados, sob seu controle.</span>
      </footer>
    </main>
  )
}

function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const locked = useRef(false)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  async function run(
    task: () => Promise<void>,
    success?: () => void,
    failure?: (error: unknown) => void,
  ) {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setError('')
    try {
      await task()
      if (active.current) success?.()
    } catch (error) {
      if (active.current) {
        setError(
          error instanceof Error ? error.message : 'Não foi possível concluir. Tente novamente.',
        )
        failure?.(error)
      }
    } finally {
      locked.current = false
      if (active.current) setBusy(false)
    }
  }
  return { busy, error, run }
}

function useEmailCooldown() {
  const [seconds, setSeconds] = useState(cooldownSeconds)
  const fallbackUntil = useRef(0)
  useEffect(() => {
    const timer = window.setInterval(
      () =>
        setSeconds(
          Math.max(
            cooldownSeconds(),
            Math.max(0, Math.ceil((fallbackUntil.current - Date.now()) / 1000)),
          ),
        ),
      500,
    )
    return () => window.clearInterval(timer)
  }, [])
  function reserve() {
    if (cooldownSeconds() || fallbackUntil.current > Date.now())
      throw new Error('Aguarde um minuto antes de solicitar outro e-mail.')
    startEmailCooldown()
    fallbackUntil.current = Date.now() + 60_000
    setSeconds(60)
  }
  return { seconds, reserve }
}

function Feedback({ error }: { error: string }) {
  return error ? (
    <p className="auth-feedback is-error" role="alert">
      {error}
    </p>
  ) : null
}
function Submit({
  busy,
  disabled,
  children,
}: {
  busy: boolean
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <Button className="auth-submit" type="submit" disabled={busy || disabled} aria-busy={busy}>
      {busy && <LoaderCircle size={17} className="spin" aria-hidden="true" />}
      {busy ? 'Aguarde…' : children}
    </Button>
  )
}
function EmailField({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  return (
    <label className="auth-field" htmlFor="auth-email">
      <span>E-mail</span>
      <input
        id="auth-email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        placeholder="voce@exemplo.com"
        required
        maxLength={254}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        autoCapitalize="none"
        spellCheck={false}
      />
    </label>
  )
}
function PasswordField({
  value,
  onChange,
  confirm = false,
  current = false,
  busy = false,
  children,
}: {
  value: string
  onChange: (value: string) => void
  confirm?: boolean
  current?: boolean
  busy?: boolean
  children?: ReactNode
}) {
  const [visible, setVisible] = useState(false)
  const id = confirm ? 'auth-confirmation' : 'auth-password'
  return (
    <div className="auth-field">
      <div className="auth-label-row">
        <label htmlFor={id}>{confirm ? 'Confirmar senha' : 'Senha'}</label>
        {children}
      </div>
      <div className="auth-password">
        <input
          id={id}
          name={confirm ? 'password-confirmation' : 'password'}
          type={visible ? 'text' : 'password'}
          autoComplete={current ? 'current-password' : 'new-password'}
          required
          minLength={current ? 1 : 12}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={busy}
          aria-describedby={!current && !confirm ? 'password-requirements' : undefined}
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          aria-label={`${visible ? 'Ocultar' : 'Mostrar'} ${confirm ? 'confirmação de senha' : 'senha'}`}
          aria-pressed={visible}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </div>
  )
}
function PasswordRules({ password }: { password: string }) {
  return (
    <ul className="auth-password-rules" id="password-requirements" aria-label="Requisitos da senha">
      {passwordRequirements.map(({ label, test }) => (
        <li key={label} className={test(password) ? 'is-met' : ''}>
          <Check size={12} aria-hidden="true" />
          <span>{label}</span>
          <span className="sr-only">{test(password) ? ', atendido' : ', necessário'}</span>
        </li>
      ))}
    </ul>
  )
}

export function AuthPages({
  route,
  navigate,
  disabled,
  canReset,
  onPasswordUpdated,
}: {
  route: AuthRoute
  navigate: Navigate
  disabled: boolean
  canReset: boolean
  onPasswordUpdated: () => void
}) {
  if (route === '/cadastro') return <SignupPage navigate={navigate} disabled={disabled} />
  if (route === '/verificar-email')
    return <VerifyEmailPage navigate={navigate} disabled={disabled} />
  if (route === '/recuperar-senha') return <RecoverPage navigate={navigate} disabled={disabled} />
  if (route === '/redefinir-senha')
    return (
      <ResetPage
        navigate={navigate}
        disabled={disabled}
        canReset={canReset}
        onPasswordUpdated={onPasswordUpdated}
      />
    )
  return <LoginPage navigate={navigate} disabled={disabled} />
}

function LoginPage({ navigate, disabled }: { navigate: Navigate; disabled: boolean }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [unconfirmed, setUnconfirmed] = useState(false)
  const action = useAction()
  function submit(event: FormEvent) {
    event.preventDefault()
    if (disabled) return
    setUnconfirmed(false)
    void action.run(
      () => remoteAuth.signIn(email, password),
      () => {
        setPassword('')
        navigate('/', true)
      },
      (error) => {
        if (error instanceof UnconfirmedEmailError) setUnconfirmed(true)
      },
    )
  }
  return (
    <>
      <h1>Entre na sua conta</h1>
      <p className="auth-subtitle">Acesse seu espaço no Money Saver.</p>
      <form className="auth-form" onSubmit={submit} aria-busy={action.busy}>
        <EmailField value={email} onChange={setEmail} disabled={action.busy} />
        <PasswordField value={password} onChange={setPassword} current busy={action.busy}>
          <AuthLink to="/recuperar-senha" navigate={navigate} disabled={action.busy}>
            Esqueceu sua senha?
          </AuthLink>
        </PasswordField>
        <Feedback error={action.error} />
        {unconfirmed && (
          <button
            type="button"
            className="auth-inline-link"
            onClick={() => {
              saveProgress({ email: email.trim(), kind: 'signup' })
              navigate('/verificar-email')
            }}
          >
            Solicitar novo link de confirmação
          </button>
        )}
        <Submit busy={action.busy} disabled={disabled}>
          Entrar
        </Submit>
      </form>
      <p className="auth-switch">
        Não tem uma conta?{' '}
        <AuthLink to="/cadastro" navigate={navigate} disabled={action.busy}>
          Criar conta
        </AuthLink>
      </p>
    </>
  )
}

function SignupPage({ navigate, disabled }: { navigate: Navigate; disabled: boolean }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const action = useAction()
  const cooldown = useEmailCooldown()
  function submit(event: FormEvent) {
    event.preventDefault()
    if (disabled) return
    void action.run(
      async () => {
        validateNewPassword(password, confirmation)
        cooldown.reserve()
        await remoteAuth.signUp(email, password)
      },
      () => {
        saveProgress({ email: email.trim(), kind: 'signup', sent: true })
        setPassword('')
        setConfirmation('')
        navigate('/verificar-email')
      },
    )
  }
  return (
    <>
      <h1>Crie sua conta</h1>
      <p className="auth-subtitle">Comece com seu e-mail e uma senha segura.</p>
      <form className="auth-form" onSubmit={submit} aria-busy={action.busy}>
        <EmailField value={email} onChange={setEmail} disabled={action.busy} />
        <PasswordField value={password} onChange={setPassword} busy={action.busy} />
        <PasswordRules password={password} />
        <PasswordField value={confirmation} onChange={setConfirmation} confirm busy={action.busy} />
        <Feedback error={action.error} />
        <Submit busy={action.busy} disabled={disabled || cooldown.seconds > 0}>
          Criar conta
        </Submit>
        {cooldown.seconds > 0 && (
          <p className="auth-caption" role="status">
            Uma nova solicitação estará disponível em {cooldown.seconds}s.
          </p>
        )}
      </form>
      <p className="auth-switch">
        Já tem uma conta?{' '}
        <AuthLink to="/login" navigate={navigate} disabled={action.busy}>
          Entrar
        </AuthLink>
      </p>
    </>
  )
}

function VerifyEmailPage({ navigate, disabled }: { navigate: Navigate; disabled: boolean }) {
  const [progress] = useState(readProgress)
  const [email, setEmail] = useState(progress?.kind === 'signup' ? progress.email : '')
  const [sent, setSent] = useState(false)
  const [requested] = useState(progress?.kind === 'signup' && progress.sent === true)
  const delivered = requested || sent
  const action = useAction()
  const cooldown = useEmailCooldown()
  function resend(event: FormEvent) {
    event.preventDefault()
    if (disabled) return
    void action.run(
      async () => {
        cooldown.reserve()
        await remoteAuth.resendConfirmation(email)
      },
      () => {
        saveProgress({ email: email.trim(), kind: 'signup', sent: true })
        setSent(true)
      },
    )
  }
  return (
    <>
      <span className="auth-state-icon">
        <Mail size={25} strokeWidth={1.6} aria-hidden="true" />
      </span>
      <h1>Verifique seu e-mail</h1>
      <p className="auth-subtitle">
        {delivered ? (
          <>
            Enviamos as instruções de confirmação para <strong>{maskEmail(email)}</strong>. Abra o
            link para continuar.
          </>
        ) : (
          'Solicite um novo link para confirmar seu e-mail.'
        )}
      </p>
      <p className="auth-help">
        Não encontrou a mensagem? Confira também a pasta de spam. Abra o link no mesmo navegador em
        que fez a solicitação.
      </p>
      <form className="auth-form" onSubmit={resend} aria-busy={action.busy}>
        {!delivered && <EmailField value={email} onChange={setEmail} disabled={action.busy} />}
        <Feedback error={action.error} />
        {sent && (
          <p role="status" className="auth-feedback">
            Se houver uma confirmação pendente, você receberá um novo link.
          </p>
        )}
        <Submit busy={action.busy} disabled={disabled || cooldown.seconds > 0}>
          {cooldown.seconds ? `Reenviar em ${cooldown.seconds}s` : 'Reenviar e-mail'}
        </Submit>
      </form>
      <p className="auth-back">
        <AuthLink to="/login" navigate={navigate} disabled={action.busy}>
          <ArrowLeft size={15} />
          Voltar para entrar
        </AuthLink>
      </p>
    </>
  )
}

function RecoverPage({ navigate, disabled }: { navigate: Navigate; disabled: boolean }) {
  const [progress] = useState(readProgress)
  const [email, setEmail] = useState(progress?.kind === 'recover' ? progress.email : '')
  const [sent, setSent] = useState(progress?.kind === 'recover' && progress.sent === true)
  const action = useAction()
  const cooldown = useEmailCooldown()
  function submit(event: FormEvent) {
    event.preventDefault()
    if (disabled) return
    void action.run(
      async () => {
        cooldown.reserve()
        await remoteAuth.recover(email)
      },
      () => {
        saveProgress({ email: email.trim(), kind: 'recover', sent: true })
        setSent(true)
      },
    )
  }
  return (
    <>
      {sent && (
        <span className="auth-state-icon">
          <Mail size={25} aria-hidden="true" />
        </span>
      )}
      <h1>{sent ? 'Confira seu e-mail' : 'Esqueceu sua senha?'}</h1>
      <p className="auth-subtitle">
        {sent ? (
          <>
            Se houver uma conta para <strong>{maskEmail(email)}</strong>, você receberá um link para
            redefinir a senha.
          </>
        ) : (
          'Informe seu e-mail para receber um link de recuperação.'
        )}
      </p>
      {sent && (
        <p className="auth-help">
          Confira a caixa de entrada e o spam. Abra o link neste mesmo navegador para criar uma nova
          senha.
        </p>
      )}
      <form className="auth-form" onSubmit={submit} aria-busy={action.busy}>
        {!sent && <EmailField value={email} onChange={setEmail} disabled={action.busy} />}
        <Feedback error={action.error} />
        <Submit busy={action.busy} disabled={disabled || cooldown.seconds > 0}>
          {cooldown.seconds
            ? `Enviar novamente em ${cooldown.seconds}s`
            : sent
              ? 'Enviar novamente'
              : 'Enviar link de recuperação'}
        </Submit>
      </form>
      <p className="auth-back">
        <AuthLink to="/login" navigate={navigate} disabled={action.busy}>
          <ArrowLeft size={15} />
          Voltar para entrar
        </AuthLink>
      </p>
    </>
  )
}

function ResetPage({
  navigate,
  disabled,
  canReset,
  onPasswordUpdated,
}: {
  navigate: Navigate
  disabled: boolean
  canReset: boolean
  onPasswordUpdated: () => void
}) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [updated, setUpdated] = useState(false)
  const action = useAction()
  function submit(event: FormEvent) {
    event.preventDefault()
    if (disabled || !canReset) return
    void action.run(
      async () => {
        validateNewPassword(password, confirmation)
        await remoteAuth.updatePassword(password)
      },
      () => {
        setPassword('')
        setConfirmation('')
        setUpdated(true)
        onPasswordUpdated()
      },
    )
  }
  if (updated)
    return (
      <>
        <span className="auth-state-icon">
          <CheckCheck size={26} aria-hidden="true" />
        </span>
        <h1>Senha atualizada</h1>
        <p className="auth-subtitle" role="status">
          Sua nova senha foi salva. Você já pode continuar.
        </p>
        <Button className="auth-submit" onClick={() => navigate('/', true)}>
          Continuar
        </Button>
      </>
    )
  if (!canReset)
    return (
      <>
        <span className="auth-state-icon">
          <ShieldCheck size={25} aria-hidden="true" />
        </span>
        <h1>{disabled ? 'Verificando seu link' : 'Solicite um novo link'}</h1>
        <p className="auth-subtitle">
          {disabled
            ? 'Aguarde enquanto verificamos o acesso para redefinir sua senha.'
            : 'Para criar uma nova senha, abra um link de recuperação válido no mesmo navegador em que fez a solicitação.'}
        </p>
        <p className="auth-back">
          <AuthLink to="/recuperar-senha" navigate={navigate}>
            Solicitar link de recuperação
          </AuthLink>
        </p>
      </>
    )
  return (
    <>
      <h1>Crie uma nova senha</h1>
      <p className="auth-subtitle">Escolha uma senha segura para sua conta.</p>
      <form className="auth-form" onSubmit={submit} aria-busy={action.busy}>
        <PasswordField value={password} onChange={setPassword} busy={action.busy} />
        <PasswordRules password={password} />
        <PasswordField value={confirmation} onChange={setConfirmation} confirm busy={action.busy} />
        <Feedback error={action.error} />
        <Submit busy={action.busy} disabled={disabled}>
          Salvar nova senha
        </Submit>
      </form>
    </>
  )
}
