import { describe, it, expect } from 'vitest'
import {
  clampedDate,
  invoiceCycle,
  installmentPlan,
  invoiceSummary,
  cardSummary,
  creditPlanning,
} from './credit'
import type { CreditCard, FinancialSnapshot, CreditCardInvoice } from './models'
const card: CreditCard = {
  id: 'c',
  createdAt: '',
  updatedAt: '',
  accountId: 'a',
  name: 'Meu cartão',
  limitCents: 500000,
  closingDay: 10,
  dueDay: 20,
}
const purchase = {
  date: '2026-01-05' as const,
  amountCents: 300000,
  feeCents: 0,
  installmentCount: 6,
}
describe('billing calendar and integer installment policies', () => {
  it('cash credit purchase generates one installment', () =>
    expect(installmentPlan(card, { ...purchase, installmentCount: 1 })).toMatchObject([
      { number: 1, amountCents: 300000, cycle: { period: '2026-01' } },
    ]))
  it('distributes six interest-free installments', () =>
    expect(installmentPlan(card, purchase).map((p) => p.amountCents)).toEqual([
      50000, 50000, 50000, 50000, 50000, 50000,
    ]))
  it('includes explicit additions without floats', () => {
    const parts = installmentPlan(card, {
      ...purchase,
      amountCents: 10000,
      feeCents: 101,
      installmentCount: 3,
    })
    expect(parts.map((p) => p.amountCents)).toEqual([3367, 3367, 3367])
    expect(parts.reduce((sum, p) => sum + p.principalCents, 0)).toBe(10000)
  })
  it('distributes remainder deterministically', () =>
    expect(
      installmentPlan(card, { ...purchase, amountCents: 10000, installmentCount: 3 }).map(
        (p) => p.amountCents,
      ),
    ).toEqual([3334, 3333, 3333]))
  it.each([
    ['2026-01-09', '2026-01'],
    ['2026-01-10', '2026-02'],
    ['2026-01-11', '2026-02'],
  ] as const)('purchase %s belongs to cycle %s', (date, period) =>
    expect(installmentPlan(card, { ...purchase, date })[0].cycle.period).toBe(period),
  )
  it('due date can be in the following month', () =>
    expect(invoiceCycle({ ...card, dueDay: 5 }, '2026-01')).toMatchObject({
      closingDate: '2026-01-10',
      dueDate: '2026-02-05',
    }))
  it('equal closing/due day uses next month', () =>
    expect(invoiceCycle({ ...card, dueDay: 10 }, '2026-01').dueDate).toBe('2026-02-10'))
  it('clamps day 31 and handles leap February', () => {
    expect(clampedDate('2026-02', 31)).toBe('2026-02-28')
    expect(clampedDate('2028-02', 31)).toBe('2028-02-29')
    expect(clampedDate('2026-04', 31)).toBe('2026-04-30')
  })
  it('purchase on clamped closing goes to next invoice', () =>
    expect(
      installmentPlan({ ...card, closingDay: 31 }, { ...purchase, date: '2026-02-28' })[0].cycle
        .period,
    ).toBe('2026-03'))
  it('handles year rollover and 360-month schedules', () => {
    const plan = installmentPlan(card, { ...purchase, date: '2026-12-10', installmentCount: 360 })
    expect(plan[0].cycle.period).toBe('2027-01')
    expect(plan.at(-1)?.cycle.period).toBe('2056-12')
    expect(plan.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.cycle.dueDate))).toBe(true)
  })
  it('rejects zero-cent installments and invalid day configurations', () => {
    expect(() =>
      installmentPlan(card, { ...purchase, amountCents: 1, installmentCount: 3 }),
    ).toThrow()
    expect(() => clampedDate('2026-02', 32)).toThrow()
  })
  it('uses persisted cycles after card configuration changes', () => {
    const inv: CreditCardInvoice = {
      id: 'i',
      cardId: card.id,
      createdAt: '',
      updatedAt: '',
      ...invoiceCycle(card, '2026-01'),
    }
    const changed = { ...card, closingDay: 20, dueDay: 25 }
    expect(
      installmentPlan(changed, { ...purchase, date: '2026-01-15' }, [inv])[0].cycle.period,
    ).toBe('2026-02')
  })
  it('preserves adjacent purchase-period boundaries when dates change', () => {
    const prior: CreditCardInvoice = {
      id: 'i',
      cardId: card.id,
      createdAt: '',
      updatedAt: '',
      ...invoiceCycle(card, '2026-01'),
    }
    expect(
      installmentPlan(
        { ...card, closingDay: 20, dueDay: 25 },
        { ...purchase, date: '2026-01-15' },
        [prior],
      )[0].cycle.startDate,
    ).toBe('2026-01-10')
  })
  it('backfills historical gaps using the next locked cycle boundary', () => {
    const future: CreditCardInvoice = {
      id: 'i',
      cardId: card.id,
      createdAt: '',
      updatedAt: '',
      ...invoiceCycle(card, '2026-02'),
    }
    expect(
      installmentPlan({ ...card, closingDay: 20 }, { ...purchase, date: '2026-01-15' }, [future])[0]
        .cycle.period,
    ).toBe('2026-02')
  })
})
const invoice: CreditCardInvoice = {
  id: 'i',
  cardId: 'c',
  createdAt: '',
  updatedAt: '',
  ...invoiceCycle(card, '2026-01'),
}
const snapshot: FinancialSnapshot = {
  accounts: [],
  transactions: [],
  transfers: [],
  adjustments: [],
  payments: [],
  categories: [],
  cards: [card],
  purchases: [
    {
      id: 'p',
      createdAt: '',
      updatedAt: '',
      cardId: 'c',
      categoryId: 'cat',
      description: 'Compra',
      amountCents: 200000,
      date: '2026-01-05',
      installmentCount: 1,
    },
  ],
  installments: [
    {
      id: 'part',
      createdAt: '',
      updatedAt: '',
      purchaseId: 'p',
      invoiceId: 'i',
      number: 1,
      amountCents: 200000,
    },
  ],
  invoices: [invoice],
  invoiceEntries: [],
}
describe('invoice state and credit policy', () => {
  it('distinguishes closure and payment states', () => {
    expect(invoiceSummary(snapshot, invoice, '2026-01-09')).toMatchObject({
      closed: false,
      paymentStatus: 'unpaid',
      state: 'open',
    })
    expect(invoiceSummary(snapshot, invoice, '2026-01-10')).toMatchObject({
      closed: true,
      state: 'closed',
    })
    expect(invoiceSummary(snapshot, invoice, '2026-01-21').state).toBe('overdue')
  })
  it('supports partial payments and independent overdue flag', () => {
    const s = {
      ...snapshot,
      payments: [
        {
          id: 'pay',
          createdAt: '',
          updatedAt: '',
          invoiceId: 'i',
          accountId: 'a',
          amountCents: 80000,
          date: '2026-01-15' as const,
        },
      ],
    }
    expect(invoiceSummary(s, invoice, '2026-01-16')).toMatchObject({
      paid: 80000,
      remaining: 120000,
      state: 'partial',
    })
    expect(invoiceSummary(s, invoice, '2026-01-21')).toMatchObject({
      paymentStatus: 'partial',
      state: 'overdue',
    })
  })
  it('commits the whole purchase, then releases limit per actual payment', () => {
    expect(cardSummary(snapshot, card, '2026-01-10').used).toBe(200000)
    const s = {
      ...snapshot,
      payments: [
        {
          id: 'pay',
          createdAt: '',
          updatedAt: '',
          invoiceId: 'i',
          accountId: 'a',
          amountCents: 80000,
          date: '2026-01-15' as const,
        },
      ],
    }
    expect(cardSummary(s, card, '2026-01-16')).toMatchObject({ used: 120000, available: 380000 })
  })
  it('reversed payment changes invoice only from actual reversal date', () => {
    const s = {
      ...snapshot,
      payments: [
        {
          id: 'pay',
          createdAt: '',
          updatedAt: '',
          invoiceId: 'i',
          accountId: 'a',
          amountCents: 200000,
          date: '2026-01-15' as const,
          reversalDate: '2026-01-20' as const,
        },
      ],
    }
    expect(invoiceSummary(s, invoice, '2026-01-19').remaining).toBe(0)
    expect(invoiceSummary(s, invoice, '2026-01-20').remaining).toBe(200000)
  })
  it('separates refundable invoice credit from nonnegative remaining debt', () => {
    const s = {
      ...snapshot,
      invoiceEntries: [
        {
          id: 'refund',
          createdAt: '',
          updatedAt: '',
          invoiceId: 'i',
          purchaseId: 'p',
          kind: 'refund' as const,
          amountCents: 200000,
          date: '2026-01-16' as const,
          description: 'Estorno',
        },
      ],
      payments: [
        {
          id: 'pay',
          createdAt: '',
          updatedAt: '',
          invoiceId: 'i',
          accountId: 'a',
          amountCents: 200000,
          date: '2026-01-15' as const,
        },
      ],
    }
    expect(invoiceSummary(s, invoice, '2026-01-16')).toMatchObject({ remaining: 0, credit: 200000 })
    expect(cardSummary(s, card, '2026-01-16')).toMatchObject({
      used: 0,
      available: 500000,
      netCredit: 200000,
    })
  })
  it('projection counts invoice residual once and never adds its installments again', () => {
    const s = {
      ...snapshot,
      payments: [
        {
          id: 'pay',
          createdAt: '',
          updatedAt: '',
          invoiceId: 'i',
          accountId: 'a',
          amountCents: 80000,
          date: '2026-01-15' as const,
        },
      ],
    }
    expect(creditPlanning(s, new Date(2026, 0, 1), '2026-01-16', 320000)).toMatchObject({
      invoiceExpense: 120000,
      commitments: 120000,
      projected: 200000,
    })
  })
})
