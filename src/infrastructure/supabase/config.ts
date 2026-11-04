export type AuthConfig =
  | { enabled: false; error: string }
  | {
      enabled: true
      url: string
      publishableKey: string
      redirectUrl: string
      error: ''
    }
export function authConfig(env: Record<string, unknown>, appUrl: string): AuthConfig {
  if (env.VITE_SUPABASE_AUTH_ENABLED !== 'true') return { enabled: false, error: '' }
  try {
    const url = new URL(String(env.VITE_SUPABASE_URL ?? ''))
    const redirect = new URL(String(env.VITE_SUPABASE_AUTH_REDIRECT_URL ?? ''))
    const app = new URL(appUrl)
    const local = (u: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
    if (
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && local(url))) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      throw new Error()
    if (
      redirect.origin !== app.origin ||
      (redirect.pathname !== app.pathname &&
        !(
          redirect.pathname === '/' &&
          [
            '/login',
            '/cadastro',
            '/verificar-email',
            '/recuperar-senha',
            '/redefinir-senha',
            '/conta',
          ].includes(app.pathname)
        )) ||
      redirect.search ||
      redirect.hash ||
      redirect.username ||
      redirect.password ||
      (redirect.protocol !== 'https:' && !(redirect.protocol === 'http:' && local(redirect)))
    )
      throw new Error()
    const publishableKey = String(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '')
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) throw new Error()
    return { enabled: true, url: url.origin, publishableKey, redirectUrl: redirect.href, error: '' }
  } catch {
    return {
      enabled: false,
      error:
        'Autenticação remota desativada: confira URL, chave publishable e endereço de retorno da aplicação.',
    }
  }
}

/** Configuration or login can never switch the active financial backend in phase 3.1. */
export function selectPersistenceBackend(requested: string = 'local'): 'local' {
  if (requested !== 'local')
    throw new Error('Persistência remota indisponível nesta fase. Os dados continuam locais.')
  return 'local'
}
