import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  auth: {
    signUp: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    updateUser: vi.fn(),
    resend: vi.fn(),
  },
  getClient: vi.fn(),
  config: vi.fn(),
}))
vi.mock('./client', () => ({ getAuthClient: mocks.getClient, remoteAuthConfig: mocks.config }))
import { remoteAuth } from './auth'
import { validateNewPassword } from '@/domain/auth-validation'
const setup = () => {
  mocks.getClient.mockResolvedValue({ auth: mocks.auth })
  mocks.config.mockReturnValue({ enabled: true, redirectUrl: 'http://127.0.0.1:5173/' })
  for (const call of Object.values(mocks.auth)) call.mockResolvedValue({ error: null })
}
afterEach(() => vi.resetAllMocks())

it('rejects invalid email and weak signup/password updates before calling Auth', async () => {
  setup()
  await expect(remoteAuth.signUp('invalid', 'long-password')).rejects.toThrow('e-mail')
  await expect(remoteAuth.signUp('test@example.invalid', 'short')).rejects.toThrow('12')
  await expect(remoteAuth.updatePassword('short')).rejects.toThrow('12')
  for (const password of [
    'longlowercase123!',
    'LONGUPPERCASE123!',
    'NoNumbersHere!!',
    'NoSymbolsHere123',
  ])
    await expect(remoteAuth.signUp('test@example.invalid', password)).rejects.toThrow('Inclua')
  expect(mocks.getClient).not.toHaveBeenCalled()
  expect(() => validateNewPassword('Test-only-password1!', 'Different-password1!')).toThrow(
    'não coincidem',
  )
})
it('sends the exact allowed callback for signup and recovery and signs out this browser only', async () => {
  setup()
  await remoteAuth.signUp(' test@example.invalid ', 'Test-only-password1!')
  expect(mocks.auth.signUp).toHaveBeenCalledWith({
    email: 'test@example.invalid',
    password: 'Test-only-password1!',
    options: { emailRedirectTo: 'http://127.0.0.1:5173/' },
  })
  await remoteAuth.recover('test@example.invalid')
  expect(mocks.auth.resetPasswordForEmail).toHaveBeenCalledWith('test@example.invalid', {
    redirectTo: 'http://127.0.0.1:5173/',
  })
  await remoteAuth.signOut()
  expect(mocks.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  await remoteAuth.resendConfirmation(' test@example.invalid ')
  expect(mocks.auth.resend).toHaveBeenCalledWith({
    type: 'signup',
    email: 'test@example.invalid',
    options: { emailRedirectTo: 'http://127.0.0.1:5173/' },
  })
})
it('handles login, server errors and missing configuration without exposing provider details', async () => {
  setup()
  await remoteAuth.signIn('test@example.invalid', 'Test-only-password1!')
  expect(mocks.auth.signInWithPassword).toHaveBeenCalledWith({
    email: 'test@example.invalid',
    password: 'Test-only-password1!',
  })
  mocks.auth.signInWithPassword.mockResolvedValue({
    error: { message: 'private-provider-details' },
  })
  await expect(remoteAuth.signIn('test@example.invalid', 'Test-only-password1!')).rejects.toThrow(
    'Não foi possível entrar',
  )
  mocks.auth.resend.mockResolvedValue({
    error: { status: 429, message: 'private-provider-details' },
  })
  await expect(remoteAuth.resendConfirmation('test@example.invalid')).rejects.toThrow(
    'Aguarde um minuto',
  )
  mocks.getClient.mockResolvedValue(null)
  await expect(remoteAuth.signOut()).rejects.toThrow('não configurada')
})
it('guides unconfirmed users to the real confirmation flow', async () => {
  setup()
  mocks.auth.signInWithPassword.mockResolvedValue({ error: { code: 'email_not_confirmed' } })
  await expect(remoteAuth.signIn('test@example.invalid', 'Test-only-password1!')).rejects.toThrow(
    'Confirme seu e-mail',
  )
})
