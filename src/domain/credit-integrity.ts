import type { FinancialSnapshot } from './models'
import { sumCents } from './money'
import { cardSummary, invoiceSummary, nextPeriod, purchaseActive } from './credit'
import { today } from './financial-validation'
/** Shared transition guard; no balance/invoice calculation is duplicated at the sync boundary. */
export function purchaseHasHistory(
  s: Pick<FinancialSnapshot, 'installments' | 'payments' | 'invoiceEntries'>,
  purchaseId: string,
) {
  const invoices = new Set(
    (s.installments ?? []).filter((i) => i.purchaseId === purchaseId).map((i) => i.invoiceId),
  )
  return (
    s.payments.some((p) => invoices.has(p.invoiceId)) ||
    (s.invoiceEntries ?? []).some((e) => e.purchaseId === purchaseId)
  )
}
export function assertCreditIntegrity(s: FinancialSnapshot) {
  const cards = s.cards ?? [],
    purchases = s.purchases ?? [],
    installments = s.installments ?? [],
    invoices = s.invoices ?? [],
    entries = s.invoiceEntries ?? []
  const fail = (valid: unknown, message: string) => {
    if (!valid) throw new Error(`Integridade do crédito: ${message}.`)
  }
  fail(
    new Set(invoices.map((i) => `${i.cardId}:${i.period}`)).size === invoices.length,
    'competências duplicadas',
  )
  fail(
    new Set(installments.map((i) => `${i.purchaseId}:${i.number}`)).size === installments.length,
    'parcelas duplicadas',
  )
  for (const c of cards)
    fail(
      s.accounts.some((a) => a.id === c.accountId),
      'conta padrão do cartão inexistente',
    )
  for (const p of purchases) {
    fail(
      cards.some((c) => c.id === p.cardId),
      'cartão da compra inexistente',
    )
    fail(
      s.categories.some((c) => c.id === p.categoryId && c.direction === 'expense'),
      'categoria da compra inválida',
    )
    const parts = installments
      .filter((i) => i.purchaseId === p.id)
      .sort((a, b) => a.number - b.number)
    fail(parts.length === p.installmentCount, 'quantidade de parcelas divergente')
    fail(
      sumCents(parts.map((i) => i.amountCents)) === sumCents([p.amountCents, p.feeCents ?? 0]),
      'total de parcelas divergente',
    )
    fail(
      sumCents(parts.map((i) => i.principalCents ?? i.amountCents)) === p.amountCents,
      'principal das parcelas divergente',
    )
    for (const [index, i] of parts.entries()) {
      const inv = invoices.find((inv) => inv.id === i.invoiceId)
      fail(
        inv && inv.cardId === p.cardId && i.number === index + 1 && p.date < inv.closingDate,
        'competência ou vínculo de parcela inválido',
      )
      fail(
        (i.principalCents ?? i.amountCents) >= 0 &&
          (i.principalCents ?? i.amountCents) <= i.amountCents &&
          i.amountCents > 0,
        'principal inválido',
      )
      if (index === 0 && inv?.startDate)
        fail(p.date >= inv.startDate, 'compra fora do período inicial da fatura')
      if (index > 0)
        fail(
          inv?.period ===
            nextPeriod(
              invoices.find((previous) => previous.id === parts[index - 1].invoiceId)!.period,
            ),
          'parcelas fora de competências consecutivas',
        )
    }
    fail(
      sumCents(
        entries
          .filter((e) => e.kind === 'refund' && e.purchaseId === p.id)
          .map((e) => e.amountCents),
      ) <=
        p.amountCents + (p.feeCents ?? 0),
      'estorno maior que a compra',
    )
    if (!purchaseActive(p))
      fail(!entries.some((e) => e.purchaseId === p.id), 'compra cancelada com estornos')
  }
  for (const i of invoices)
    fail(
      cards.some((c) => c.id === i.cardId) &&
        i.closingDate < i.dueDate &&
        (!i.startDate || i.startDate < i.closingDate) &&
        i.closingDate.slice(0, 7) === i.period,
      'datas ou cartão da fatura inválidos',
    )
  for (const i of installments)
    fail(
      purchases.some((p) => p.id === i.purchaseId) &&
        invoices.some((inv) => inv.id === i.invoiceId),
      'parcela órfã',
    )
  for (const inv of invoices) {
    const previous = invoices.find(
      (i) => i.cardId === inv.cardId && i.period === nextPeriod(inv.period, -1),
    )
    if (previous && inv.startDate)
      fail(inv.startDate === previous.closingDate, 'períodos de fatura com lacuna ou sobreposição')
  }
  for (const e of entries) {
    const inv = invoices.find((i) => i.id === e.invoiceId)
    fail(inv, 'ajuste sem fatura')
    if (e.kind === 'refund') {
      const p = purchases.find((p) => p.id === e.purchaseId)
      fail(
        p &&
          p.cardId === inv?.cardId &&
          e.date >= p.date &&
          purchaseActive(p) &&
          (!e.categoryId || e.categoryId === p.categoryId),
        'estorno sem compra válida',
      )
    }
    if (e.purchaseId)
      fail(
        e.kind === 'refund' && purchases.some((p) => p.id === e.purchaseId),
        'referência de compra indevida no ajuste',
      )
    if (e.originalEntryId) fail(e.kind === 'charge-reversal', 'vínculo de estorno indevido')
    if (e.transferId)
      fail(e.kind === 'credit-in' || e.kind === 'credit-out', 'vínculo de crédito indevido')
    if (e.kind === 'credit-in' || e.kind === 'credit-out')
      fail(
        !e.purchaseId && !e.categoryId && !e.originalEntryId,
        'transferência de crédito com vínculos indevidos',
      )
    if (e.kind === 'charge')
      fail(
        s.categories.some((c) => c.id === e.categoryId && c.direction === 'expense'),
        'categoria do encargo inválida',
      )
    if (e.kind.startsWith('credit')) fail(e.transferId, 'transferência de crédito sem vínculo')
    if (e.kind === 'charge-reversal') {
      const original = entries.find((o) => o.id === e.originalEntryId)
      fail(
        original &&
          original.kind === 'charge' &&
          original.invoiceId === e.invoiceId &&
          original.amountCents === e.amountCents &&
          original.categoryId === e.categoryId &&
          e.date >= original.date &&
          entries.filter((o) => o.originalEntryId === original.id).length === 1,
        'estorno de encargo inconsistente',
      )
    }
  }
  for (const id of new Set(entries.filter((e) => e.transferId).map((e) => e.transferId))) {
    const pair = entries.filter((e) => e.transferId === id)
    fail(
      pair.length === 2 &&
        pair.some((e) => e.kind === 'credit-in') &&
        pair.some((e) => e.kind === 'credit-out') &&
        pair[0].amountCents === pair[1].amountCents &&
        pair[0].date === pair[1].date &&
        pair[0].invoiceId !== pair[1].invoiceId &&
        invoices.find((i) => i.id === pair[0].invoiceId)?.cardId ===
          invoices.find((i) => i.id === pair[1].invoiceId)?.cardId,
      'transferência de crédito inconsistente',
    )
  }
  for (const p of s.payments) {
    const a = s.accounts.find((a) => a.id === p.accountId)
    fail(
      a &&
        invoices.some((i) => i.id === p.invoiceId) &&
        p.date >= a.openingDate &&
        p.date <= today(),
      'pagamento sem conta/fatura ou data válida',
    )
    if (p.reversalDate)
      fail(
        p.reversalDate >= p.date && p.reversalDate <= today() && p.reversalReason?.trim(),
        'estorno de pagamento inválido',
      )
  }
  for (const i of invoices) {
    const summary = invoiceSummary(s, i, today())
    fail(
      summary.paid <= sumCents([summary.original, summary.financedFees, summary.charges]),
      'pagamentos acima do total original e encargos',
    )
  }
  // Replaying the recorded payment dates catches backdated edits that would overpay a later payment.
  for (const p of s.payments) {
    const invoice = invoices.find((i) => i.id === p.invoiceId)!
    const before = {
      ...s,
      invoiceEntries: entries.filter(
        (e) => e.date < p.date || (e.date === p.date && e.createdAt < p.createdAt),
      ),
      payments: s.payments
        .filter(
          (other) =>
            other.id !== p.id &&
            (other.date < p.date || (other.date === p.date && other.createdAt <= p.createdAt)),
        )
        .map((other) =>
          other.reversalDate === p.date && (other.reversedAt ?? '') >= p.createdAt
            ? { ...other, reversalDate: undefined }
            : other,
        ),
    }
    fail(
      p.amountCents <= invoiceSummary(before, invoice, p.date).remaining,
      'pagamento excedente na sequência histórica',
    )
  }
  for (const c of cards) cardSummary(s, c, today())
  sumCents([
    ...s.accounts.map((a) => Math.abs(a.openingBalanceCents)),
    ...s.transactions.map((t) => t.amountCents),
    ...s.transfers.map((t) => t.amountCents),
    ...s.adjustments.map((a) => Math.abs(a.deltaCents)),
    ...s.payments.map((p) => p.amountCents),
    ...cards.map((c) => c.limitCents),
    ...purchases.map((p) => p.amountCents + (p.feeCents ?? 0)),
    ...entries.map((e) => e.amountCents),
  ])
}
