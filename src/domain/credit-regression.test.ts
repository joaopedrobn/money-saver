import { it, expect } from 'vitest'
import { installmentPlan, invoiceCycle } from './credit'
import { monthlySummary } from './finance'
import type { CreditCard, CreditCardInvoice, FinancialSnapshot } from './models'
import { FinancialDatabase } from '@/infrastructure/database'
import { DexieSettingsRepository } from '@/infrastructure/credit-repository'
import { DexieBackupRepository } from '@/infrastructure/backup-repository'
import { assertCreditIntegrity } from './credit-integrity'
const card: CreditCard = {
  id: 'card',
  name: 'Cartão',
  accountId: 'account',
  closingDay: 10,
  dueDay: 20,
  limitCents: 500000,
  createdAt: '',
  updatedAt: '',
}
it('rejects snapshots whose global totals exceed the safe integer range', () => {
  const s: FinancialSnapshot = {
    accounts: [
      {
        id: 'account',
        name: 'Conta',
        institution: 'Banco',
        type: 'checking',
        openingBalanceCents: 0,
        openingDate: '2026-01-01',
        color: 'sage',
        createdAt: '',
        updatedAt: '',
      },
    ],
    transactions: [],
    transfers: [],
    adjustments: [],
    payments: [],
    categories: [],
    cards: Array.from({ length: 10000 }, (_, index) => ({
      ...card,
      id: `card-${index}`,
      limitCents: 999_999_999_999,
    })),
  }
  expect(() => assertCreditIntegrity(s)).toThrow('intervalo seguro')
})
it('keeps every newly generated boundary contiguous before an existing locked cycle', () => {
  const march: CreditCardInvoice = {
    ...invoiceCycle(card, '2026-03'),
    id: 'march',
    cardId: card.id,
    createdAt: '',
    updatedAt: '',
  }
  const plan = installmentPlan(
    { ...card, closingDay: 20, dueDay: 25 },
    { date: '2026-01-05', amountCents: 30000, feeCents: 0, installmentCount: 3 },
    [march],
  )
  expect(plan.map((p) => p.cycle.closingDate)).toEqual(['2026-01-20', '2026-02-10', '2026-03-10'])
  expect(plan[1].cycle.startDate).toBe(plan[0].cycle.closingDate)
  expect(plan[2].cycle.startDate).toBe(plan[1].cycle.closingDate)
})
it('rejects invalid civil dates directly in the pure installment engine', () =>
  expect(() =>
    installmentPlan(card, {
      date: '2026-02-30',
      amountCents: 10000,
      feeCents: 0,
      installmentCount: 3,
    }),
  ).toThrow())
it('recognizes future refunded installments in their invoice competence, not as fictitious later consumption', () => {
  const plan = installmentPlan(card, {
      date: '2026-01-05',
      amountCents: 300000,
      feeCents: 0,
      installmentCount: 6,
    }),
    invoices: CreditCardInvoice[] = plan.map((p, index) => ({
      ...p.cycle,
      id: `invoice-${index}`,
      cardId: card.id,
      createdAt: '',
      updatedAt: '',
    }))
  const s: FinancialSnapshot = {
    accounts: [],
    transactions: [],
    transfers: [],
    adjustments: [],
    categories: [
      {
        id: 'category',
        name: 'Compras',
        direction: 'expense',
        color: 'rose',
        icon: 'shopping',
        createdAt: '',
        updatedAt: '',
      },
    ],
    cards: [card],
    purchases: [
      {
        id: 'purchase',
        cardId: card.id,
        categoryId: 'category',
        description: 'Compra',
        amountCents: 300000,
        feeCents: 0,
        date: '2026-01-05',
        installmentCount: 6,
        createdAt: '',
        updatedAt: '',
      },
    ],
    installments: plan.map((p, index) => ({
      id: `part-${index}`,
      purchaseId: 'purchase',
      invoiceId: invoices[index].id,
      number: p.number,
      amountCents: p.amountCents,
      principalCents: p.principalCents,
      createdAt: '',
      updatedAt: '',
    })),
    invoices,
    payments: [
      {
        id: 'pay',
        invoiceId: invoices[0].id,
        accountId: 'account',
        amountCents: 50000,
        date: '2026-01-15',
        createdAt: '',
        updatedAt: '',
      },
    ],
    invoiceEntries: invoices.slice(1).map((i, index) => ({
      id: `refund-${index}`,
      invoiceId: i.id,
      purchaseId: 'purchase',
      categoryId: 'category',
      kind: 'refund',
      amountCents: index === 0 ? 100000 : 50000,
      date: '2026-01-25',
      description: 'Devolução integral',
      createdAt: '',
      updatedAt: '',
    })),
  }
  expect(monthlySummary(s, new Date(2026, 0, 1), '2026-11-03', 'installment').expense).toBe(50000)
  expect(monthlySummary(s, new Date(2026, 1, 1), '2026-11-03', 'installment').expense).toBe(-50000)
  expect(monthlySummary(s, new Date(2026, 2, 1), '2026-11-03', 'installment').expense).toBe(0)
  expect(monthlySummary(s, new Date(2026, 0, 1), '2026-11-03', 'purchase').expense).toBe(0)
})
it('persists selected reporting regime after reopening and includes it in backup', async () => {
  let database = new FinancialDatabase(`settings-${crypto.randomUUID()}`)
  try {
    await new DexieSettingsRepository(database).setCreditRegime('installment')
    const name = database.name
    database.close()
    database = new FinancialDatabase(name)
    expect((await database.settings.toArray())[0].creditRegime).toBe('installment')
    expect((await new DexieBackupRepository(database).export()).data.settings[0].creditRegime).toBe(
      'installment',
    )
  } finally {
    await database.delete()
  }
})
it('restores legacy v2 bank-only backup without inventing credit debt', async () => {
  const database = new FinancialDatabase(`legacy-backup-${crypto.randomUUID()}`)
  try {
    const r = new DexieBackupRepository(database),
      copy = await r.export()
    const { invoiceEntries: ignored, ...legacyData } = copy.data
    expect(ignored).toEqual([])
    await r.restore({ version: 2, exportedAt: copy.exportedAt, data: legacyData }, 'RESTAURAR')
    expect(await database.cards.count()).toBe(0)
    expect(await database.payments.count()).toBe(0)
    expect(await database.invoiceEntries.count()).toBe(0)
  } finally {
    await database.delete()
  }
})
