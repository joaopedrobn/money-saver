import { afterEach, beforeEach, expect, it } from 'vitest'
import Dexie from 'dexie'
import { FinancialDatabase } from './database'
import { DexiePlanningRepository } from './planning-repository'
import { DexieAccountRepository } from './repositories'
import { DexieCreditRepository } from './credit-repository'
import { DexieMovementRepository, readSnapshot } from './movement-repository'
import { DexieBackupRepository } from './backup-repository'
import { budgetUsage, financialForecast, recurringDates } from '@/domain/planning'
import { balancesAt, monthlySummary } from '@/domain/finance'
import type { BankAccount, RecurringInput } from '@/domain/models'
let d: FinancialDatabase,
  r: DexiePlanningRepository,
  a: BankAccount,
  expense: string,
  income: string
const databases: FinancialDatabase[] = []
beforeEach(async () => {
  d = new FinancialDatabase(`planning-${crypto.randomUUID()}`)
  databases.push(d)
  r = new DexiePlanningRepository(d)
  a = await new DexieAccountRepository(d).create({
    name: 'Conta teste',
    institution: 'Banco teste',
    type: 'checking',
    openingBalanceCents: 100000,
    openingDate: '2024-01-01',
    color: 'sage',
  })
  const categories = await d.categories.toArray()
  expense = categories.find((c) => c.direction === 'expense')!.id
  income = categories.find((c) => c.direction === 'income')!.id
})
afterEach(async () => {
  for (const database of databases.splice(0)) await database.delete()
})
const input = (): RecurringInput => ({
  description: 'Internet',
  accountId: a.id,
  categoryId: expense,
  direction: 'expense',
  amountCents: 10000,
  frequency: 'monthly',
  dayOfMonth: 31,
  startDate: '2026-01-01',
})
async function card() {
  return new DexieCreditRepository(d).createCard({
    name: 'Cartão teste',
    institution: 'Banco teste',
    accountId: a.id,
    nickname: '',
    brand: '',
    lastFour: '',
    limitCents: 200000,
    closingDay: 10,
    dueDay: 20,
    color: 'sage',
  })
}

