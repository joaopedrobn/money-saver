import { expect, it } from 'vitest'
import { installmentPlan } from './credit'
import { monthlySummary } from './finance'
import { financialReport, previousReportPeriod, reportPeriod, type ReportFilter } from './reports'
import type { CreditSnapshot, Transaction } from './models'

const entity = { createdAt: '', updatedAt: '' }
const tx = (
  id: string,
  amountCents: number,
  date: Transaction['date'],
  extra: Partial<Transaction> = {},
): Transaction => ({
  ...entity,
  id,
  accountId: 'a',
  categoryId: 'food',
  description: id,
  direction: 'expense',
  method: 'pix',
  status: 'settled',
  date,
  amountCents,
  ...extra,
})
function snapshot(): CreditSnapshot {
  const card = {
    ...entity,
    id: 'card',
    name: 'Cartão',
    accountId: 'a',
    closingDay: 20,
    dueDay: 25,
    limitCents: 100000,
  }
  const plan = installmentPlan(card, {
    date: '2026-01-05',
    amountCents: 10001,
    feeCents: 0,
    installmentCount: 3,
  })
  return {
    accounts: ['a', 'b'].map((id) => ({
      ...entity,
      id,
      name: id,
      institution: 'Banco',
      type: 'checking',
      openingBalanceCents: 100000,
      openingDate: '2025-01-01',
      color: 'sage',
    })),
    categories: [
      {
        ...entity,
        id: 'food',
        name: 'Alimentação',
        direction: 'expense',
        icon: 'coffee',
        color: 'rose',
        archived: true,
      },
      {
        ...entity,
        id: 'salary',
        name: 'Salário',
        direction: 'income',
        icon: 'wallet',
        color: 'sage',
      },
    ],
    transactions: [
      tx('dec', 500, '2025-12-15'),
      tx('jan', 2000, '2026-01-15'),
      tx('income', 20000, '2026-01-10', { direction: 'income', categoryId: 'salary' }),
      tx('b-expense', 1000, '2026-01-16', { accountId: 'b' }),
      tx('pending', 90000, '2026-01-12', { status: 'pending' }),
      tx('planned', 80000, '2026-01-12', { status: 'planned' }),
      tx('cancelled', 70000, '2026-01-12', { status: 'cancelled' }),
    ],
    transfers: [
      {
        ...entity,
        id: 'transfer',
        sourceAccountId: 'a',
        destinationAccountId: 'b',
        amountCents: 5000,
        date: '2026-01-17',
        description: 'Transferência',
        status: 'settled',
      },
    ],
    adjustments: [
      {
        ...entity,
        id: 'adjust',
        accountId: 'a',
        deltaCents: 123,
        date: '2026-01-18',
        reason: 'Ajuste',
      },
    ],
    payments: [
      {
        ...entity,
        id: 'payment',
        invoiceId: 'invoice-0',
        accountId: 'b',
        amountCents: 3334,
        date: '2026-01-25',
      },
    ],
    cards: [card],
    purchases: [
      {
        ...entity,
        id: 'purchase',
        cardId: 'card',
        categoryId: 'food',
        description: 'Compra',
        amountCents: 10001,
        installmentCount: 3,
        date: '2026-01-05',
      },
    ],
    invoices: plan.map((p, index) => ({
      ...entity,
      ...p.cycle,
      id: `invoice-${index}`,
      cardId: 'card',
    })),
    installments: plan.map((p, index) => ({
      ...entity,
      id: `part-${index}`,
      purchaseId: 'purchase',
      invoiceId: `invoice-${index}`,
      number: p.number,
      amountCents: p.amountCents,
      principalCents: p.principalCents,
    })),
    invoiceEntries: [],
    settings: [],
  }
}
const filter: ReportFilter = { from: '2026-01-01', to: '2026-01-31', regime: 'purchase' }
const asOf = '2026-04-30'

