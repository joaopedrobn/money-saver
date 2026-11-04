import { getAuthClient, remoteAuthConfig } from './client'
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
  if (password !== undefined && password.length < 12)
    throw new Error('Use uma senha com pelo menos 12 caracteres.')
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
    if (error)
      throw new Error('Não foi possível cadastrar. Confira os dados ou tente novamente mais tarde.')
  },
  async signIn(email: string, password: string) {
    credentials(email)
    const { error } = await (await auth()).signInWithPassword({ email: email.trim(), password })
    if (error)
      throw new Error(
        'Não foi possível entrar. Confira as credenciais ou tente novamente mais tarde.',
      )
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
    if (error) throw new Error('Não foi possível enviar a recuperação. Tente novamente mais tarde.')
  },
  async updatePassword(password: string) {
    if (password.length < 12) throw new Error('Use uma senha com pelo menos 12 caracteres.')
    const { error } = await (await auth()).updateUser({ password })
    if (error)
      throw new Error('Não foi possível atualizar a senha. Solicite um novo link de recuperação.')
  },
}
