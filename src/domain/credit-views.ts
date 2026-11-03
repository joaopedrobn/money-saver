import type { FinancialSnapshot, CreditCard, CreditCardPurchase, CivilDate } from './models'
import { cardSummary, invoiceSummary, purchaseActive } from './credit'
import { sumCents } from './money'
export function purchaseProgress(s: FinancialSnapshot, p: CreditCardPurchase, asOf: CivilDate) {
  const parts = (s.installments ?? [])
    .filter((i) => i.purchaseId === p.id)
    .sort((a, b) => a.number - b.number)
  return parts.map((part) => {
    const invoice = (s.invoices ?? []).find((i) => i.id === part.invoiceId)!
    const value = invoiceSummary(s, invoice, asOf)
    const refund = sumCents(
      value.entries
        .filter((e) => e.kind === 'refund' && e.purchaseId === p.id)
        .map((e) => e.amountCents),
    )
    return {
      part,
      invoice,
      remaining: purchaseActive(p)
        ? Math.min(Math.max(part.amountCents - refund, 0), value.remaining)
        : 0,
      state: !purchaseActive(p)
        ? 'Cancelada'
        : refund >= part.amountCents
          ? 'Estornada'
          : value.remaining === 0
            ? 'Fatura quitada'
            : 'Fatura em aberto',
    }
  })
}
export function refundableAmount(s: FinancialSnapshot, p: CreditCardPurchase) {
  return sumCents([
    p.amountCents,
    p.feeCents ?? 0,
    ...(s.invoiceEntries ?? [])
      .filter((e) => e.kind === 'refund' && e.purchaseId === p.id)
      .map((e) => -e.amountCents),
  ])
}
export function limitHistory(s: FinancialSnapshot, card: CreditCard, asOf: CivilDate) {
  const invoiceIds = new Set(
    (s.invoices ?? []).filter((i) => i.cardId === card.id).map((i) => i.id),
  )
  const dates = new Set([
    ...(s.purchases ?? []).filter((p) => p.cardId === card.id).map((p) => p.date),
    ...s.payments
      .filter((p) => invoiceIds.has(p.invoiceId))
      .flatMap((p) => [p.date, ...(p.reversalDate ? [p.reversalDate] : [])]),
    ...(s.invoiceEntries ?? []).filter((e) => invoiceIds.has(e.invoiceId)).map((e) => e.date),
  ])
  return [...dates]
    .filter((d) => d <= asOf)
    .sort()
    .map((date) => {
      const summary = cardSummary(s, card, date)
      return { date, used: summary.used, available: summary.available }
    })
}
