import { getAuthClient, remoteAuthConfig } from './client'
import { validateNewPassword } from '@/domain/auth-validation'

export class UnconfirmedEmailError extends Error {
  constructor() {
    super('Confirme seu e-mail antes de entrar. Você pode solicitar um novo link.')
  }
}
function rateLimit(error: { status?: number; code?: string } | null) {
  if (
    error?.status === 429 ||
    error?.code === 'over_email_send_rate_limit' ||
    error?.code === 'over_request_rate_limit'
  )
    throw new Error('Muitas tentativas. Aguarde um minuto antes de tentar novamente.')
}
async function auth() {
  const client = await getAuthClient()
  if (!client) throw new Error('Autenticação remota não configurada.')
  return client.auth
}
function redirectUrl() {
  const config = remoteAuthConfig()
  if (!config.enabled) throw new Error('Autenticação remota não configurada.')
  return config.redirectUrl
}
function credentials(email: string, password?: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Error('Informe um e-mail válido.')
  if (password !== undefined) validateNewPassword(password)
}
export const remoteAuth = {
  async signUp(email: string, password: string) {
    credentials(email, password)
    const { error } = await (
      await auth()
    ).signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: redirectUrl() },
    })
    rateLimit(error)
    if (error)
      throw new Error('Não foi possível cadastrar. Confira os dados ou tente novamente mais tarde.')
  },
  async signIn(email: string, password: string) {
    credentials(email)
    const { error } = await (await auth()).signInWithPassword({ email: email.trim(), password })
    if (error?.code === 'email_not_confirmed') throw new UnconfirmedEmailError()
    rateLimit(error)
    if (error)
      throw new Error(
        'Não foi possível entrar. Confira as credenciais ou tente novamente mais tarde.',
      )
  },
  async resendConfirmation(email: string) {
    credentials(email)
    const { error } = await (
      await auth()
    ).resend({
      type: 'signup',
      email: email.trim(),
      options: { emailRedirectTo: redirectUrl() },
    })
    rateLimit(error)
    if (error)
      throw new Error('Não foi possível reenviar a confirmação. Aguarde e tente novamente.')
  },
  async signOut() {
    const { error } = await (await auth()).signOut({ scope: 'local' })
    if (error) throw new Error('Não foi possível sair da sessão remota. Tente novamente.')
  },
  async recover(email: string) {
    credentials(email)
    const { error } = await (
      await auth()
    ).resetPasswordForEmail(email.trim(), {
      redirectTo: redirectUrl(),
    })
    rateLimit(error)
    if (error) throw new Error('Não foi possível enviar a recuperação. Tente novamente mais tarde.')
  },
  async updatePassword(password: string) {
    validateNewPassword(password)
    const { error } = await (await auth()).updateUser({ password })
    if (error)
      throw new Error('Não foi possível atualizar a senha. Solicite um novo link de recuperação.')
  },
}
