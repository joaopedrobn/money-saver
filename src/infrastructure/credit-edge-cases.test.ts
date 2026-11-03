import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { FinancialDatabase } from './database'
import { DexieAccountRepository } from './repositories'
import { DexieCreditRepository } from './credit-repository'
import { readSnapshot } from './movement-repository'
import { DexieBackupRepository } from './backup-repository'
import {
  invoiceSummary,
  cardSummary,
  creditPlanning,
  installmentPlan,
  planFingerprint,
} from '@/domain/credit'
import { balancesAt, monthlySummary } from '@/domain/finance'
import type { CreditCard, PurchaseInput } from '@/domain/models'
let d: FinancialDatabase,
  r: DexieCreditRepository,
  card: CreditCard,
  accountId: string,
  categoryId: string
const cutoff = '2026-11-03' as const
it('rejects a stale preview if another tab changes the billing calendar before confirmation', async () => {
  const purchase = input(card.id, categoryId, { date: '2026-01-15' }),
    preview = planFingerprint(installmentPlan(card, purchase, []))
  await r.updateCard(card.id, {
    name: card.name,
    institution: 'Banco',
    nickname: '',
    brand: '',
    lastFour: '',
    color: 'sage',
    accountId,
    limitCents: card.limitCents,
    closingDay: 20,
    dueDay: 25,
  })
  await expect(r.createPurchase(purchase, preview)).rejects.toThrow('mudaram desde a prévia')
  expect(await d.purchases.count()).toBe(0)
  expect(await d.installments.count()).toBe(0)
  expect(await d.invoices.count()).toBe(0)
})
it('orders payment, reversal and repayment even with a frozen millisecond clock', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.now())
  try {
    await r.createPurchase(input(card.id, categoryId))
    const invoice = (await d.invoices.toArray())[0],
      pay = await r.pay({
        invoiceId: invoice.id,
        accountId,
        amountCents: 200000,
        date: '2026-01-15',
      })
    await r.reversePayment(pay.id, '2026-01-15', 'Pagamento devolvido')
    await r.pay({ invoiceId: invoice.id, accountId, amountCents: 200000, date: '2026-01-15' })
    expect(invoiceSummary(await readSnapshot(d), invoice, cutoff).remaining).toBe(0)
    expect(balancesAt(await readSnapshot(d), cutoff)[accountId]).toBe(300000)
  } finally {
    vi.useRealTimers()
  }
})
beforeEach(async () => {
  d = new FinancialDatabase(`edge-${crypto.randomUUID()}`)
  r = new DexieCreditRepository(d)
  const a = await new DexieAccountRepository(d).create({
    name: 'Conta',
    institution: 'Banco',
    type: 'checking',
    color: 'sage',
    openingDate: '2026-01-01',
    openingBalanceCents: 500000,
  })
  accountId = a.id
  categoryId = (await d.categories.toArray()).find((c) => c.direction === 'expense')!.id
  card = await r.createCard({
    name: 'Meu cartão',
    institution: 'Banco',
    nickname: '',
    brand: '',
    lastFour: '',
    color: 'sage',
    accountId,
    limitCents: 1000000,
    closingDay: 10,
    dueDay: 20,
  })
})
afterEach(async () => {
  await d.delete()
})
const input = (
  cardId: string,
  category: string,
  overrides: Partial<PurchaseInput> = {},
): PurchaseInput => ({
  cardId,
  categoryId: category,
  description: 'Compra',
  amountCents: 200000,
  feeCents: 0,
  date: '2026-01-05',
  installmentCount: 1,
  ...overrides,
})
it('rejects a backdated payment that would overpay an already registered later payment', async () => {
  const p = await r.createPurchase(input(card.id, categoryId))
  await r.refundPurchase(p.id, 100000, '2026-01-10', 'Devolução parcial')
  const invoice = (await d.invoices.toArray())[0]
  await r.pay({ invoiceId: invoice.id, accountId, amountCents: 100000, date: '2026-01-15' })
  await expect(
    r.pay({ invoiceId: invoice.id, accountId, amountCents: 100000, date: '2026-01-06' }),
  ).rejects.toThrow('sequência histórica')
  expect(await d.payments.count()).toBe(1)
  expect(balancesAt(await readSnapshot(d), cutoff)[accountId]).toBe(400000)
})
it('reverses a mistaken charge without touching original entry or bank money', async () => {
  await r.createPurchase(input(card.id, categoryId))
  const invoice = (await d.invoices.toArray())[0],
    e = await r.addCharge(invoice.id, 1234, '2026-01-21', 'Juros informados', categoryId)
  await r.reverseCharge(e.id, '2026-01-22', 'Cobrança indevida')
  const snapshot = await readSnapshot(d)
  expect(await d.invoiceEntries.get(e.id)).toEqual(e)
  expect(invoiceSummary(snapshot, invoice, cutoff).remaining).toBe(200000)
  expect(monthlySummary(snapshot, new Date(2026, 0, 1), cutoff).expense).toBe(200000)
  expect(balancesAt(snapshot, cutoff)[accountId]).toBe(500000)
  await expect(r.reverseCharge(e.id, '2026-01-23', 'Repetido')).rejects.toThrow('já foi estornado')
  await expect(new DexieBackupRepository(d).export()).resolves.toBeDefined()
})
it('supports refund credit after a paid charge reversal without negative invoice debt', async () => {
  await r.createPurchase(input(card.id, categoryId))
  const invoice = (await d.invoices.toArray())[0],
    e = await r.addCharge(invoice.id, 1234, '2026-01-21', 'Juros informados', categoryId)
  await r.pay({ invoiceId: invoice.id, accountId, amountCents: 201234, date: '2026-01-22' })
  await r.reverseCharge(e.id, '2026-01-23', 'Cobrança indevida')
  expect(invoiceSummary(await readSnapshot(d), invoice, cutoff)).toMatchObject({
    remaining: 0,
    credit: 1234,
  })
  expect(cardSummary(await readSnapshot(d), card, cutoff)).toMatchObject({
    used: 0,
    netCredit: 1234,
  })
})
it('cancellation preserves a full-length original note and valid backup', async () => {
  const p = await r.createPurchase(input(card.id, categoryId, { notes: 'n'.repeat(2000) }))
  await r.cancelPurchase(p.id, 'Registro duplicado')
  expect((await d.purchases.get(p.id))?.notes).toHaveLength(2000)
  expect((await d.purchases.get(p.id))?.cancellationReason).toBe('Registro duplicado')
  await expect(new DexieBackupRepository(d).export()).resolves.toBeDefined()
})
it('does not show cancelled installments in mixed active monthly invoice commitments', async () => {
  const p = await r.createPurchase(input(card.id, categoryId))
  await r.createPurchase(
    input(card.id, categoryId, { description: 'Compra ativa', amountCents: 10000 }),
  )
  await r.cancelPurchase(p.id, 'Registro cancelado')
  const plan = creditPlanning(await readSnapshot(d), new Date(2026, 0, 1), '2026-01-06', 500000)
  expect(plan.invoiceExpense).toBe(10000)
  expect(plan.monthInstallments).toHaveLength(1)
})
it('rolls back default account changes to nonexistent accounts', async () => {
  await expect(
    r.updateCard(card.id, {
      name: card.name,
      institution: 'Banco',
      nickname: '',
      brand: '',
      lastFour: '',
      color: 'sage',
      accountId: 'missing',
      limitCents: card.limitCents,
      closingDay: 10,
      dueDay: 20,
    }),
  ).rejects.toThrow('Conta')
  expect((await d.cards.get(card.id))?.accountId).toBe(accountId)
})
it('rejects cancelling an already cancelled purchase or refunding it', async () => {
  const p = await r.createPurchase(input(card.id, categoryId))
  await r.cancelPurchase(p.id, 'Registro cancelado')
  await expect(r.cancelPurchase(p.id, 'Novo cancelamento')).rejects.toThrow()
  await expect(r.refundPurchase(p.id, 1, '2026-01-10', 'Devolução')).rejects.toThrow()
})
it('guards charge credit transfers and payment reversals against malformed references and dates', async () => {
  await r.createPurchase(input(card.id, categoryId))
  const invoice = (await d.invoices.toArray())[0]
  await expect(r.applyCredit(invoice.id, invoice.id, 100)).rejects.toThrow('diferentes')
  await expect(
    r.addCharge(invoice.id, 1.5, '2026-01-21', 'Taxa inválida', categoryId),
  ).rejects.toThrow()
  const pay = await r.pay({
    invoiceId: invoice.id,
    accountId,
    amountCents: 100,
    date: '2026-01-15',
  })
  await expect(r.reversePayment(pay.id, '2026-01-14', 'Data anterior')).rejects.toThrow('anteceder')
  expect((await d.payments.get(pay.id))?.reversalDate).toBeUndefined()
})
