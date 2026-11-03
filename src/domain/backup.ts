import { z } from 'zod'
import {
  categorySchema,
  civilDateSchema as date,
  centsSchema as positive,
  movementSchema,
  statusSchema,
  today,
} from './financial-validation'
import { movementsFrom } from './finance'
import { sumCents } from './money'
import { assertCreditIntegrity } from './credit-integrity'
import { recurringSchema } from './planning'
const id = z.string().min(1).max(120)
const instant = z.iso.datetime()
const base = { id, createdAt: instant, updatedAt: instant }
const signed = z.number().int().min(-999_999_999_999).max(999_999_999_999)
const optionalMovement = {
  status: statusSchema.optional(),
  settledDate: date.optional(),
  notes: z.string().max(2000).optional(),
}
const account = z
  .object({
    ...base,
    name: z.string().trim().min(2).max(60),
    institution: z.string().trim().min(2).max(60),
    type: z.enum(['checking', 'savings', 'cash', 'investment']),
    openingBalanceCents: signed,
    openingDate: date.refine((v) => v <= today()),
    color: z.enum(['sage', 'blue', 'purple', 'amber', 'rose']),
  })
  .strict()
const category = categorySchema.extend({ ...base, archived: z.boolean().optional() }).strict()
const transaction = z
  .object({
    ...base,
    accountId: id,
    categoryId: id,
    description: z.string().min(2).max(160),
    amountCents: positive,
    direction: z.enum(['income', 'expense']),
    method: z.enum(['pix', 'debit', 'cash', 'other']),
    date,
    status: statusSchema,
    settledDate: date.optional(),
    recurringId: id.optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict()
const transfer = z
  .object({
    ...base,
    sourceAccountId: id,
    destinationAccountId: id,
    amountCents: positive,
    date,
    description: z.string().min(2).max(160),
    ...optionalMovement,
  })
  .strict()
const adjustment = z
  .object({
    ...base,
    accountId: id,
    deltaCents: signed.refine((v) => v !== 0),
    date,
    reason: z.string().min(2).max(160),
    categoryId: id.optional(),
    ...optionalMovement,
  })
  .strict()
const card = z
  .object({
    ...base,
    accountId: id,
    name: z.string().min(1),
    limitCents: z.number().int().nonnegative().max(999_999_999_999),
    closingDay: z.number().int().min(1).max(31),
    dueDay: z.number().int().min(1).max(31),
    institution: z.string().max(60).optional(),
    nickname: z.string().max(60).optional(),
    brand: z.string().max(30).optional(),
    lastFour: z
      .string()
      .regex(/^(\d{4})?$/)
      .optional(),
    color: z.enum(['sage', 'blue', 'purple', 'amber', 'rose']).optional(),
    archived: z.boolean().optional(),
  })
  .strict()
const purchase = z
  .object({
    ...base,
    cardId: id,
    categoryId: id,
    description: z.string(),
    amountCents: positive,
    date,
    installmentCount: z.number().int().min(1).max(360),
    feeCents: z.number().int().min(0).max(999_999_999_999).optional(),
    notes: z.string().max(2000).optional(),
    status: z.enum(['active', 'cancelled']).optional(),
    cancellationReason: z.string().min(3).max(160).optional(),
  })
  .strict()
const installment = z
  .object({
    ...base,
    purchaseId: id,
    invoiceId: id,
    number: z.number().int().positive(),
    amountCents: z.number().int().nonnegative(),
    principalCents: z.number().int().nonnegative().optional(),
  })
  .strict()
const invoice = z
  .object({
    ...base,
    cardId: id,
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    closingDate: date,
    dueDate: date,
    startDate: date.optional(),
    closingDaySnapshot: z.number().int().min(1).max(31).optional(),
    dueDaySnapshot: z.number().int().min(1).max(31).optional(),
  })
  .strict()
const payment = z
  .object({
    ...base,
    invoiceId: id,
    accountId: id,
    amountCents: positive,
    date,
    reversalDate: date.optional(),
    reversalReason: z.string().min(3).max(160).optional(),
    reversedAt: instant.optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict()
const recurring = z
  .object({
    ...base,
    accountId: id,
    categoryId: id,
    description: z.string(),
    direction: z.enum(['income', 'expense']),
    amountCents: positive,
    startDate: date,
    endDate: date.optional(),
    dayOfMonth: z.number().int().min(1).max(31),
    frequency: z.enum(['monthly', 'weekly', 'yearly']),
    active: z.boolean(),
    cardId: id.optional(),
    ended: z.boolean().optional(),
  })
  .strict()
const settings = z
  .object({
    ...base,
    currency: z.literal('BRL'),
    locale: z.literal('pt-BR'),
    theme: z.literal('dark'),
    weekStartsOn: z.union([z.literal(0), z.literal(1)]),
    creditRegime: z.enum(['purchase', 'installment']).optional(),
  })
  .strict()
const snapshot = z.object(base).extend({ name: z.string().optional() }).passthrough()
const audit = z
  .object({
    id,
    entityId: id,
    entityType: z.enum([
      'account',
      'transaction',
      'transfer',
      'adjustment',
      'category',
      'backup',
      'card',
      'purchase',
      'payment',
      'invoice-entry',
      'settings',
      'recurring',
      'budget',
    ]),
    action: z.enum(['create', 'update', 'delete']),
    at: instant,
    before: snapshot.optional(),
    after: snapshot.optional(),
  })
  .strict()
const dataSchema = z
  .object({
    accounts: z.array(account),
    categories: z.array(category),
    transactions: z.array(transaction),
    transfers: z.array(transfer),
    adjustments: z.array(adjustment),
    cards: z.array(card),
    purchases: z.array(purchase),
    installments: z.array(installment),
    invoices: z.array(invoice),
    payments: z.array(payment),
    recurring: z.array(recurring),
    occurrences: z
      .array(
        z
          .object({
            ...base,
            recurringId: id,
            date,
            transactionId: id.optional(),
            purchaseId: id.optional(),
          })
          .strict(),
      )
      .default([]),
    budgets: z
      .array(
        z
          .object({
            ...base,
            month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
            categoryId: id,
            amountCents: positive,
          })
          .strict(),
      )
      .default([]),
    settings: z.array(settings),
    audit: z.array(audit),
    invoiceEntries: z
      .array(
        z
          .object({
            ...base,
            invoiceId: id,
            kind: z.enum(['charge', 'refund', 'credit-in', 'credit-out', 'charge-reversal']),
            amountCents: positive,
            date: date.refine((d) => d <= today()),
            description: z.string().min(3).max(160),
            purchaseId: id.optional(),
            categoryId: id.optional(),
            transferId: id.optional(),
            originalEntryId: id.optional(),
          })
          .strict(),
      )
      .default([]),
  })
  .strict()
export const backupSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    app: z.literal('money-saver').optional(),
    exportedAt: instant,
    schemaVersion: z.union([z.literal(3), z.literal(4)]).optional(),
    data: dataSchema,
  })
  .strict()
export type Backup = z.infer<typeof backupSchema>
export function validateBackup(value: unknown): Backup {
  const backup = backupSchema.parse(value),
    d = backup.data
  for (const [name, rows] of Object.entries(d)) {
    if (rows.length > 100_000) throw new Error(`Tabela ${name} excede o limite de registros.`)
    if (new Set(rows.map((r) => r.id)).size !== rows.length)
      throw new Error(`IDs duplicados em ${name}.`)
  }
  const accounts = new Map(d.accounts.map((a) => [a.id, a])),
    categories = new Map(d.categories.map((c) => [c.id, c]))
  const has = (table: { id: string }[], key: string) => table.some((r) => r.id === key)
  const requireRef = (valid: boolean, message: string) => {
    if (!valid) throw new Error(`Backup inconsistente: ${message}.`)
  }
  for (const m of movementsFrom(d)) {
    // Legacy v1 adjustments may not have a category; keep their historical meaning.
    movementSchema.parse(
      m.kind === 'adjustment' && !m.categoryId
        ? {
            ...m,
            categoryId: 'legacy-adjustment',
            settledDate: m.status === 'settled' ? (m.settledDate ?? m.date) : m.settledDate,
          }
        : { ...m, settledDate: m.status === 'settled' ? (m.settledDate ?? m.date) : m.settledDate },
    )
    for (const accountId of [
      m.accountId,
      ...(m.kind === 'transfer' ? [m.destinationAccountId!] : []),
    ]) {
      const a = accounts.get(accountId)
      requireRef(!!a, 'conta referenciada não existe')
      requireRef(
        !!a && m.date >= a.openingDate && (!m.settledDate || m.settledDate >= a.openingDate),
        'movimentação anterior à abertura da conta',
      )
    }
    if (m.categoryId)
      requireRef(
        categories.get(m.categoryId)?.direction === m.direction,
        'categoria inexistente ou incompatível',
      )
  }
  for (const t of d.transactions)
    if (t.recurringId) requireRef(has(d.recurring, t.recurringId), 'recorrência não existe')
  for (const c of d.cards) requireRef(accounts.has(c.accountId), 'conta do cartão não existe')
  for (const p of d.purchases) {
    requireRef(has(d.cards, p.cardId), 'cartão da compra não existe')
    requireRef(
      categories.get(p.categoryId)?.direction === 'expense',
      'categoria da compra inválida',
    )
  }
  for (const i of d.invoices)
    requireRef(has(d.cards, i.cardId) && i.closingDate <= i.dueDate, 'fatura inválida')
  for (const i of d.installments)
    requireRef(
      has(d.purchases, i.purchaseId) && has(d.invoices, i.invoiceId),
      'vínculo de parcela inválido',
    )
  for (const p of d.payments)
    requireRef(
      accounts.has(p.accountId) &&
        has(d.invoices, p.invoiceId) &&
        p.date <= today() &&
        p.date >= accounts.get(p.accountId)!.openingDate,
      'pagamento inválido',
    )
  for (const r of d.recurring) {
    const {
      description,
      amountCents,
      categoryId,
      accountId,
      cardId,
      direction,
      frequency,
      dayOfMonth,
      startDate,
      endDate,
    } = r
    recurringSchema.parse({
      description,
      amountCents,
      categoryId,
      accountId,
      cardId,
      direction,
      frequency,
      dayOfMonth,
      startDate,
      endDate,
    })
    requireRef(
      accounts.has(r.accountId) &&
        categories.get(r.categoryId)?.direction === r.direction &&
        (!r.endDate || r.endDate >= r.startDate),
      'recorrência inválida',
    )
    if (r.cardId) requireRef(has(d.cards, r.cardId), 'cartão da recorrência inexistente')
  }
  requireRef(
    new Set(d.occurrences.map((o) => `${o.recurringId}:${o.date}`)).size === d.occurrences.length,
    'ocorrência duplicada',
  )
  requireRef(
    new Set(d.budgets.map((b) => `${b.month}:${b.categoryId}`)).size === d.budgets.length,
    'orçamento duplicado',
  )
  const targets = new Set<string>()
  for (const o of d.occurrences) {
    requireRef(
      has(d.recurring, o.recurringId) && !!o.transactionId !== !!o.purchaseId,
      'ocorrência inválida',
    )
    const key = o.transactionId ? `transaction:${o.transactionId}` : `purchase:${o.purchaseId}`
    requireRef(!targets.has(key), 'efetivação vinculada duas vezes')
    targets.add(key)
    requireRef(
      o.transactionId
        ? d.transactions.some((t) => t.id === o.transactionId && t.recurringId === o.recurringId)
        : has(d.purchases, o.purchaseId!),
      'efetivação inexistente',
    )
  }
  for (const b of d.budgets)
    requireRef(
      categories.get(b.categoryId)?.direction === 'expense',
      'categoria do orçamento inválida',
    )
  assertCreditIntegrity(d)
  sumCents([
    ...d.accounts.map((a) => Math.abs(a.openingBalanceCents)),
    ...d.transactions.map((t) => t.amountCents),
    ...d.transfers.map((t) => t.amountCents),
    ...d.adjustments.map((a) => Math.abs(a.deltaCents)),
    ...d.payments.map((p) => p.amountCents),
  ])
  return backup
}
