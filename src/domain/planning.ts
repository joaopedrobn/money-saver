import { addDays, endOfMonth, format, getISODay, parseISO } from 'date-fns'
import { z } from 'zod'
import type { CivilDate, FinancialSnapshot, RecurringTransaction } from './models'
import { centsSchema, civilDateSchema } from './financial-validation'
import { clampedDate, creditPlanning, installmentPlan, nextPeriod } from './credit'
import { monthlySummary } from './finance'
import { sumCents } from './money'

export const recurringSchema = z
  .object({
    description: z.string().trim().min(2).max(160),
    amountCents: centsSchema,
    categoryId: z.string().min(1),
    accountId: z.string().min(1),
    cardId: z.string().min(1).optional(),
    direction: z.enum(['income', 'expense']),
    frequency: z.enum(['monthly', 'weekly', 'yearly']),
    dayOfMonth: z.number().int().min(1).max(31),
    startDate: civilDateSchema,
    endDate: civilDateSchema.optional(),
  })
  .strict()
  .refine((r) => !r.endDate || r.endDate >= r.startDate, 'Data final anterior à inicial.')
  .refine((r) => r.frequency !== 'weekly' || r.dayOfMonth <= 7, 'Use dia da semana entre 1 e 7.')
  .refine((r) => !r.cardId || r.direction === 'expense', 'Cartão aceita apenas despesas.')

export function recurringDates(r: RecurringTransaction, from: string, to: string): CivilDate[] {
  if (!r.active || r.ended || from > to) return []
  const dates: CivilDate[] = []
  const lower = from > r.startDate ? from : r.startDate
  const upper = r.endDate && r.endDate < to ? r.endDate : to
  if (lower > upper) return dates
  if (r.frequency === 'weekly') {
    let day = parseISO(lower)
    day = addDays(day, (r.dayOfMonth - getISODay(day) + 7) % 7)
    for (; format(day, 'yyyy-MM-dd') <= upper; day = addDays(day, 7))
      dates.push(format(day, 'yyyy-MM-dd') as CivilDate)
  } else {
    for (let period = lower.slice(0, 7); period <= upper.slice(0, 7); period = nextPeriod(period)) {
      if (r.frequency === 'yearly' && period.slice(5) !== r.startDate.slice(5, 7)) continue
      const date = clampedDate(period, r.dayOfMonth)
      if (date >= lower && date <= upper) dates.push(date)
    }
  }
  return dates
}
export function pendingOccurrences(s: FinancialSnapshot, from: string, to: string) {
  return (s.recurring ?? [])
    .flatMap((r) =>
      recurringDates(r, from, to)
        .filter(
          (date) => !(s.occurrences ?? []).some((o) => o.recurringId === r.id && o.date === date),
        )
        .map((date) => ({ recurring: r, date })),
    )
    .sort((a, b) => a.date.localeCompare(b.date))
}

// Virtual occurrences never write transactions or invoices before explicit confirmation.
export function projectedSnapshot(
  s: FinancialSnapshot,
  from: string,
  to: string,
): FinancialSnapshot {
  const result = {
    ...s,
    transactions: [...s.transactions],
    purchases: [...(s.purchases ?? [])],
    invoices: [...(s.invoices ?? [])],
    installments: [...(s.installments ?? [])],
  }
  for (const { recurring: r, date } of pendingOccurrences(s, from, to)) {
    const id = `forecast-${r.id}-${date}`,
      entity = { id, createdAt: `${date}T12:00:00.000Z`, updatedAt: `${date}T12:00:00.000Z` }
    if (r.cardId) {
      const card = (s.cards ?? []).find((c) => c.id === r.cardId)
      if (!card || card.archived) continue
      result.purchases.push({
        ...entity,
        cardId: card.id,
        categoryId: r.categoryId,
        description: r.description,
        amountCents: r.amountCents,
        feeCents: 0,
        date,
        installmentCount: 1,
      })
      for (const part of installmentPlan(
        card,
        { date, amountCents: r.amountCents, feeCents: 0, installmentCount: 1 },
        result.invoices,
      )) {
        let invoice = result.invoices.find(
          (i) => i.cardId === card.id && i.period === part.cycle.period,
        )
        if (!invoice) {
          invoice = { ...entity, id: `${id}-invoice`, cardId: card.id, ...part.cycle }
          result.invoices.push(invoice)
        }
        result.installments.push({
          ...entity,
          id: `${id}-part`,
          purchaseId: id,
          invoiceId: invoice.id,
          number: 1,
          amountCents: r.amountCents,
          principalCents: r.amountCents,
        })
      }
    } else
      result.transactions.push({
        ...entity,
        accountId: r.accountId,
        categoryId: r.categoryId,
        description: r.description,
        amountCents: r.amountCents,
        date,
        direction: r.direction,
        method: 'other',
        status: 'planned',
      })
  }
  return result
}
export function financialForecast(
  s: FinancialSnapshot,
  asOf: CivilDate,
  months: number,
  bankTotal: number,
) {
  if (![1, 3, 6, 12].includes(months)) throw new Error('Horizonte inválido.')
  const last = nextPeriod(asOf.slice(0, 7), months - 1)
  const to = format(endOfMonth(parseISO(`${last}-01`)), 'yyyy-MM-dd')
  const virtual = projectedSnapshot(s, asOf, to)
  return Array.from({ length: months }, (_, index) => {
    const period = nextPeriod(asOf.slice(0, 7), index)
    const end = format(endOfMonth(parseISO(`${period}-01`)), 'yyyy-MM-dd') as CivilDate
    // Include future virtual purchases in invoice totals, but keep current bank cash as the base.
    const plan = creditPlanning(virtual, parseISO(`${period}-01`), end, bankTotal)
    return { period, ...plan }
  })
}
export function budgetUsage(s: FinancialSnapshot, month: string, asOf: CivilDate) {
  const summary = monthlySummary(
    s,
    parseISO(`${month}-01`),
    asOf,
    s.settings?.[0]?.creditRegime ?? 'purchase',
  )
  return (s.budgets ?? [])
    .filter((b) => b.month === month)
    .map((b) => {
      const used = summary.categories.find((c) => c.id === b.categoryId)?.amountCents ?? 0
      return {
        ...b,
        used,
        available: sumCents([b.amountCents, -used]),
        percent: Math.round((used / b.amountCents) * 100),
      }
    })
}
