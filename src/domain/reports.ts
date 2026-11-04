import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  eachMonthOfInterval,
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
} from 'date-fns'
import type { CivilDate, CreditRegime, FinancialSnapshot } from './models'
import { balancesAt, bankMovementsFrom, consumptionRows, movementDate } from './finance'
import { sumCents } from './money'
import { civilDateSchema } from './financial-validation'

export interface ReportFilter {
  from: CivilDate
  to: CivilDate
  accountId?: string
  cardId?: string
  categoryId?: string
  regime: CreditRegime
}
const civil = (d: Date) => format(d, 'yyyy-MM-dd') as CivilDate
export function reportPeriod(
  mode: string,
  month: string,
  from: string,
  to: string,
  asOf: CivilDate,
) {
  if (mode === 'custom') {
    const parsedStart = civilDateSchema.safeParse(from),
      parsedEnd = civilDateSchema.safeParse(to)
    if (!parsedStart.success || !parsedEnd.success)
      throw new Error('Informe datas válidas para o intervalo.')
    const start = parsedStart.data,
      end = parsedEnd.data
    if (start > end) throw new Error('A data inicial deve ser anterior ou igual à final.')
    return { from: start, to: end }
  }
  if (mode === 'month' && !civilDateSchema.safeParse(`${month}-01`).success)
    throw new Error('Selecione um mês válido.')
  if (!['month', '3', '6', '12'].includes(mode)) throw new Error('Selecione um período válido.')
  const anchor = parseISO(`${mode === 'month' ? month : asOf.slice(0, 7)}-01`)
  const start = civil(startOfMonth(addMonths(anchor, mode === 'month' ? 0 : 1 - Number(mode))))
  return { from: start, to: mode === 'month' ? civil(endOfMonth(anchor)) : asOf }
}
/** A complete calendar span compares to the preceding equivalent months. Other spans use equal days. */
export function previousReportPeriod(from: CivilDate, to: CivilDate) {
  const start = parseISO(from),
    end = parseISO(to)
  if (from === civil(startOfMonth(start)) && to === civil(endOfMonth(end))) {
    const months =
      (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1
    return { from: civil(addMonths(start, -months)), to: civil(addDays(start, -1)) }
  }
  const days = differenceInCalendarDays(end, start) + 1
  return { from: civil(addDays(start, -days)), to: civil(addDays(start, -1)) }
}
export function financialReport(s: FinancialSnapshot, filter: ReportFilter, asOf: CivilDate) {
  const { from, to, accountId, cardId, categoryId, regime } = filter
  const previousPeriod = previousReportPeriod(from, to)
  const select = (start: string, end: string) =>
    consumptionRows(s, start, end, asOf, regime).filter(
      (r) =>
        (!accountId || r.accountId === accountId) &&
        (!cardId || r.cardId === cardId) &&
        (!categoryId || r.categoryId === categoryId),
    )
  const totals = (rows: ReturnType<typeof select>) => {
    const income = sumCents(rows.filter((r) => r.direction === 'income').map((r) => r.amountCents))
    const expense = sumCents(
      rows.filter((r) => r.direction === 'expense').map((r) => r.amountCents),
    )
    return { income, expense, net: sumCents([income, -expense]) }
  }
  const rows = select(from, to),
    previousRows = select(previousPeriod.from, previousPeriod.to)
  const current = totals(rows),
    previous = totals(previousRows)
  const expenseRows = rows.filter((r) => r.direction === 'expense')
  const group = (
    items: { id: string; name: string }[],
    key: 'categoryId' | 'accountId' | 'cardId',
  ) =>
    items
      .map((item) => ({
        ...item,
        amountCents: sumCents(
          expenseRows.filter((r) => r[key] === item.id).map((r) => r.amountCents),
        ),
      }))
      .filter((item) => item.amountCents !== 0)
      .sort((a, b) => b.amountCents - a.amountCents)
  const months =
    rows.length > 0
      ? eachMonthOfInterval({ start: parseISO(from), end: parseISO(to < asOf ? to : asOf) }).map(
          (d) => format(d, 'yyyy-MM'),
        )
      : []
  const monthly = months.map((month) => ({
    name: month,
    ...totals(rows.filter((r) => r.date.startsWith(month))),
  }))
  // Balances retain the complete ledger. Category/card consumption cannot define a bank balance.
  const bank = { ...s, accounts: s.accounts.filter((a) => !accountId || a.id === accountId) }
  const balance = (date: CivilDate) => sumCents(Object.values(balancesAt(bank, date)))
  const cutoff = to < asOf ? to : asOf
  const openingDate = civil(addDays(parseISO(from), -1))
  const dates = new Set<CivilDate>([from, cutoff])
  for (const a of bank.accounts)
    if (a.openingDate >= from && a.openingDate <= cutoff) dates.add(a.openingDate)
  for (const m of bankMovementsFrom(bank)) {
    const date = movementDate(m)
    if (
      m.status === 'settled' &&
      date >= from &&
      date <= cutoff &&
      bank.accounts.some((a) => a.id === m.accountId || a.id === m.destinationAccountId)
    )
      dates.add(date)
  }
  const evolution =
    from <= cutoff && bank.accounts.some((a) => a.openingDate <= cutoff)
      ? [...dates].sort().map((date) => ({ name: date, balanceCents: balance(date) }))
      : []
  const opening = from <= cutoff ? balance(openingDate) : null
  const closing = from <= cutoff ? balance(cutoff) : null
  return {
    current,
    previous,
    previousPeriod,
    monthly,
    evolution,
    opening,
    closing,
    balanceChange: opening !== null && closing !== null ? sumCents([closing, -opening]) : null,
    categories: group(s.categories, 'categoryId'),
    sources: [
      ...group(
        s.accounts.map((a) => ({ id: a.id, name: `Conta · ${a.name}` })),
        'accountId',
      ).map((a) => ({ ...a, id: `account:${a.id}` })),
      ...group(
        (s.cards ?? []).map((c) => ({ id: c.id, name: `Cartão · ${c.nickname || c.name}` })),
        'cardId',
      ).map((c) => ({ ...c, id: `card:${c.id}` })),
    ],
    hasConsumption: rows.length > 0,
    comparison: [
      { name: 'Anterior', ...previous },
      { name: 'Selecionado', ...current },
    ],
  }
}
