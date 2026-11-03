import { afterEach, expect, it } from 'vitest'
import { FinancialDatabase } from './database'
import { DexieAccountRepository } from './repositories'
import { DexieCreditRepository } from './credit-repository'
import { DexieMovementRepository, readSnapshot } from './movement-repository'
import { DexieBackupRepository } from './backup-repository'
import {
  balancesAt,
  bankMovementsFrom,
  filterMovements,
  monthlySummary,
  statement,
} from '@/domain/finance'
import { cardSummary, creditPlanning, invoiceSummary } from '@/domain/credit'
import { assertCreditIntegrity } from '@/domain/credit-integrity'
import { sumCents } from '@/domain/money'
import type { CardInput, MovementInput, PurchaseInput } from '@/domain/models'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { AccountStatement } from '@/features/accounts/AccountStatement'
import { MovementsPage } from '@/features/movements/MovementsPage'
import { CardsPage } from '@/features/cards/CardsPage'
import { InvoicePanel } from '@/features/cards/InvoicePanel'
import { PlanningPage } from '@/features/planning/PlanningPage'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { PurchaseForm } from '@/features/cards/PurchaseForm'
import { PaymentForm } from '@/features/cards/PaymentForm'
import { formatMoney } from '@/domain/money'

// fake-indexeddb is installed by test/setup.ts. Never opens the personal database.
const databases: FinancialDatabase[] = []
afterEach(async () => {
  for (const database of databases.splice(0)) await database.delete()
})

