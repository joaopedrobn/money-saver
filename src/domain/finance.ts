import { eachDayOfInterval, endOfMonth, format, startOfMonth } from 'date-fns'
import type { FinancialSnapshot, Movement, CivilDate, MovementKind, CreditRegime } from './models'
import { creditConsumption } from './credit'
import { accountBalance, realizedDate, sumCents } from './money'
export function movementsFrom(
  snapshot: Pick<FinancialSnapshot, 'transactions' | 'transfers' | 'adjustments'>,
): Movement[] {
  return [
    ...snapshot.transactions.map((t) => ({ ...t, kind: 'transaction' as const })),
    ...snapshot.transfers.map((t) => ({
      ...t,
      kind: 'transfer' as const,
      accountId: t.sourceAccountId,
      direction: 'expense' as const,
      method: 'other' as const,
      status: t.status ?? ('settled' as const),
    })),
    ...snapshot.adjustments.map((a) => ({
      ...a,
      kind: 'adjustment' as const,
      description: a.reason,
      amountCents: Math.abs(a.deltaCents),
      direction: a.deltaCents >= 0 ? ('income' as const) : ('expense' as const),
      method: 'other' as const,
      status: a.status ?? ('settled' as const),
    })),
  ]
}
export const movementDate = (m: Movement) => (m.status === 'settled' ? realizedDate(m) : m.date)
export function bankMovementsFrom(s: FinancialSnapshot): Movement[] {
  const rows = movementsFrom(s)
  for (const p of s.payments) {
    const invoice = s.invoices?.find((i) => i.id === p.invoiceId),
      card = s.cards?.find((c) => c.id === invoice?.cardId)
    const base = {
      ...p,
      kind: 'adjustment' as const,
      accountId: p.accountId,
      description: `Pagamento de fatura · ${card?.name ?? 'Cartão'} · ${invoice?.period ?? ''}`,
      direction: 'expense' as const,
      method: 'other' as const,
      status: 'settled' as const,
      settledDate: p.date,
      readOnly: true,
      paymentId: p.id,
    }
    rows.push(base)
    if (p.reversalDate)
      rows.push({
        ...base,
        id: `${p.id}-reversal`,
        createdAt: p.reversedAt ?? p.updatedAt,
        date: p.reversalDate,
        settledDate: p.reversalDate,
        description: `Estorno de pagamento · ${card?.name ?? 'Cartão'}`,
        notes: p.reversalReason,
        direction: 'income',
        paymentReversal: true,
      })
  }
  return rows
}
export const compareMovements = (a: Movement, b: Movement) =>
  movementDate(a).localeCompare(movementDate(b)) ||
  a.createdAt.localeCompare(b.createdAt) ||
  a.id.localeCompare(b.id) ||
  a.kind.localeCompare(b.kind)
