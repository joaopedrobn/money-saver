import { z } from 'zod'
import { centsSchema, civilDateSchema, today } from './financial-validation'
export const cardSchema = z
  .object({
    name: z.string().trim().min(2, 'Informe o nome do cartão.').max(60),
    institution: z.string().trim().min(2, 'Informe a instituição.').max(60),
    nickname: z.string().trim().max(60),
    brand: z.string().trim().max(30),
    lastFour: z
      .string()
      .regex(/^(\d{4})?$/, 'Informe somente os quatro últimos dígitos, ou deixe em branco.'),
    accountId: z.string().min(1, 'Selecione uma conta padrão.'),
    color: z.enum(['sage', 'blue', 'purple', 'amber', 'rose']),
    limitCents: z.number().int().min(0).max(999_999_999_999),
    closingDay: z.number().int().min(1).max(31),
    dueDay: z.number().int().min(1).max(31),
  })
  .strict()
export const purchaseSchema = z
  .object({
    cardId: z.string().min(1),
    categoryId: z.string().min(1),
    description: z.string().trim().min(2).max(160),
    amountCents: centsSchema,
    feeCents: z.number().int().min(0).max(999_999_999_999),
    date: civilDateSchema.refine((v) => v <= today(), 'A compra deve ter ocorrido até hoje.'),
    installmentCount: z.number().int().min(1).max(360),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine(
    (v) =>
      Number.isSafeInteger(v.amountCents + v.feeCents) &&
      v.amountCents + v.feeCents <= 999_999_999_999 &&
      v.installmentCount <= v.amountCents + v.feeCents,
    'Total financiado inválido ou parcelas inferiores a um centavo.',
  )
export const paymentSchema = z
  .object({
    invoiceId: z.string().min(1),
    accountId: z.string().min(1),
    amountCents: centsSchema,
    date: civilDateSchema.refine((v) => v <= today(), 'Informe a data efetiva até hoje.'),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict()
