import type { Category } from './models'
const expenses = [
  ['Alimentação', 'coffee'],
  ['Moradia', 'home'],
  ['Transporte', 'car'],
  ['Saúde', 'heart'],
  ['Educação', 'book'],
  ['Compras', 'shopping'],
  ['Lazer', 'gift'],
  ['Assinaturas', 'repeat'],
  ['Contas e serviços', 'home'],
  ['Outros', 'tag'],
]
const incomes = [
  ['Salário', 'briefcase'],
  ['Renda extra', 'wallet'],
  ['Rendimentos', 'wallet'],
  ['Reembolsos', 'gift'],
  ['Outros', 'tag'],
]
/** Stable UUIDs make category initialization idempotent; no financial records are seeded. */
export function defaultCategories(): Category[] {
  const now = new Date().toISOString()
  return [
    ...expenses.map(([name, icon]) => ({ name, icon, direction: 'expense' as const })),
    ...incomes.map(([name, icon]) => ({ name, icon, direction: 'income' as const })),
  ].map((c, index) => ({
    ...c,
    id: `8b7d2480-4954-4ea2-a760-${String(index + 1).padStart(12, '0')}`,
    color: c.direction === 'income' ? 'sage' : 'rose',
    archived: false,
    createdAt: now,
    updatedAt: now,
  }))
}
