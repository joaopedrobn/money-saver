import { z } from 'zod'
import { format, isValid, parseISO } from 'date-fns'
import type { CivilDate, MovementInput, CategoryInput } from './models'
import { civilToday } from './civil-clock'
export const today = () => civilToday()
export const civilDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => isValid(parseISO(v)) && format(parseISO(v), 'yyyy-MM-dd') === v, 'Data inválida.')
  .transform((v) => v as CivilDate)
export const centsSchema = z.number().int().min(1).max(999_999_999_999)
export const statusSchema = z.enum(['planned', 'pending', 'settled', 'cancelled'])
export const movementSchema = z
  .object({
    kind: z.enum(['transaction', 'transfer', 'adjustment']),
    accountId: z.string().min(1),
    destinationAccountId: z.string().optional(),
    categoryId: z.string().optional(),
    description: z
      .string()
      .trim()
      .min(2, 'Informe uma descrição com ao menos 2 caracteres.')
      .max(160),
    amountCents: centsSchema,
    direction: z.enum(['income', 'expense']),
    method: z.enum(['pix', 'debit', 'cash', 'other']),
    date: civilDateSchema,
    status: statusSchema,
    settledDate: civilDateSchema.optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .superRefine((v, ctx) => {
    if (
      v.kind === 'transfer' &&
      (!v.destinationAccountId || v.accountId === v.destinationAccountId)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['destinationAccountId'],
        message: 'Escolha uma conta de destino diferente da origem.',
      })
    if (v.kind !== 'transfer' && !v.categoryId)
      ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'Selecione uma categoria.' })
    if (v.status === 'settled' && (!v.settledDate || v.settledDate > today()))
      ctx.addIssue({
        code: 'custom',
        path: ['settledDate'],
        message: 'Informe a data real da efetivação, até hoje.',
      })
    if (v.status !== 'settled' && v.settledDate)
      ctx.addIssue({
        code: 'custom',
        path: ['settledDate'],
        message: 'Somente realizados possuem data de efetivação.',
      })
  })
export const categorySchema = z.object({
  name: z.string().trim().min(2).max(60),
  direction: z.enum(['income', 'expense']),
  color: z.enum(['sage', 'blue', 'purple', 'amber', 'rose']),
  icon: z.enum([
    'wallet',
    'home',
    'car',
    'heart',
    'book',
    'shopping',
    'coffee',
    'repeat',
    'briefcase',
    'gift',
    'tag',
  ]),
})
export function validateMovement(input: MovementInput): MovementInput {
  return movementSchema.parse(input)
}
export function validateCategory(input: CategoryInput): CategoryInput {
  return categorySchema.parse(input)
}
