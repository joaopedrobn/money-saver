export const passwordRequirements = [
  { label: '12 caracteres ou mais', test: (value: string) => value.length >= 12 },
  { label: 'Uma letra maiúscula', test: (value: string) => /[A-Z]/.test(value) },
  { label: 'Uma letra minúscula', test: (value: string) => /[a-z]/.test(value) },
  { label: 'Um número', test: (value: string) => /[0-9]/.test(value) },
  { label: 'Um símbolo', test: (value: string) => /[^\p{L}\p{N}\s]/u.test(value) },
]

export function validateNewPassword(password: string, confirmation?: string) {
  if (password.length < 12) throw new Error('Use uma senha com pelo menos 12 caracteres.')
  if (passwordRequirements.some((requirement) => !requirement.test(password)))
    throw new Error('Inclua letras maiúsculas, minúsculas, números e um símbolo na senha.')
  if (confirmation !== undefined && password !== confirmation)
    throw new Error('As senhas não coincidem. Confira a confirmação.')
}
