import { describe, expect, it } from 'vitest'
import {
  balancesAt,
  compareMovements,
  filterMovements,
  monthlySummary,
  movementKey,
  statement,
} from './finance'
import type { FinancialSnapshot, Movement, Transaction } from './models'
const entity = {
  id: 'a',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}
const base: FinancialSnapshot = {
  accounts: [
    {
      ...entity,
      name: 'Conta',
      institution: 'Banco',
      type: 'checking',
      openingBalanceCents: 10000,
      openingDate: '2026-01-01',
      color: 'sage',
    },
  ],
  transactions: [],
  transfers: [],
  adjustments: [],
  payments: [],
  categories: [
    {
      ...entity,
      id: 'c',
      name: 'Alimentação',
      direction: 'expense',
      color: 'rose',
      icon: 'coffee',
    },
  ],
}
const tx: Transaction = {
  ...entity,
  id: 'tx',
  accountId: 'a',
  categoryId: 'c',
  description: 'Pão e café',
  amountCents: 123,
  direction: 'expense',
  method: 'pix',
  date: '2026-01-05',
  status: 'settled',
  settledDate: '2026-01-05',
  notes: 'Mercado da estação',
}
describe('financial projections and statement policies', () => {
  it('empty database produces no artificial chart', () => {
    expect(
      monthlySummary({ ...base, accounts: [] }, new Date(2026, 0, 1), '2026-01-10'),
    ).toMatchObject({ income: 0, expense: 0, net: 0, categories: [], evolution: [] })
  })
  it('produces one actual daily balance up to cutoff, including opening balances', () => {
    const result = monthlySummary(
      { ...base, transactions: [tx] },
      new Date(2026, 0, 1),
      '2026-01-10',
    )
    expect(result.evolution).toHaveLength(10)
    expect(result.evolution[0].balanceCents).toBe(10000)
    expect(result.evolution.at(-1)?.balanceCents).toBe(9877)
    expect(result.categories).toMatchObject([{ name: 'Alimentação', amountCents: 123 }])
  })
  it('does not project future realized balances into the chart', () => {
    expect(monthlySummary(base, new Date(2026, 11, 1), '2026-01-10').evolution).toEqual([])
  })
  it('search matches description and notes regardless of accents or case', () => {
    const movement: Movement = { ...tx, kind: 'transaction' }
    expect(filterMovements([movement], { search: 'CAFE' })).toHaveLength(1)
    expect(filterMovements([movement], { search: 'estacao' })).toHaveLength(1)
    expect(filterMovements([movement], { search: 'missing' })).toHaveLength(0)
  })
  it('same-date, same-timestamp rows have stable UUID tie breakers', () => {
    const a: Movement = { ...tx, id: 'aa', kind: 'transaction' },
      b: Movement = { ...tx, id: 'bb', kind: 'transaction' }
    expect(compareMovements(a, b)).toBeLessThan(0)
    expect(movementKey(a)).toBe('transaction:aa')
  })
  it('archived categories still appear in historical expense indicators', () => {
    const result = monthlySummary(
      {
        ...base,
        transactions: [tx],
        categories: base.categories.map((c) => ({ ...c, archived: true })),
      },
      new Date(2026, 0, 1),
      '2026-01-10',
    )
    expect(result.categories[0].amountCents).toBe(123)
  })
  it('statement final balance matches the account balance with mixed movements', () => {
    const snapshot: FinancialSnapshot = {
      ...base,
      transactions: [tx, { ...tx, id: 'pending', status: 'pending', settledDate: undefined }],
      transfers: [
        {
          ...entity,
          id: 'transfer',
          sourceAccountId: 'b',
          destinationAccountId: 'a',
          amountCents: 222,
          date: '2026-01-06',
          status: 'settled',
          description: 'Transferência',
        },
      ],
      adjustments: [
        {
          ...entity,
          id: 'adjust',
          accountId: 'a',
          deltaCents: -10,
          date: '2026-01-07',
          reason: 'Ajuste',
          status: 'settled',
        },
      ],
    }
    expect(statement(snapshot, 'a', '2026-01-31').at(-1)?.balance).toBe(
      balancesAt(snapshot, '2026-01-31').a,
    )
    expect(statement(snapshot, 'a', '2025-12-31')).toEqual([])
  })
})
