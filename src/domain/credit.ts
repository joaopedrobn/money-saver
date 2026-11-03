import { addMonths, endOfMonth, format, parseISO, startOfMonth } from 'date-fns'
import type {
  CreditCard,
  CreditCardInvoice,
  PurchaseInput,
  CivilDate,
  FinancialSnapshot,
  CreditCardPurchase,
  InvoiceEntry,
  InvoicePayment,
  CreditRegime,
} from './models'
import { assertCents, distributeCents, sumCents } from './money'
import { civilDateSchema } from './financial-validation'
export function clampedDate(period: string, day: number): CivilDate {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || !Number.isInteger(day) || day < 1 || day > 31)
    throw new Error('Competência ou dia inválido.')
  const base = parseISO(`${period}-01`),
    last = endOfMonth(base).getDate()
  return `${period}-${String(Math.min(day, last)).padStart(2, '0')}` as CivilDate
}
export const nextPeriod = (period: string, count = 1) =>
  format(addMonths(parseISO(`${period}-01`), count), 'yyyy-MM')
export function invoiceCycle(card: Pick<CreditCard, 'closingDay' | 'dueDay'>, period: string) {
  const closingDate = clampedDate(period, card.closingDay),
    sameDue = clampedDate(period, card.dueDay)
  return {
    period,
    startDate: clampedDate(nextPeriod(period, -1), card.closingDay),
    closingDate,
    dueDate: sameDue > closingDate ? sameDue : clampedDate(nextPeriod(period), card.dueDay),
    closingDaySnapshot: card.closingDay,
    dueDaySnapshot: card.dueDay,
  }
}
/** Closing day is exclusive. Existing invoice snapshots always win over edited card dates. */
export function installmentPlan(
  card: CreditCard,
  purchase: Pick<PurchaseInput, 'date' | 'amountCents' | 'feeCents' | 'installmentCount'>,
  existing: CreditCardInvoice[] = [],
) {
  civilDateSchema.parse(purchase.date)
  const total = sumCents([purchase.amountCents, purchase.feeCents])
  assertCents(purchase.amountCents)
  if (purchase.amountCents < 1 || purchase.feeCents < 0 || purchase.installmentCount > total)
    throw new Error('Parcelamento inválido.')
  const parts = distributeCents(total, purchase.installmentCount),
    principal = distributeCents(purchase.amountCents, purchase.installmentCount)
  let period = purchase.date.slice(0, 7)
  const plannedCycles = new Map<string, CreditCardInvoice | ReturnType<typeof invoiceCycle>>()
  const cycle = (p: string) => {
    const saved =
      existing.find((i) => i.cardId === card.id && i.period === p) ?? plannedCycles.get(p)
    if (saved) return saved
    const previous =
        existing.find((i) => i.cardId === card.id && i.period === nextPeriod(p, -1)) ??
        plannedCycles.get(nextPeriod(p, -1)),
      following =
        existing.find((i) => i.cardId === card.id && i.period === nextPeriod(p)) ??
        plannedCycles.get(nextPeriod(p))
    const policy = following?.startDate
      ? {
          closingDay: following.closingDaySnapshot ?? Number(following.startDate.slice(8)),
          dueDay: following.dueDaySnapshot ?? card.dueDay,
        }
      : card
    const base = invoiceCycle(policy, p),
      closingDate = following?.startDate ?? base.closingDate,
      sameDue = clampedDate(p, policy.dueDay)
    const result = {
      ...base,
      closingDate,
      startDate: previous?.closingDate ?? base.startDate,
      dueDate: sameDue > closingDate ? sameDue : clampedDate(nextPeriod(p), policy.dueDay),
    }
    plannedCycles.set(p, result)
    return result
  }
  while (purchase.date >= cycle(period).closingDate) period = nextPeriod(period)
  return parts.map((amountCents, index) => ({
    number: index + 1,
    amountCents,
    principalCents: principal[index],
    cycle: cycle(nextPeriod(period, index)),
  }))
}
export const purchaseActive = (p: CreditCardPurchase) => p.status !== 'cancelled'
export const planFingerprint = (plan: ReturnType<typeof installmentPlan>) =>
  JSON.stringify(
    plan.map((p) => [
      p.number,
      p.amountCents,
      p.principalCents,
      p.cycle.period,
      p.cycle.startDate ?? null,
      p.cycle.closingDate,
      p.cycle.dueDate,
    ]),
  )
