import { afterEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RemoteAccess } from './RemoteAccess'
import {
  authCallback,
  localModeKey,
  saveProgress,
  startEmailCooldown,
  cooldownSeconds,
  validRecovery,
  entryDestination,
  type AuthRoute,
} from './access-state'

afterEach(() => vi.unstubAllGlobals())

function screen(hash = '', query = '', path = '/') {
  vi.stubGlobal('window', {
    location: { href: `http://127.0.0.1:5173${path}${query}${hash}`, hash },
  })
  function BrowserFinances(): never {
    throw new Error('Anonymous financial workspace must not mount before an explicit local choice')
  }
  return renderToStaticMarkup(
    createElement(RemoteAccess, { children: createElement(BrowserFinances) }),
  )
}

it('renders login with a secondary local choice without mounting browser finances or requiring Auth', () => {
  const html = screen()
  expect(html).toContain('Entre na sua conta')
  expect(html).toContain('Continuar sem conta')
  expect(html).toContain('href="/cadastro"')
  expect(html).not.toMatch(/IndexedDB|Supabase|RLS/)
  expect(html).not.toContain('class="avatar')
})

it('keeps connected and callback routes separate from anonymous financial data', () => {
  expect(screen('#online')).toContain('Entre na sua conta')
  expect(screen('', '?code=test')).toContain('Entre na sua conta')
  expect(screen('#error=access_denied')).toContain('inválido ou expirou')
})

it('renders independent signup, recovery and verification routes and guards direct reset access', () => {
  const signup = screen('', '', '/cadastro')
  expect(signup).toContain('Confirmar senha')
  expect(signup.match(/<input /g)).toHaveLength(3)
  expect(signup).not.toContain('Esqueceu sua senha?')
  const recover = screen('', '', '/recuperar-senha')
  expect(recover).toContain('Enviar link de recuperação')
  expect(recover).not.toContain('type="password"')
  const verify = screen('', '', '/verificar-email')
  expect(verify).toContain('Verifique seu e-mail')
  expect(verify).not.toContain('type="password"')
  const reset = screen('', '', '/redefinir-senha')
  expect(reset).toContain('Solicitar link de recuperação')
  expect(reset).not.toContain('type="password"')
})

function browserStorage(path: string) {
  const entries = new Map<string, string>()
  vi.stubGlobal('window', {
    location: { href: `http://127.0.0.1:5173${path}` },
    sessionStorage: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
      removeItem: (key: string) => entries.delete(key),
    },
  })
  return entries
}

it('keeps an explicit local choice across reloads without treating it as an authenticated dataset', () => {
  browserStorage('/#accounts').set(localModeKey, 'true')
  const html = renderToStaticMarkup(
    createElement(RemoteAccess, { children: createElement('p', {}, 'local-finances') }),
  )
  expect(html).toContain('local-finances')
  expect(html).not.toContain('Entre na sua conta')
})

it('masks pending email, persists resend cooldown across refresh, and rejects expired or foreign recovery grants', () => {
  browserStorage('/verificar-email')
  saveProgress({ email: 'person@example.invalid', kind: 'signup', sent: true })
  startEmailCooldown()
  const html = renderToStaticMarkup(createElement(RemoteAccess, { children: null }))
  expect(html).toContain('p•••@example.invalid')
  expect(html).not.toContain('person@example.invalid')
  expect(html).toContain('Reenviar em 60s')
  expect(cooldownSeconds(Date.now() + 61_000)).toBe(0)
  expect(validRecovery({ userId: 'a', until: Date.now() + 1000 }, 'b')).toBe(false)
  expect(validRecovery({ userId: 'a', until: Date.now() - 1 }, 'a')).toBe(false)
})

it('recognizes confirmation/recovery callbacks and reports invalid links without reflecting provider text', () => {
  expect(authCallback('http://127.0.0.1:5173/?code=test').present).toBe(true)
  expect(
    authCallback('http://127.0.0.1:5173/#error=access_denied&error_description=secret').error,
  ).toContain('expirou')
  expect(authCallback('http://127.0.0.1:5173/?error=denied').present).toBe(true)
  expect(authCallback('http://127.0.0.1:5173/#dashboard').present).toBe(false)
})

it('enters the dashboard only with a verified session, including login, confirmation and reload', () => {
  for (const route of ['/', '/login', '/cadastro', '/verificar-email', '/conta'] as AuthRoute[]) {
    expect(
      entryDestination({
        route,
        local: false,
        userId: 'verified',
        loading: false,
        canReset: false,
      }),
    ).toBe('/')
  }
  expect(entryDestination({ route: '/', local: false, loading: true, canReset: false })).toBe(
    '/login',
  )
  expect(entryDestination({ route: '/', local: false, loading: false, canReset: false })).toBe(
    '/login',
  )
  expect(entryDestination({ route: '/', local: true, loading: true, canReset: false })).toBe('/')
})

it('keeps valid recovery and password-update confirmation ahead of the authenticated dashboard', () => {
  expect(
    entryDestination({
      route: '/',
      local: false,
      userId: 'verified',
      loading: false,
      canReset: true,
    }),
  ).toBe('/redefinir-senha')
  expect(
    entryDestination({
      route: '/redefinir-senha',
      local: false,
      userId: 'verified',
      loading: false,
      canReset: false,
    }),
  ).toBe('/redefinir-senha')
})