it('compares complete calendar months and custom intervals with equivalent preceding periods', () => {
  expect(previousReportPeriod('2026-03-01', '2026-03-31')).toEqual({
    from: '2026-02-01',
    to: '2026-02-28',
  })
  expect(previousReportPeriod('2026-03-10', '2026-03-16')).toEqual({
    from: '2026-03-03',
    to: '2026-03-09',
  })
  const r = financialReport(snapshot(), filter, asOf)
  expect(r.previous).toEqual({ income: 0, expense: 500, net: -500 })
  expect(r.current).toEqual({ income: 20000, expense: 13001, net: 6999 })
  expect(r.monthly[0]).toMatchObject(r.current)
})
it('reconciles category totals including archived categories with the existing summary', () => {
  const s = snapshot(),
    r = financialReport(s, filter, asOf)
  expect(r.categories).toMatchObject([{ id: 'food', amountCents: 13001 }])
  expect(r.current).toEqual({
    income: monthlySummary(s, new Date(2026, 0, 1), asOf).income,
    expense: monthlySummary(s, new Date(2026, 0, 1), asOf).expense,
    net: monthlySummary(s, new Date(2026, 0, 1), asOf).net,
  })
})
it('recognizes installments once by competence and preserves cent remainders across months', () => {
  const s = snapshot()
  const jan = financialReport(s, { ...filter, regime: 'installment', cardId: 'card' }, asOf)
  expect(jan.current.expense).toBe(3334)
  const quarter = financialReport(
    s,
    { ...filter, to: '2026-03-31', regime: 'installment', cardId: 'card' },
    asOf,
  )
  expect(quarter.monthly.map((m) => m.expense)).toEqual([3334, 3334, 3333])
  expect(quarter.current.expense).toBe(10001)
  expect(financialReport(s, { ...filter, cardId: 'card' }, asOf).current.expense).toBe(10001)
})
it('keeps transfers, adjustments and reversed invoice payments in balances only', () => {
  const s = snapshot()
  s.payments[0].reversalDate = '2026-02-02'
  const jan = financialReport(s, filter, asOf)
  expect(jan.closing).toBe(213289)
  expect(jan.current).toEqual({ income: 20000, expense: 13001, net: 6999 })
  const feb = financialReport(s, { ...filter, from: '2026-02-01', to: '2026-02-28' }, asOf)
  expect(feb.current).toEqual({ income: 0, expense: 0, net: 0 })
  expect(feb.balanceChange).toBe(3334)
})
it('applies account, card, category and realized date filters to all consumption aggregates', () => {
  const s = snapshot()
  s.transactions.push(tx('late', 111, '2026-01-01', { settledDate: '2026-02-01' }))
  const account = financialReport(s, { ...filter, accountId: 'b', categoryId: 'food' }, asOf)
  expect(account.current).toEqual({ income: 0, expense: 1000, net: -1000 })
  expect(account.sources).toEqual([{ id: 'account:b', name: 'Conta · b', amountCents: 1000 }])
  expect(account.closing).toBe(100666)
  const card = financialReport(s, { ...filter, cardId: 'card', categoryId: 'food' }, asOf)
  expect(card.current.expense).toBe(10001)
  expect(card.sources).toEqual([{ id: 'card:card', name: 'Cartão · Cartão', amountCents: 10001 }])
  expect(
    financialReport(s, { ...filter, cardId: 'card', categoryId: 'salary' }, asOf).current.expense,
  ).toBe(0)
})
it('deducts dated purchase and charge reversals without turning credit transfers into consumption', () => {
  const s = snapshot()
  s.invoiceEntries = [
    {
      ...entity,
      id: 'refund',
      invoiceId: 'invoice-0',
      purchaseId: 'purchase',
      kind: 'refund',
      amountCents: 2000,
      date: '2026-02-02',
      description: 'Estorno',
    },
    {
      ...entity,
      id: 'charge',
      invoiceId: 'invoice-0',
      categoryId: 'food',
      kind: 'charge',
      amountCents: 100,
      date: '2026-02-01',
      description: 'Encargo',
    },
    {
      ...entity,
      id: 'reverse',
      invoiceId: 'invoice-0',
      categoryId: 'food',
      kind: 'charge-reversal',
      amountCents: 100,
      date: '2026-02-02',
      description: 'Estorno de encargo',
    },
    {
      ...entity,
      id: 'credit',
      invoiceId: 'invoice-0',
      kind: 'credit-out',
      amountCents: 500,
      date: '2026-02-02',
      description: 'Aplicação',
    },
  ]
  const feb = financialReport(
    s,
    { ...filter, from: '2026-02-01', to: '2026-02-28', cardId: 'card' },
    asOf,
  )
  expect(feb.current.expense).toBe(-2000)
  expect(feb.categories[0].amountCents).toBe(-2000)
  expect(
    financialReport(s, { ...filter, regime: 'installment', cardId: 'card' }, asOf).current.expense,
  ).toBe(1334)
  expect(reportPeriod('3', '', '', '', '2026-04-15')).toEqual({
    from: '2026-02-01',
    to: '2026-04-15',
  })
  expect(() => reportPeriod('custom', '', '2026-02-30', '2026-03-01', asOf)).toThrow()
  expect(() => reportPeriod('custom', '', '2026-03-10', '2026-03-01', asOf)).toThrow()
})
