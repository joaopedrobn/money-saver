import { z } from 'zod'
import { isValid, parseISO, format } from 'date-fns'
import { parseBRL } from './money'
export const accountFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Informe ao menos 2 caracteres.')
    .max(60, 'Use até 60 caracteres.'),
  institution: z.string().trim().min(2, 'Informe a instituição.').max(60, 'Use até 60 caracteres.'),
  type: z.enum(['checking', 'savings', 'cash', 'investment']),
  openingBalance: z
    .string()
    .min(1, 'Informe o saldo inicial.')
    .refine((v) => {
      try {
        parseBRL(v)
        return true
      } catch {
        return false
      }
    }, 'Use o formato 1.234,56 (máximo R$ 9.999.999.999,99).'),
  openingDate: z
    .string()
    .refine(
      (v) =>
        /^\d{4}-\d{2}-\d{2}$/.test(v) &&
        isValid(parseISO(v)) &&
        v <= format(new Date(), 'yyyy-MM-dd'),
      'Informe uma data válida, até hoje.',
    ),
  color: z.enum(['sage', 'blue', 'purple', 'amber', 'rose']),
})
export type AccountFormValues = z.infer<typeof accountFormSchema>
