export const authRoutes = [
  '/',
  '/login',
  '/cadastro',
  '/verificar-email',
  '/recuperar-senha',
  '/redefinir-senha',
  '/conta',
] as const
export type AuthRoute = (typeof authRoutes)[number]
/** Routing consumes only the existing server-verified observer state. */
export function entryDestination({
  route,
  local,
  userId,
  loading,
  canReset,
}: {
  route: AuthRoute
  local: boolean
  userId?: string
  loading: boolean
  canReset: boolean
}): AuthRoute {
  if (canReset) return '/redefinir-senha'
  if (local) return '/'
  if (route === '/redefinir-senha' || route === '/recuperar-senha') return route
  if (loading) return route === '/' || route === '/conta' ? '/login' : route
  if (userId) return '/'
  return route === '/' || route === '/conta' ? '/login' : route
}
export const localModeKey = 'money-saver-local-mode'
export const recoveryKey = 'money-saver-password-recovery'
const progressKey = 'money-saver-auth-progress'
const cooldownKey = 'money-saver-email-cooldown'
export const EMAIL_COOLDOWN_MS = 60_000
export interface RecoveryGrant {
  userId: string
  until: number
}
export interface EmailProgress {
  email: string
  kind: 'signup' | 'recover'
  sent?: boolean
}

// UI progress only: never passwords, tokens or financial records.
export function readPreference(key: string) {
  try {
    return window.sessionStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}
export function writePreference(key: string, value: string | null) {
  try {
    if (value === null) window.sessionStorage?.removeItem(key)
    else window.sessionStorage?.setItem(key, value)
  } catch {
    /* Local mode and Auth remain available when storage is blocked. */
  }
}
export function readProgress(): EmailProgress | null {
  try {
    const value = JSON.parse(readPreference(progressKey) ?? 'null') as EmailProgress | null
    return value &&
      ['signup', 'recover'].includes(value.kind) &&
      typeof value.email === 'string' &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)
      ? value
      : null
  } catch {
    return null
  }
}
export const saveProgress = (value: EmailProgress | null) =>
  writePreference(progressKey, value ? JSON.stringify(value) : null)
export function readRecovery(): RecoveryGrant | null {
  try {
    const value = JSON.parse(readPreference(recoveryKey) ?? 'null') as RecoveryGrant | null
    return value &&
      typeof value.userId === 'string' &&
      Number.isFinite(value.until) &&
      value.until > Date.now()
      ? value
      : null
  } catch {
    return null
  }
}
export function validRecovery(grant: RecoveryGrant | null, userId?: string) {
  return !!grant && grant.userId === userId && grant.until > Date.now()
}
export function cooldownSeconds(now = Date.now()) {
  const until = Number(readPreference(cooldownKey))
  return Number.isFinite(until)
    ? Math.max(0, Math.ceil(Math.min(until - now, EMAIL_COOLDOWN_MS) / 1000))
    : 0
}
export const startEmailCooldown = () =>
  writePreference(cooldownKey, String(Date.now() + EMAIL_COOLDOWN_MS))
export function maskEmail(email: string) {
  const [name, domain] = email.split('@')
  return domain ? `${name.slice(0, 1)}•••@${domain}` : ''
}
export function routeFromUrl(url: string): AuthRoute {
  const path = new URL(url).pathname
  return authRoutes.find((route) => route === path) ?? '/login'
}

export function authCallback(url: string) {
  const parsed = new URL(url)
  const fragment = new URLSearchParams(parsed.hash.slice(1))
  const failed =
    parsed.searchParams.has('error') || fragment.has('error') || fragment.has('error_code')
  return {
    present: failed || parsed.searchParams.has('code') || fragment.has('access_token'),
    error: failed
      ? 'O link de confirmação ou recuperação é inválido ou expirou. Solicite um novo link.'
      : '',
  }
}
