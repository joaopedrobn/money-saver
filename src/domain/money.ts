import type {
  BankAccount,
  Transaction,
  Transfer,
  InvoicePayment,
  BalanceAdjustment,
  CivilDate,
  MovementStatus,
} from './models'
export const realizedDate = (value: { date: CivilDate; settledDate?: CivilDate }) =>
  value.settledDate ?? value.date
export const isRealized = (value: { status?: MovementStatus }) =>
  value.status === undefined || value.status === 'settled'
export function assertCents(value: number): void {
  if (!Number.isSafeInteger(value)) throw new Error('Valor monetário fora do intervalo seguro.')
}
export function sumCents(values: number[]): number {
  return values.reduce((sum, value) => {
    assertCents(value)
    const next = sum + value
    assertCents(next)
    return next
  }, 0)
}
export function parseBRL(value: string): number {
  const normalized = value.trim()
  if (!/^-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/.test(normalized))
    throw new Error('Use um valor como 1.234,56.')
  const negative = normalized.startsWith('-')
  const [whole, fraction = ''] = normalized.replace('-', '').replaceAll('.', '').split(',')
  const cents = (Number(whole) * 100 + Number(fraction.padEnd(2, '0'))) * (negative ? -1 : 1)
  assertCents(cents)
  if (Math.abs(cents) > 999_999_999_999) throw new Error('O valor máximo é R$ 9.999.999.999,99.')
  return cents
}
export const formatMoney = (cents: number) => {
  assertCents(cents)
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}
export const formatMoneyInput = (cents: number) => {
  assertCents(cents)
  return (cents / 100).toFixed(2).replace('.', ',')
}
/** Only settled bank movements affect balance; credit purchases never enter this function. */
export function accountBalance(
  account: BankAccount,
  transactions: Transaction[] = [],
  transfers: Transfer[] = [],
  payments: InvoicePayment[] = [],
  adjustments: BalanceAdjustment[] = [],
  asOf: CivilDate = '9999-12-31',
): number {
  if (account.openingDate > asOf) return 0
  return sumCents([
    account.openingBalanceCents,
    ...transactions
      .filter(
        (t) =>
          t.accountId === account.id && t.status === 'settled' && (t.settledDate ?? t.date) <= asOf,
      )
      .map((t) => (t.direction === 'income' ? t.amountCents : -t.amountCents)),
    ...transfers
      .filter(
        (t) =>
          isRealized(t) &&
          realizedDate(t) <= asOf &&
          (t.sourceAccountId === account.id || t.destinationAccountId === account.id),
      )
      .map((t) => (t.destinationAccountId === account.id ? t.amountCents : -t.amountCents)),
    ...payments
      .filter((p) => p.accountId === account.id && p.date <= asOf)
      .map((p) => -p.amountCents),
    ...payments
      .filter((p) => p.accountId === account.id && p.reversalDate && p.reversalDate <= asOf)
      .map((p) => p.amountCents),
    ...adjustments
      .filter((a) => a.accountId === account.id && isRealized(a) && realizedDate(a) <= asOf)
      .map((a) => a.deltaCents),
  ])
}
/** Policy only. Invoice allocation by closing dates is intentionally deferred. */
export function distributeCents(total: number, count: number): number[] {
  assertCents(total)
  if (total < 0 || !Number.isInteger(count) || count < 1 || count > 360)
    throw new Error('Distribuição inválida.')
  const base = Math.floor(total / count),
    remainder = total % count
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0))
}