export const movementKey = (m: Pick<Movement, 'kind' | 'id'>) => `${m.kind}:${m.id}`
export function movementDelta(m: Movement, accountId: string): number {
  if (m.status !== 'settled') return 0
  if (m.kind === 'transfer')
    return m.accountId === accountId
      ? -m.amountCents
      : m.destinationAccountId === accountId
        ? m.amountCents
        : 0
  return m.accountId === accountId ? m.amountCents * (m.direction === 'income' ? 1 : -1) : 0
}
export function balancesAt(s: FinancialSnapshot, date: CivilDate) {
  return Object.fromEntries(
    s.accounts.map((a) => [
      a.id,
      accountBalance(a, s.transactions, s.transfers, s.payments, s.adjustments, date),
    ]),
  )
}
export interface MovementFilter {
  from?: string
  to?: string
  categoryId?: string
  type?: string
  search?: string
  status?: string
  accountId?: string
}
export function filterMovements(movements: Movement[], filter: MovementFilter): Movement[] {
  const search =
    filter.search
      ?.trim()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('pt-BR') ?? ''
  return movements.filter(
    (m) =>
      (!filter.from || movementDate(m) >= filter.from) &&
      (!filter.to || movementDate(m) <= filter.to) &&
      (!filter.categoryId || m.categoryId === filter.categoryId) &&
      (!filter.status || m.status === filter.status) &&
      (!filter.accountId ||
        m.accountId === filter.accountId ||
        m.destinationAccountId === filter.accountId) &&
      (!filter.type ||
        (filter.type === 'income' || filter.type === 'expense'
          ? m.kind === 'transaction' && m.direction === filter.type
          : filter.type === 'pix'
            ? m.kind === 'transaction' && m.method === 'pix'
            : filter.type === 'payment'
              ? !!m.paymentId
              : filter.type === 'adjustment'
                ? m.kind === 'adjustment' && !m.paymentId
                : m.kind === (filter.type as MovementKind))) &&
      (!search ||
        `${m.description} ${m.notes ?? ''}`
          .normalize('NFD')
          .replace(/\p{Diacritic}/gu, '')
          .toLocaleLowerCase('pt-BR')
          .includes(search)),
  )
}
export function statement(s: FinancialSnapshot, accountId: string, asOf: CivilDate) {
  const account = s.accounts.find((a) => a.id === accountId)
  if (!account || account.openingDate > asOf) return []
  let balance = account.openingBalanceCents
  return bankMovementsFrom(s)
    .filter(
      (m) =>
        (m.accountId === accountId || m.destinationAccountId === accountId) &&
        movementDate(m) <= asOf,
    )
    .sort(compareMovements)
    .map((m) => {
      const delta = movementDelta(m, accountId)
      balance = sumCents([balance, delta])
      return { movement: m, delta, balance }
    })
}
/** Consumption indicators exclude transfers and balance adjustments. */
export function consumptionRows(
  s: FinancialSnapshot,
  from: string,
  to: string,
  asOf: CivilDate,
  regime: CreditRegime = 'purchase',
) {
  return [
    ...s.transactions
      .filter(
        (t) =>
          t.status === 'settled' &&
          realizedDate(t) >= from &&
          realizedDate(t) <= to &&
          realizedDate(t) <= asOf,
      )
      .map((t) => ({
        categoryId: t.categoryId,
        accountId: t.accountId,
        cardId: '',
        date: realizedDate(t) as string,
        direction: t.direction,
        amountCents: t.amountCents,
      })),
    ...creditConsumption(s, from, to, asOf, regime).map((r) => ({
      ...r,
      accountId: '',
      direction: 'expense' as const,
    })),
  ]
}

export function monthlySummary(
  s: FinancialSnapshot,
  month: Date,
  asOf: CivilDate,
  regime: CreditRegime = 'purchase',
) {
  const from = format(startOfMonth(month), 'yyyy-MM-dd'),
    to = format(endOfMonth(month), 'yyyy-MM-dd')
  const rows = consumptionRows(s, from, to, asOf, regime)
  const income = sumCents(rows.filter((t) => t.direction === 'income').map((t) => t.amountCents)),
    expense = sumCents([...rows.filter((t) => t.direction === 'expense').map((t) => t.amountCents)])
  const categories = s.categories
    .map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      amountCents: sumCents([
        ...rows
          .filter((t) => t.categoryId === c.id && t.direction === 'expense')
          .map((t) => t.amountCents),
      ]),
    }))
    .filter((c) => c.amountCents !== 0)
  const hasHistory =
    bankMovementsFrom(s).some((m) => m.status === 'settled' && movementDate(m) <= to) ||
    s.accounts.some((a) => a.openingBalanceCents !== 0 && a.openingDate <= to)
  const evolution =
    hasHistory && from <= asOf
      ? eachDayOfInterval({
          start: startOfMonth(month),
          end: to > asOf ? new Date(`${asOf}T12:00:00`) : endOfMonth(month),
        }).map((day) => {
          const date = format(day, 'yyyy-MM-dd') as CivilDate
          return { date, balanceCents: sumCents(Object.values(balancesAt(s, date))) }
        })
      : []
  return { income, expense, net: sumCents([income, -expense]), categories, evolution }
}