it('audits two accounts/cards through installments, Pix, payments, corrections, refunds and reopening', async () => {
  const name = `phase22-audit-${crypto.randomUUID()}`
  const d = new FinancialDatabase(name)
  databases.push(d)
  const accounts = new DexieAccountRepository(d)
  const credit = new DexieCreditRepository(d)
  const movements = new DexieMovementRepository(d)
  const asOf = '2026-11-03' as const
  const a = await accounts.create({
    name: 'Auditoria A',
    institution: 'Banco A',
    type: 'checking',
    openingBalanceCents: 400000,
    openingDate: '2026-01-01',
    color: 'sage',
  })
  const b = await accounts.create({
    name: 'Auditoria B',
    institution: 'Banco B',
    type: 'checking',
    openingBalanceCents: 100000,
    openingDate: '2026-01-01',
    color: 'blue',
  })
  const categories = await d.categories.toArray()
  const expenseId = categories.find((c) => c.direction === 'expense')!.id
  const incomeId = categories.find((c) => c.direction === 'income')!.id
  const cardInput: CardInput = {
    name: 'Cartão A',
    institution: 'Emissor A',
    accountId: a.id,
    nickname: '',
    brand: 'Visa',
    lastFour: '1234',
    limitCents: 500000,
    closingDay: 10,
    dueDay: 20,
    color: 'sage',
  }
  const ca = await credit.createCard(cardInput)
  const cb = await credit.createCard({
    ...cardInput,
    name: 'Cartão B',
    institution: 'Emissor B',
    accountId: b.id,
    closingDay: 25,
    dueDay: 5,
    limitCents: 200000,
  })
  const purchase: PurchaseInput = {
    cardId: ca.id,
    categoryId: expenseId,
    description: 'Equipamento 6x',
    amountCents: 300000,
    feeCents: 0,
    installmentCount: 6,
    date: '2026-01-05',
  }
  const pa = await credit.createPurchase(purchase)
  const pb = await credit.createPurchase({
    ...purchase,
    cardId: cb.id,
    description: 'Compra com centavos',
    amountCents: 10000,
    installmentCount: 3,
    date: '2026-01-25',
  })
  let s = await readSnapshot(d)
  expect(s.cards).toHaveLength(2)
  expect(ca.accountId).toBe(a.id)
  expect(cb.accountId).toBe(b.id)
  const parts = (id: string) =>
    s.installments.filter((i) => i.purchaseId === id).sort((x, y) => x.number - y.number)
  expect(parts(pa.id).map((i) => i.amountCents)).toEqual(Array(6).fill(50000))
  expect(parts(pb.id).map((i) => i.amountCents)).toEqual([3334, 3333, 3333])
  expect(parts(pb.id).map((i) => s.invoices.find((v) => v.id === i.invoiceId)!.period)).toEqual([
    '2026-02',
    '2026-03',
    '2026-04',
  ])
  expect(parts(pb.id).map((i) => s.invoices.find((v) => v.id === i.invoiceId)!.dueDate)).toEqual([
    '2026-03-05',
    '2026-04-05',
    '2026-05-05',
  ])
  expect(balancesAt(s, asOf)).toEqual({ [a.id]: 400000, [b.id]: 100000 })
  expect(cardSummary(s, ca, asOf).used).toBe(300000)
  expect(cardSummary(s, cb, asOf).used).toBe(10000)

  // Change an unpaid purchase and billing settings without duplicating installments.
  const pbInput: PurchaseInput = {
    ...purchase,
    cardId: cb.id,
    description: 'Compra corrigida',
    amountCents: 12000,
    installmentCount: 3,
    date: '2026-01-25',
  }
  await credit.updatePurchase(pb.id, pbInput)
  const history = await d.installments.where('purchaseId').equals(pb.id).sortBy('number')
  await credit.updateCard(cb.id, {
    ...cardInput,
    name: cb.name,
    accountId: b.id,
    closingDay: 28,
    dueDay: 8,
    limitCents: cb.limitCents,
  })
  expect(await d.installments.where('purchaseId').equals(pb.id).sortBy('number')).toEqual(history)
  expect(await d.purchases.count()).toBe(2)
  expect(await d.installments.count()).toBe(9)

  const movement: MovementInput = {
    kind: 'transaction',
    accountId: a.id,
    categoryId: incomeId,
    description: 'Pix recebido',
    amountCents: 20000,
    direction: 'income',
    method: 'pix',
    date: '2026-01-07',
    status: 'settled',
    settledDate: '2026-01-07',
  }
  await movements.create(movement)
  const pix = await movements.create({
    ...movement,
    categoryId: expenseId,
    description: 'Pix enviado',
    amountCents: 5000,
    direction: 'expense',
  })
  await movements.create({
    ...movement,
    kind: 'transfer',
    destinationAccountId: b.id,
    categoryId: undefined,
    description: 'Transferência própria',
    amountCents: 10000,
  })
  s = await readSnapshot(d)
  expect(balancesAt(s, asOf)).toEqual({ [a.id]: 405000, [b.id]: 110000 })
  const ia = s.invoices.find((i) => i.cardId === ca.id && i.period === '2026-01')!
  const ib = s.invoices.find((i) => i.cardId === cb.id && i.period === '2026-02')!
  expect(ia.dueDate).toBe('2026-01-20')
  expect(ib.dueDate).toBe('2026-03-05') // Existing cycle survives card edit.
  const full = await credit.pay({
    invoiceId: ia.id,
    accountId: a.id,
    amountCents: 50000,
    date: '2026-01-15',
  })
  const partial = await credit.pay({
    invoiceId: ib.id,
    accountId: b.id,
    amountCents: 1500,
    date: '2026-02-26',
  })
  s = await readSnapshot(d)
  expect(balancesAt(s, asOf)).toEqual({ [a.id]: 355000, [b.id]: 108500 })
  expect(invoiceSummary(s, ia, asOf)).toMatchObject({ remaining: 0, paid: 50000 })
  expect(invoiceSummary(s, ib, asOf)).toMatchObject({ remaining: 2500, paid: 1500 })
  expect(cardSummary(s, ca, asOf)).toMatchObject({ used: 250000, available: 250000 })
  expect(cardSummary(s, cb, asOf)).toMatchObject({ used: 10500, available: 189500 })
  expect(s.transactions).toHaveLength(2) // Payments never create another consumption row.
  expect(monthlySummary(s, new Date(2026, 0, 1), asOf)).toMatchObject({
    income: 20000,
    expense: 317000,
  })
  expect(monthlySummary(s, new Date(2026, 0, 1), asOf, 'installment').expense).toBe(55000)
  const plan = creditPlanning(s, new Date(2026, 2, 1), asOf, 463500)
  expect(plan.invoiceExpense).toBe(52500) // A March 500 + B residual 25, no second sum of parts.
  expect(plan.commitments).toBe(52500)

  // Reject overpayment and destructive edits without even changing the audit trail.
  const beforeFailure = await new DexieBackupRepository(d).export()
  await expect(
    credit.pay({ invoiceId: ib.id, accountId: b.id, amountCents: 2501, date: '2026-03-01' }),
  ).rejects.toThrow('excede')
  await expect(credit.updatePurchase(pa.id, { ...purchase, amountCents: 300001 })).rejects.toThrow()
  expect((await new DexieBackupRepository(d).export()).data).toEqual(beforeFailure.data)
  await credit.updatePurchase(pa.id, {
    ...purchase,
    description: 'Equipamento conferido',
    notes: 'Auditoria',
  })
  await movements.update('transaction', pix.id, {
    ...movement,
    categoryId: expenseId,
    description: 'Pix enviado corrigido',
    amountCents: 6000,
    direction: 'expense',
  })
  await credit.correctPayment(partial.id, {
    invoiceId: ib.id,
    accountId: b.id,
    amountCents: 2000,
    date: '2026-02-26',
  })
  await credit.reversePayment(full.id, '2026-01-16', 'Pagamento lançado incorretamente')
  s = await readSnapshot(d)
  expect(balancesAt(s, asOf)).toEqual({ [a.id]: 404000, [b.id]: 108000 })
  expect(invoiceSummary(s, ia, asOf).remaining).toBe(50000)
  expect(cardSummary(s, ca, asOf).used).toBe(300000)
  await credit.pay({ invoiceId: ia.id, accountId: a.id, amountCents: 50000, date: '2026-01-17' })
  await credit.refundPurchase(pb.id, 1000, '2026-03-02', 'Devolução parcial conferida')
  s = await readSnapshot(d)
  expect(balancesAt(s, asOf)).toEqual({ [a.id]: 354000, [b.id]: 108000 })
  expect(invoiceSummary(s, ib, asOf)).toMatchObject({ remaining: 1000, paid: 2000 })
  expect(cardSummary(s, cb, asOf)).toMatchObject({ used: 9000, available: 191000 })
  const auditParts = s.installments.filter((i) => i.purchaseId === pa.id)
  expect(auditParts).toHaveLength(6)
  expect(monthlySummary(s, new Date(2026, 0, 1), asOf).expense).toBe(318000)
  expect(monthlySummary(s, new Date(2026, 2, 1), asOf).expense).toBe(-1000)
  expect(monthlySummary(s, new Date(2026, 1, 1), asOf, 'installment').expense).toBe(53000)
  expect(bankMovementsFrom(s).filter((m) => m.paymentId)).toHaveLength(4)
  for (const account of [a, b]) {
    expect(statement(s, account.id, asOf).at(-1)!.balance).toBe(balancesAt(s, asOf)[account.id])
  }
  expect(sumCents(Object.values(balancesAt(s, asOf)))).toBe(462000)
  assertCreditIntegrity(s)

  // Execute the real React render functions with the persisted scenario data.
  // This catches render errors; it does not measure layout or simulate browser interactions.
  const balances = balancesAt(s, asOf)
  const data = {
    ...s,
    balances,
    total: sumCents(Object.values(balances)),
    movements: bankMovementsFrom(s),
    error: '',
  }
  const noop = () => {}
  const shared = { data, money: formatMoney, notify: noop }
  const views: [ReactNode, string][] = [
    [
      createElement(DashboardPage, {
        ...shared,
        hidden: false,
        month: new Date(2026, 0, 1),
        setMonth: noop,
        onNewAccount: noop,
        onMovements: noop,
        onAccounts: noop,
        onPlanning: noop,
      }),
      'Consumo líquido do mês',
    ],
    [createElement(AccountStatement, { ...shared, account: a, onBack: noop }), 'Extrato da conta'],
    [createElement(MovementsPage, shared), 'Histórico financeiro'],
    [createElement(CardsPage, shared), 'Seus cartões, com clareza.'],
    [
      createElement(InvoicePanel, {
        ...shared,
        invoice: ib,
        onPay: noop,
        onAction: noop,
        onReceipt: noop,
        onCorrect: noop,
        onReverse: noop,
        onBack: noop,
      }),
      'Saldo pendente',
    ],
    [createElement(PlanningPage, shared), 'Saldo projetado até fim do mês'],
    [createElement(SettingsPage, { ...shared, hidden: false }), 'Categorias financeiras'],
    [
      createElement(PurchaseForm, {
        data,
        purchase: s.purchases.find((p) => p.id === pa.id),
        onDone: noop,
      }),
      'Há histórico de liquidação ou estorno',
    ],
    [createElement(PaymentForm, { data, invoice: ib, onDone: noop }), 'Revisar pagamento'],
  ]
  for (const [view, content] of views) expect(renderToStaticMarkup(view)).toContain(content)

  // Reopen the same database with fresh repositories, then restore to another isolated database.
  const exported = await new DexieBackupRepository(d).export()
  d.close()
  const reopened = new FinancialDatabase(name)
  databases.push(reopened)
  expect(await readSnapshot(reopened)).toEqual(s)
  expect((await new DexieBackupRepository(reopened).export()).data).toEqual(exported.data)
  const restored = new FinancialDatabase(`phase22-restore-${crypto.randomUUID()}`)
  databases.push(restored)
  await new DexieBackupRepository(restored).restore(exported, 'RESTAURAR')
  expect(await readSnapshot(restored)).toEqual(s)
  assertCreditIntegrity(await readSnapshot(restored))
})

it('keeps invoice payments and their reversals out of the balance-adjustment filter', () => {
  const entity = {
    id: 'entry',
    createdAt: '2026-01-01T12:00:00.000Z',
    updatedAt: '2026-01-01T12:00:00.000Z',
  }
  const rows = bankMovementsFrom({
    accounts: [],
    categories: [],
    transactions: [],
    transfers: [],
    adjustments: [
      {
        ...entity,
        id: 'adjustment',
        accountId: 'bank',
        deltaCents: 100,
        date: '2026-01-01',
        reason: 'Ajuste real',
      },
    ],
    payments: [
      {
        ...entity,
        id: 'payment',
        accountId: 'bank',
        invoiceId: 'invoice',
        amountCents: 5000,
        date: '2026-01-02',
        reversalDate: '2026-01-03',
      },
    ],
  })
  expect(filterMovements(rows, { type: 'adjustment' }).map((m) => m.id)).toEqual(['adjustment'])
  expect(filterMovements(rows, { type: 'payment' }).map((m) => m.id)).toEqual([
    'payment',
    'payment-reversal',
  ])
  expect(filterMovements(rows, { type: 'expense' })).toEqual([]) // Consumption filter remains separate.
})
