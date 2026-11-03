import { describe, expect, it } from 'vitest'
import { accountBalance, distributeCents, formatMoney, parseBRL, sumCents } from './money'
import type { BankAccount, Transaction, Transfer, InvoicePayment } from './models'
const entity = { id: 'a', createdAt: '', updatedAt: '' }
const account: BankAccount = {
  ...entity,
  name: 'Conta',
  institution: 'Banco',
  type: 'checking',
  color: 'sage',
  openingDate: '2026-01-01',
  openingBalanceCents: 10000,
}
const tx: Transaction = {
  ...entity,
  accountId: 'a',
  categoryId: 'c',
  description: 'Pix',
  amountCents: 2500,
  direction: 'expense',
  method: 'pix',
  date: '2026-01-02',
  status: 'settled',
}
describe('money policies', () => {
  it('parses BRL without fractional cent loss and accepts negative balances', () => {
    expect(parseBRL('1.234,56')).toBe(123456)
    expect(parseBRL('-0,01')).toBe(-1)
    expect(parseBRL('12,1')).toBe(1210)
    expect(parseBRL('0')).toBe(0)
  })
  it.each(['1.2', '1,001', '', 'NaN', '1e3', '10.000.000.000,00'])(
    'rejects malformed or oversized values: %s',
    (value) => expect(() => parseBRL(value)).toThrow(),
  )
  it('formats BRL', () => expect(formatMoney(123456).replace(/\s/g, ' ')).toBe('R$ 1.234,56'))
  it('distributes cents exactly, assigning remainder to first installments', () => {
    expect(distributeCents(100, 3)).toEqual([34, 33, 33])
    expect(sumCents(distributeCents(10001, 12))).toBe(10001)
    expect(() => distributeCents(100, 0)).toThrow()
  })
  it('guards unsafe arithmetic', () => {
    expect(() => sumCents([Number.MAX_SAFE_INTEGER, 1])).toThrow()
    expect(() => sumCents([1.5])).toThrow()
  })
  it('counts settled debit and received income only', () => {
    expect(
      accountBalance(account, [
        tx,
        { ...tx, id: 'income', direction: 'income', amountCents: 5000 },
        { ...tx, id: 'pending', status: 'pending' },
      ]),
    ).toBe(12500)
  })
  it('respects settlement date and cutoff', () => {
    expect(
      accountBalance(account, [{ ...tx, settledDate: '2026-02-02' }], [], [], [], '2026-01-31'),
    ).toBe(10000)
  })
  it('does not include accounts before their opening date', () => {
    expect(accountBalance(account, [], [], [], [], '2025-12-31')).toBe(0)
  })
  it('transfers preserve combined balance', () => {
    const transfer: Transfer = {
      ...entity,
      sourceAccountId: 'a',
      destinationAccountId: 'b',
      amountCents: 3000,
      date: '2026-01-02',
      description: '',
    }
    expect(accountBalance(account, [], [transfer])).toBe(7000)
    expect(accountBalance({ ...account, id: 'b', openingBalanceCents: 0 }, [], [transfer])).toBe(
      3000,
    )
  })
  it('invoice payment debits bank once without recording consumption again', () => {
    const payment: InvoicePayment = {
      ...entity,
      invoiceId: 'invoice',
      accountId: 'a',
      amountCents: 2000,
      date: '2026-01-03',
    }
    expect(accountBalance(account, [], [], [payment])).toBe(8000)
  })
})