it('generates bounded monthly, weekly and yearly dates with end-of-month clamping', async () => {
  const monthly = await r.saveRecurring({ ...input(), endDate: '2026-03-30' })
  expect(recurringDates(monthly, '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28'])
  const weekly = await r.saveRecurring({ ...input(), frequency: 'weekly', dayOfMonth: 1 })
  expect(recurringDates(weekly, '2026-01-01', '2026-01-15')).toEqual(['2026-01-05', '2026-01-12'])
  const yearly = await r.saveRecurring({
    ...input(),
    frequency: 'yearly',
    startDate: '2024-02-01',
    dayOfMonth: 29,
  })
  expect(recurringDates(yearly, '2024-01-01', '2028-12-31')).toEqual([
    '2024-02-29',
    '2025-02-28',
    '2026-02-28',
    '2027-02-28',
    '2028-02-29',
  ])
  await expect(r.saveRecurring({ ...input(), startDate: '2026-02-30' })).rejects.toThrow()
  await expect(
    r.saveRecurring({ ...input(), frequency: 'weekly', dayOfMonth: 8 }),
  ).rejects.toThrow()
})
it('realizes once atomically with an adjusted amount and preserves history after edits, pause and end', async () => {
  const recurring = await r.saveRecurring(input())
  expect(balancesAt(await readSnapshot(d), '2026-11-03')[a.id]).toBe(100000)
  const results = await Promise.allSettled([
    r.realize(recurring.id, '2026-01-31', 9500, '2026-01-31'),
    r.realize(recurring.id, '2026-01-31', 9500, '2026-01-31'),
  ])
  expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
  expect(await d.transactions.count()).toBe(1)
  expect(await d.occurrences.count()).toBe(1)
  expect(balancesAt(await readSnapshot(d), '2026-11-03')[a.id]).toBe(90500)
  const before = await d.transactions.toArray()
  await r.saveRecurring({ ...input(), amountCents: 20000, dayOfMonth: 15 }, recurring.id)
  expect(await d.transactions.toArray()).toEqual(before)
  await r.status(recurring.id, 'paused')
  expect(
    recurringDates((await d.recurring.get(recurring.id))!, '2026-02-01', '2026-12-31'),
  ).toEqual([])
  await expect(r.realize(recurring.id, '2026-02-15', 20000, '2026-02-15')).rejects.toThrow()
  await r.status(recurring.id, 'active')
  await r.status(recurring.id, 'ended')
  await expect(r.status(recurring.id, 'active')).rejects.toThrow()
  expect(await d.transactions.toArray()).toEqual(before)
})
it('routes recurring card expenses through purchases and invoices without duplicate cash or consumption', async () => {
  const c = await card(),
    credit = new DexieCreditRepository(d)
  const recurring = await r.saveRecurring({ ...input(), cardId: c.id, dayOfMonth: 5 })
  await r.realize(recurring.id, '2026-01-05', 9900, '2026-01-05')
  let s = await readSnapshot(d)
  expect(s.transactions).toHaveLength(0)
  expect(s.purchases).toHaveLength(1)
  expect(balancesAt(s, '2026-01-31')[a.id]).toBe(100000)
  await credit.pay({
    invoiceId: s.invoices[0].id,
    accountId: a.id,
    amountCents: 9900,
    date: '2026-01-20',
  })
  s = await readSnapshot(d)
  expect(balancesAt(s, '2026-01-31')[a.id]).toBe(90100)
  expect(monthlySummary(s, new Date(2026, 0, 1), '2026-01-31').expense).toBe(9900)
  expect(financialForecast(s, '2026-01-21', 1, 90100)[0].projected).toBe(90100)
  await expect(r.realize(recurring.id, '2026-01-05', 9900, '2026-01-05')).rejects.toThrow(
    'já efetivada',
  )
})
it('calculates category budgets from existing consumption, including card refunds but excluding payments', async () => {
  const c = await card(),
    credit = new DexieCreditRepository(d)
  const recurring = await r.saveRecurring({ ...input(), cardId: c.id, dayOfMonth: 5 })
  await r.realize(recurring.id, '2026-01-05', 10000, '2026-01-05')
  const purchase = (await d.purchases.toArray())[0]
  await credit.pay({
    invoiceId: (await d.invoices.toArray())[0].id,
    accountId: a.id,
    amountCents: 10000,
    date: '2026-01-15',
  })
  await credit.refundPurchase(purchase.id, 2000, '2026-01-16', 'Estorno parcial')
  await r.saveBudget('2026-01', expense, 5000)
  expect(budgetUsage(await readSnapshot(d), '2026-01', '2026-01-31')[0]).toMatchObject({
    used: 8000,
    available: -3000,
    percent: 160,
  })
  await r.saveBudget('2026-01', expense, 10000)
  expect(await d.budgets.count()).toBe(1)
  expect(budgetUsage(await readSnapshot(d), '2026-01', '2026-01-31')[0].available).toBe(2000)
  await expect(r.saveBudget('2026-01', income, 10000)).rejects.toThrow()
})
it('projects cumulative cash for 3, 6 and 12 months with recurring bank flows and invoice due dates', async () => {
  const c = await card()
  await r.saveRecurring({
    ...input(),
    direction: 'income',
    categoryId: income,
    amountCents: 120000,
    dayOfMonth: 1,
  })
  await r.saveRecurring({ ...input(), dayOfMonth: 5 })
  await r.saveRecurring({ ...input(), cardId: c.id, dayOfMonth: 15 })
  await new DexieCreditRepository(d).createPurchase({
    cardId: c.id,
    categoryId: expense,
    description: 'Compra 3x',
    amountCents: 60000,
    feeCents: 0,
    installmentCount: 3,
    date: '2026-01-05',
  })
  const s = await readSnapshot(d)
  const result = financialForecast(s, '2026-01-01', 3, 100000)
  expect(result.map((x) => x.projected)).toEqual([190000, 270000, 350000])
  expect(result.map((x) => x.invoiceExpense)).toEqual([20000, 30000, 30000])
  expect(financialForecast(s, '2026-01-01', 6, 100000)).toHaveLength(6)
  expect(financialForecast(s, '2026-01-01', 12, 100000)).toHaveLength(12)
  expect(await d.transactions.count()).toBe(0)
  expect(await d.purchases.count()).toBe(1)
  await new DexieMovementRepository(d).create({
    kind: 'transaction',
    accountId: a.id,
    categoryId: expense,
    description: 'Despesa agendada',
    direction: 'expense',
    method: 'other',
    status: 'planned',
    date: '2026-02-02',
    amountCents: 5000,
  })
  expect(financialForecast(await readSnapshot(d), '2026-01-01', 3, 100000)[1].projected).toBe(
    265000,
  )
})
it('migrates v3 without losing records and persists new data through reopen and backup restore', async () => {
  const name = `legacy-planning-${crypto.randomUUID()}`,
    legacy = new Dexie(name)
  legacy
    .version(3)
    .stores({
      accounts: 'id',
      cards: 'id',
      categories: 'id',
      transactions: 'id',
      transfers: 'id',
      adjustments: 'id',
      purchases: 'id',
      installments: 'id',
      invoices: 'id',
      payments: 'id',
      recurring: 'id',
      settings: 'id',
      audit: 'id',
      invoiceEntries: 'id',
    })
  await legacy.table('accounts').add(a)
  await legacy.table('categories').bulkAdd(await d.categories.toArray())
  legacy.close()
  const upgraded = new FinancialDatabase(name)
  databases.push(upgraded)
  const repo = new DexiePlanningRepository(upgraded)
  const recurring = await repo.saveRecurring(input())
  await repo.realize(recurring.id, '2026-01-31', 10000, '2026-01-31')
  await repo.saveBudget('2026-01', expense, 20000)
  expect(await upgraded.accounts.get(a.id)).toEqual(a)
  const before = await readSnapshot(upgraded),
    backup = await new DexieBackupRepository(upgraded).export()
  expect(backup.schemaVersion).toBe(4)
  upgraded.close()
  await upgraded.open()
  expect(await readSnapshot(upgraded)).toEqual(before)
  const restored = new FinancialDatabase(`restore-planning-${crypto.randomUUID()}`)
  databases.push(restored)
  await new DexieBackupRepository(restored).restore(backup, 'RESTAURAR')
  expect(await readSnapshot(restored)).toEqual(before)
})
it('rolls back a failed card occurrence and rejects invalid backup references and duplicate budgets', async () => {
  const c = await card(),
    recurring = await r.saveRecurring({ ...input(), cardId: c.id, dayOfMonth: 5 })
  await new DexieCreditRepository(d).archiveCard(c.id, true)
  await expect(r.realize(recurring.id, '2026-01-05', 10000, '2026-01-05')).rejects.toThrow()
  expect(await d.occurrences.count()).toBe(0)
  expect(await d.purchases.count()).toBe(0)
  await r.saveBudget('2026-01', expense, 20000)
  const backup = await new DexieBackupRepository(d).export()
  const invalid = structuredClone(backup)
  invalid.data.budgets[0].categoryId = 'missing'
  expect(() => new DexieBackupRepository(d).preview(invalid)).toThrow()
  const duplicate = structuredClone(backup)
  duplicate.data.budgets.push({ ...duplicate.data.budgets[0], id: 'duplicate' })
  expect(() => new DexieBackupRepository(d).preview(duplicate)).toThrow()
})