export const paymentActiveAt = (p: InvoicePayment, date: CivilDate) =>
  p.date <= date && (!p.reversalDate || p.reversalDate > date)
export const entryDelta = (e: InvoiceEntry) =>
  e.amountCents *
  (e.kind === 'refund' || e.kind === 'credit-in' || e.kind === 'charge-reversal' ? -1 : 1)
export function invoiceSummary(s: FinancialSnapshot, invoice: CreditCardInvoice, asOf: CivilDate) {
  const purchases = new Map(
    (s.purchases ?? []).filter((p) => purchaseActive(p) && p.date <= asOf).map((p) => [p.id, p]),
  )
  const installments = (s.installments ?? []).filter(
    (i) => i.invoiceId === invoice.id && purchases.has(i.purchaseId),
  )
  const entries = (s.invoiceEntries ?? []).filter(
    (e) => e.invoiceId === invoice.id && e.date <= asOf,
  )
  const original = sumCents(installments.map((i) => i.principalCents ?? i.amountCents)),
    financedFees = sumCents(
      installments.map((i) => i.amountCents - (i.principalCents ?? i.amountCents)),
    )
  const charges = sumCents(entries.filter((e) => e.kind === 'charge').map((e) => e.amountCents)),
    adjustments = sumCents(entries.filter((e) => e.kind !== 'charge').map(entryDelta))
  const rawDue = sumCents([original, financedFees, charges, adjustments]),
    paid = sumCents(
      s.payments
        .filter((p) => p.invoiceId === invoice.id && paymentActiveAt(p, asOf))
        .map((p) => p.amountCents),
    )
  const remaining = Math.max(sumCents([rawDue, -paid]), 0),
    credit = Math.max(sumCents([paid, -rawDue]), 0),
    closed = asOf >= invoice.closingDate
  const paymentStatus = remaining === 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid'
  const state =
    remaining > 0 && asOf > invoice.dueDate
      ? 'overdue'
      : paymentStatus === 'paid'
        ? 'paid'
        : paymentStatus === 'partial'
          ? 'partial'
          : closed
            ? 'closed'
            : 'open'
  return {
    invoice,
    installments,
    entries,
    original,
    financedFees,
    charges,
    adjustments,
    rawDue,
    totalDue: Math.max(rawDue, 0),
    paid,
    remaining,
    credit,
    closed,
    paymentStatus,
    state,
  }
}
export function cardSummary(s: FinancialSnapshot, card: CreditCard, asOf: CivilDate) {
  const invoices = (s.invoices ?? [])
    .filter((i) => i.cardId === card.id)
    .map((i) => invoiceSummary(s, i, asOf))
    .sort((a, b) => a.invoice.period.localeCompare(b.invoice.period))
  const debt = sumCents(invoices.map((i) => i.remaining)),
    credit = sumCents(invoices.map((i) => i.credit)),
    used = Math.max(sumCents([debt, -credit]), 0)
  const current = invoices.find((i) => !i.closed) ?? invoices.find((i) => i.remaining > 0),
    next = current ? invoices.find((i) => i.invoice.period > current.invoice.period) : undefined
  return {
    invoices,
    used,
    available: sumCents([card.limitCents, -used]),
    contracted: card.limitCents,
    credit,
    netCredit: Math.max(credit - debt, 0),
    debt,
    paid: sumCents(invoices.map((i) => i.paid)),
    committed: sumCents(invoices.map((i) => i.rawDue)),
    current,
    next,
    nextDue: invoices
      .filter((i) => i.remaining > 0)
      .map((i) => i.invoice.dueDate)
      .sort()[0],
  }
}
/** Consumption recognition is independent of bank payments. Credits are dated consumption reversals. */
export function creditConsumption(
  s: FinancialSnapshot,
  from: string,
  to: string,
  asOf: CivilDate,
  regime: CreditRegime = 'purchase',
) {
  const active = (s.purchases ?? []).filter((p) => purchaseActive(p) && p.date <= asOf),
    purchases = new Map(active.map((p) => [p.id, p])),
    invoices = new Map((s.invoices ?? []).map((i) => [i.id, i]))
  const rows: { categoryId: string; amountCents: number; date: string }[] =
    regime === 'purchase'
      ? active.map((p) => ({
          categoryId: p.categoryId,
          amountCents: sumCents([p.amountCents, p.feeCents ?? 0]),
          date: p.date,
        }))
      : (s.installments ?? [])
          .filter((i) => purchases.has(i.purchaseId))
          .map((i) => ({
            categoryId: purchases.get(i.purchaseId)!.categoryId,
            amountCents: i.amountCents,
            date: `${invoices.get(i.invoiceId)!.period}-01`,
          }))
  for (const e of s.invoiceEntries ?? [])
    if (
      e.date <= asOf &&
      (e.kind === 'refund' || e.kind === 'charge' || e.kind === 'charge-reversal')
    ) {
      const categoryId =
        e.categoryId ?? (e.purchaseId ? purchases.get(e.purchaseId)?.categoryId : undefined)
      if (categoryId)
        rows.push({
          categoryId,
          amountCents:
            e.amountCents * (e.kind === 'refund' || e.kind === 'charge-reversal' ? -1 : 1),
          date: regime === 'installment' ? `${invoices.get(e.invoiceId)!.period}-01` : e.date,
        })
    }
  return rows.filter((r) => r.date >= from && r.date <= to && r.date <= asOf)
}
export function creditPlanning(
  s: FinancialSnapshot,
  month: Date,
  asOf: CivilDate,
  currentBankTotal: number,
) {
  const from = format(startOfMonth(month), 'yyyy-MM-dd'),
    to = format(endOfMonth(month), 'yyyy-MM-dd')
  const pending = s.transactions.filter((t) => ['planned', 'pending'].includes(t.status)),
    invoices = (s.invoices ?? [])
      .map((i) => invoiceSummary(s, i, asOf))
      .filter((i) => i.remaining > 0)
  const monthInvoices = invoices.filter(
      (i) => i.invoice.dueDate >= from && i.invoice.dueDate <= to,
    ),
    monthlyBank = pending.filter((t) => t.date >= from && t.date <= to)
  const income = sumCents(
      monthlyBank.filter((t) => t.direction === 'income').map((t) => t.amountCents),
    ),
    bankExpense = sumCents(
      monthlyBank.filter((t) => t.direction === 'expense').map((t) => t.amountCents),
    ),
    invoiceExpense = sumCents(monthInvoices.map((i) => i.remaining))
  const until = pending.filter((t) => t.date <= to),
    invoiceUntil = invoices.filter((i) => i.invoice.dueDate <= to),
    commitments = sumCents([bankExpense, invoiceExpense])
  const projected = sumCents([
    currentBankTotal,
    ...until.map((t) => t.amountCents * (t.direction === 'income' ? 1 : -1)),
    ...invoiceUntil.map((i) => -i.remaining),
  ])
  const monthInstallments = monthInvoices.flatMap((v) => v.installments)
  return {
    from,
    to,
    income,
    bankExpense,
    invoiceExpense,
    commitments,
    projected,
    monthInvoices,
    monthInstallments,
    historical: to < asOf,
  }
}
