import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import Dexie from 'dexie'
import { FinancialDatabase } from './database'
import { DexieAccountRepository } from './repositories'
import { DexieCreditRepository } from './credit-repository'
import { DexieBackupRepository } from './backup-repository'
import { readSnapshot } from './movement-repository'
import { cardSummary, invoiceSummary, creditPlanning } from '@/domain/credit'
import { balancesAt, monthlySummary, statement } from '@/domain/finance'
import { assertCreditIntegrity } from '@/domain/credit-integrity'
import type {
  BankAccount,
  CreditCard,
  CardInput,
  PurchaseInput,
  CreditSnapshot,
} from '@/domain/models'
let d: FinancialDatabase,
  r: DexieCreditRepository,
  bank: DexieAccountRepository,
  a: BankAccount,
  b: BankAccount,
  card: CreditCard,
  categoryId: string,
  backup: DexieBackupRepository
const asOf = '2026-11-03' as const
beforeEach(async () => {
  d = new FinancialDatabase(`credit-${crypto.randomUUID()}`)
  r = new DexieCreditRepository(d)
  bank = new DexieAccountRepository(d)
  backup = new DexieBackupRepository(d)
  a = await bank.create({
    name: 'Nubank',
    institution: 'Nu',
    type: 'checking',
    openingBalanceCents: 400000,
    openingDate: '2026-01-01',
    color: 'sage',
  })
  b = await bank.create({
    name: 'Itaú',
    institution: 'Itaú',
    type: 'checking',
    openingBalanceCents: 100000,
    openingDate: '2026-01-01',
    color: 'blue',
  })
  categoryId = (await d.categories.toArray()).find((c) => c.direction === 'expense')!.id
  card = await r.createCard(cardInput())
})
afterEach(async () => {
  vi.useRealTimers()
  await d.delete()
})
function cardInput(overrides: Partial<CardInput> = {}): CardInput {
  return {
    accountId: a.id,
    name: 'Cartão principal',
    institution: 'Banco independente',
    nickname: 'Meu crédito',
    brand: 'Visa',
    lastFour: '1234',
    limitCents: 500000,
    closingDay: 10,
    dueDay: 20,
    color: 'sage',
    ...overrides,
  }
}
function input(overrides: Partial<PurchaseInput> = {}): PurchaseInput {
  return {
    cardId: card.id,
    categoryId,
    description: 'Compra de teste',
    amountCents: 120000,
    feeCents: 0,
    date: '2026-01-05',
    installmentCount: 1,
    ...overrides,
  }
}
async function s() {
  return readSnapshot(d)
}
async function inv() {
  return (await d.invoices.where('cardId').equals(card.id).sortBy('period'))[0]
}
describe('card and purchase integration', () => {
  it('registers multiple unrelated institutions against the same default account', async () => {
    const second = await r.createCard(
      cardInput({ name: 'Outro cartão', institution: 'Outro banco', brand: 'Mastercard' }),
    )
    expect(second.accountId).toBe(a.id)
    expect(await d.cards.count()).toBe(2)
  })
  it('validates bank references and stores only last four digits', async () => {
    await expect(r.createCard(cardInput({ accountId: 'missing' }))).rejects.toThrow('Conta')
    await expect(r.createCard(cardInput({ lastFour: '1234567812345678' }))).rejects.toThrow()
    await expect(r.createCard({ ...cardInput(), cvv: '123' } as CardInput)).rejects.toThrow()
    expect(await d.cards.count()).toBe(1)
  })
  it('credit purchase does not debit bank or create bank consumption', async () => {
    await r.createPurchase(input())
    const snapshot = await s()
    expect(balancesAt(snapshot, asOf)[a.id]).toBe(400000)
    expect(await d.transactions.count()).toBe(0)
    expect(cardSummary(snapshot, card, asOf).used).toBe(120000)
    expect(monthlySummary(snapshot, new Date(2026, 0, 1), asOf).expense).toBe(120000)
  })
  it('distributes all six installments and commitments atomically', async () => {
    const p = await r.createPurchase(input({ amountCents: 300000, installmentCount: 6 }))
    const snapshot = await s()
    expect(
      snapshot.installments.filter((i) => i.purchaseId === p.id).map((i) => i.amountCents),
    ).toEqual([50000, 50000, 50000, 50000, 50000, 50000])
    expect(snapshot.invoices).toHaveLength(6)
    expect(cardSummary(snapshot, card, asOf)).toMatchObject({ used: 300000, available: 200000 })
    expect(balancesAt(snapshot, asOf)[a.id]).toBe(400000)
  })
  it('finances explicit charges with exact cent totals', async () => {
    await r.createPurchase(input({ amountCents: 10000, feeCents: 101, installmentCount: 3 }))
    const snapshot = await s()
    expect(snapshot.installments.reduce((sum, i) => sum + i.amountCents, 0)).toBe(10101)
    expect(snapshot.installments.reduce((sum, i) => sum + (i.principalCents ?? 0), 0)).toBe(10000)
    expect(monthlySummary(snapshot, new Date(2026, 0, 1), asOf).expense).toBe(10101)
  })
  it('allows exceptional purchases beyond the contracted limit', async () => {
    await r.createPurchase(input({ amountCents: 600000 }))
    expect(cardSummary(await s(), card, asOf).available).toBe(-100000)
  })
  it('rejects malformed values and future purchase dates without partial writes', async () => {
    await expect(r.createPurchase(input({ amountCents: 1.2 }))).rejects.toThrow()
    await expect(r.createPurchase(input({ date: '2099-01-01' }))).rejects.toThrow()
    await expect(r.createPurchase(input({ date: '2026-02-30' }))).rejects.toThrow()
    expect(await d.purchases.count()).toBe(0)
    expect(await d.invoices.count()).toBe(0)
  })
  it('edits installment count without duplicating purchase or installments', async () => {
    const p = await r.createPurchase(input({ installmentCount: 3 }))
    await r.updatePurchase(p.id, input({ installmentCount: 6, amountCents: 10000 }))
    expect(await d.purchases.count()).toBe(1)
    expect(await d.installments.where('purchaseId').equals(p.id).count()).toBe(6)
    expect((await d.installments.toArray()).reduce((sum, i) => sum + i.amountCents, 0)).toBe(10000)
    assertCreditIntegrity(await s())
  })
  it('metadata edits do not regenerate installment IDs after closing changes', async () => {
    const p = await r.createPurchase(input({ installmentCount: 3 })),
      parts = await d.installments.toArray()
    await r.updateCard(card.id, cardInput({ closingDay: 25, dueDay: 5 }))
    await r.updatePurchase(
      p.id,
      input({ installmentCount: 3, description: 'Descrição corrigida', notes: 'Detalhe' }),
    )
    expect(await d.installments.toArray()).toEqual(parts)
  })
  it('moves unpaid purchase to another card as one operation', async () => {
    const second = await r.createCard(cardInput({ name: 'Segundo cartão' }))
    const p = await r.createPurchase(input({ installmentCount: 2 }))
    await r.updatePurchase(p.id, input({ cardId: second.id, installmentCount: 4 }))
    const snapshot = await s()
    expect(cardSummary(snapshot, card, asOf).used).toBe(0)
    expect(cardSummary(snapshot, second, asOf).used).toBe(120000)
    expect(snapshot.installments).toHaveLength(4)
  })
  it('cancels unpaid purchase, retaining original allocation and audit', async () => {
    const p = await r.createPurchase(input({ installmentCount: 3 })),
      parts = await d.installments.toArray()
    await r.cancelPurchase(p.id, 'Registro em duplicidade')
    expect(await d.installments.toArray()).toEqual(parts)
    expect(cardSummary(await s(), card, asOf).used).toBe(0)
    expect(monthlySummary(await s(), new Date(2026, 0, 1), asOf).expense).toBe(0)
    expect(await d.audit.where('entityId').equals(p.id).count()).toBe(2)
  })
  it('protects all liquidated invoice history from destructive purchase changes', async () => {
    const p = await r.createPurchase(input({ installmentCount: 3 }))
    const invoice = await inv()
    await r.pay({ invoiceId: invoice.id, accountId: a.id, amountCents: 40000, date: '2026-01-15' })
    const parts = await d.installments.toArray()
    await expect(r.updatePurchase(p.id, input({ installmentCount: 6 }))).rejects.toThrow(
      'histórico',
    )
    await expect(r.cancelPurchase(p.id, 'Cancelamento inválido')).rejects.toThrow('liquidações')
    expect(await d.installments.toArray()).toEqual(parts)
    await expect(
      r.updatePurchase(p.id, input({ installmentCount: 3, description: 'Descrição corrigida' })),
    ).resolves.toMatchObject({ description: 'Descrição corrigida' })
  })
  it('preserves existing invoices when closing/due configuration changes', async () => {
    await r.createPurchase(input({ installmentCount: 3 }))
    const old = await d.invoices.toArray()
    await r.updateCard(card.id, cardInput({ closingDay: 20, dueDay: 5 }))
    await r.createPurchase(input({ date: '2026-01-15', description: 'Compra posterior' }))
    for (const i of old) expect(await d.invoices.get(i.id)).toEqual(i)
    const newer = await r.createPurchase(input({ date: '2026-04-15', description: 'Novo ciclo' }))
    const part = await d.installments.where('purchaseId').equals(newer.id).first()
    expect(await d.invoices.get(part!.invoiceId)).toMatchObject({
      closingDate: '2026-04-20',
      dueDate: '2026-05-05',
    })
  })
  it('archives without losing debt; blocks new purchases but permits payment', async () => {
    await r.createPurchase(input())
    await r.archiveCard(card.id, true)
    await expect(r.createPurchase(input())).rejects.toThrow('arquivado')
    expect(cardSummary(await s(), (await d.cards.get(card.id))!, asOf).used).toBe(120000)
    await expect(
      r.pay({
        invoiceId: (await inv()).id,
        accountId: a.id,
        amountCents: 120000,
        date: '2026-01-15',
      }),
    ).resolves.toBeDefined()
    await r.archiveCard(card.id, false)
    await expect(r.createPurchase(input())).resolves.toBeDefined()
  })
  it('lets user change default account; old payment references remain protected', async () => {
    await r.createPurchase(input())
    const p = await r.pay({
      invoiceId: (await inv()).id,
      accountId: a.id,
      amountCents: 120000,
      date: '2026-01-15',
    })
    await r.updateCard(card.id, cardInput({ accountId: b.id }))
    expect((await d.payments.get(p.id))?.accountId).toBe(a.id)
    await expect(bank.remove(a.id)).rejects.toThrow('vínculos')
  })
})
describe('invoice payments, refunds and credits', () => {
  it('integral payment updates bank and releases limit without duplicating consumption', async () => {
    await r.createPurchase(input())
    const invoice = await inv(),
      payment = await r.pay({
        invoiceId: invoice.id,
        accountId: a.id,
        amountCents: 120000,
        date: '2026-01-15',
      }),
      snapshot = await s()
    expect(balancesAt(snapshot, asOf)[a.id]).toBe(280000)
    expect(invoiceSummary(snapshot, invoice, asOf)).toMatchObject({ paid: 120000, remaining: 0 })
    expect(cardSummary(snapshot, card, asOf)).toMatchObject({ used: 0, available: 500000 })
    expect(monthlySummary(snapshot, new Date(2026, 0, 1), asOf).expense).toBe(120000)
    expect(snapshot.transactions).toHaveLength(0)
    expect(statement(snapshot, a.id, asOf).at(-1)).toMatchObject({
      balance: 280000,
      movement: { paymentId: payment.id, readOnly: true },
    })
  })
  it('partial and multiple payments reduce only the residual liability', async () => {
    await r.createPurchase(input({ amountCents: 200000 }))
    const invoice = await inv()
    await r.pay({ invoiceId: invoice.id, accountId: a.id, amountCents: 80000, date: '2026-01-15' })
    expect(invoiceSummary(await s(), invoice, asOf)).toMatchObject({
      paid: 80000,
      remaining: 120000,
      paymentStatus: 'partial',
    })
    await r.pay({ invoiceId: invoice.id, accountId: a.id, amountCents: 120000, date: '2026-01-16' })
    expect(invoiceSummary(await s(), invoice, asOf).remaining).toBe(0)
    expect(balancesAt(await s(), asOf)[a.id]).toBe(200000)
  })
  it('allows payment from another bank account and negative bank balances', async () => {
    await r.createPurchase(input())
    await r.pay({
      invoiceId: (await inv()).id,
      accountId: b.id,
      amountCents: 120000,
      date: '2026-01-15',
    })
    expect(balancesAt(await s(), asOf)).toMatchObject({ [a.id]: 400000, [b.id]: -20000 })
  })
  it('anticipates recorded debt but rejects excess, future dates and pre-purchase payment', async () => {
    await r.createPurchase(input())
    const invoiceId = (await inv()).id
    await expect(
      r.pay({ invoiceId, accountId: a.id, amountCents: 1, date: '2026-01-04' }),
    ).rejects.toThrow('excede')
    await expect(
      r.pay({ invoiceId, accountId: a.id, amountCents: 120001, date: '2026-01-06' }),
    ).rejects.toThrow('excede')
    await expect(
      r.pay({ invoiceId, accountId: a.id, amountCents: 1, date: '2099-01-01' }),
    ).rejects.toThrow()
    await r.pay({ invoiceId, accountId: a.id, amountCents: 120000, date: '2026-01-06' })
    expect(invoiceSummary(await s(), await inv(), '2026-01-06')).toMatchObject({
      closed: false,
      remaining: 0,
      paymentStatus: 'paid',
    })
  })
  it('correction changes amount/account/date atomically while retaining audit', async () => {
    await r.createPurchase(input())
    const invoiceId = (await inv()).id,
      p = await r.pay({ invoiceId, accountId: a.id, amountCents: 80000, date: '2026-01-15' })
    await r.correctPayment(p.id, {
      invoiceId,
      accountId: b.id,
      amountCents: 40000,
      date: '2026-01-16',
      notes: 'Conta corrigida',
    })
    const snapshot = await s()
    expect(snapshot.payments).toHaveLength(1)
    expect(balancesAt(snapshot, asOf)).toMatchObject({ [a.id]: 400000, [b.id]: 60000 })
    expect(invoiceSummary(snapshot, await inv(), asOf).remaining).toBe(80000)
    expect(await d.audit.where('entityId').equals(p.id).count()).toBe(2)
  })
  it('payment reversal preserves old debit and adds return on actual reversal date', async () => {
    await r.createPurchase(input())
    const invoiceId = (await inv()).id,
      p = await r.pay({ invoiceId, accountId: a.id, amountCents: 120000, date: '2026-01-15' })
    await r.reversePayment(p.id, '2026-01-20', 'Pagamento desfeito')
    const snapshot = await s()
    expect(balancesAt(snapshot, '2026-01-19')[a.id]).toBe(280000)
    expect(balancesAt(snapshot, '2026-01-20')[a.id]).toBe(400000)
    expect(invoiceSummary(snapshot, await inv(), '2026-01-20').remaining).toBe(120000)
    expect(statement(snapshot, a.id, asOf).map((row) => row.delta)).toEqual([-120000, 120000])
    expect(monthlySummary(snapshot, new Date(2026, 0, 1), asOf).expense).toBe(120000)
    await expect(r.reversePayment(p.id, '2026-01-21', 'Segundo estorno')).rejects.toThrow(
      'já estornado',
    )
  })
  it('paying preserves net worth: bank minus card liability', async () => {
    await r.createPurchase(input())
    const before = await s(),
      wealth = (snapshot: CreditSnapshot) =>
        Object.values(balancesAt(snapshot, asOf)).reduce((sum, n) => sum + n, 0) -
        cardSummary(snapshot, card, asOf).committed +
        cardSummary(snapshot, card, asOf).paid
    await r.pay({
      invoiceId: (await inv()).id,
      accountId: a.id,
      amountCents: 120000,
      date: '2026-01-15',
    })
    expect(wealth(await s())).toBe(wealth(before))
  })
  it('partial refund reduces future invoices without modifying paid installments', async () => {
    const p = await r.createPurchase(input({ amountCents: 300000, installmentCount: 6 })),
      original = await d.installments.toArray()
    await r.pay({
      invoiceId: (await inv()).id,
      accountId: a.id,
      amountCents: 50000,
      date: '2026-01-15',
    })
    await r.refundPurchase(p.id, 100000, '2026-01-25', 'Devolução parcial')
    const snapshot = await s()
    expect(snapshot.installments).toEqual(original)
    expect(cardSummary(snapshot, card, asOf).used).toBe(150000)
    expect(balancesAt(snapshot, asOf)[a.id]).toBe(350000)
    expect(monthlySummary(snapshot, new Date(2026, 0, 1), asOf).expense).toBe(200000)
  })
  it('full refund after partial settlement clears future debt and creates explicit credit', async () => {
    const p = await r.createPurchase(input({ amountCents: 300000, installmentCount: 6 }))
    await r.pay({
      invoiceId: (await inv()).id,
      accountId: a.id,
      amountCents: 50000,
      date: '2026-01-15',
    })
    await r.refundPurchase(p.id, 300000, '2026-01-25', 'Devolução integral')
    const summary = cardSummary(await s(), card, asOf)
    expect(summary).toMatchObject({ used: 0, debt: 0, credit: 50000, netCredit: 50000 })
    expect(balancesAt(await s(), asOf)[a.id]).toBe(350000)
    expect(summary.invoices.every((v) => v.remaining >= 0 && v.totalDue >= 0)).toBe(true)
  })
  it('applies excess credit explicitly between invoices without bank or consumption effects', async () => {
    // applyCredit uses today's civil date; keep this historical assertion deterministic.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-03T12:00:00-03:00'))
    const p = await r.createPurchase(input({ amountCents: 100000 }))
    await r.pay({
      invoiceId: (await inv()).id,
      accountId: a.id,
      amountCents: 100000,
      date: '2026-01-15',
    })
    await r.refundPurchase(p.id, 100000, '2026-01-25', 'Devolução integral')
    const next = await r.createPurchase(input({ amountCents: 40000, date: '2026-03-05' })),
      snapshot = await s(),
      source = snapshot.invoices.find((i) => invoiceSummary(snapshot, i, asOf).credit > 0)!,
      target = snapshot.invoices.find((i) =>
        snapshot.installments.some(
          (part) => part.purchaseId === next.id && part.invoiceId === i.id,
        ),
      )!
    const balance = balancesAt(snapshot, asOf)[a.id]
    await r.applyCredit(source.id, target.id, 40000)
    expect(invoiceSummary(await s(), target, asOf).remaining).toBe(0)
    expect(balancesAt(await s(), asOf)[a.id]).toBe(balance)
    expect(await d.invoiceEntries.where('transferId').notEqual('').count()).toBe(2)
    expect(monthlySummary(await s(), new Date(2026, 2, 1), asOf).expense).toBe(40000)
  })
  it('rejects refunds above financed total and preserves all data on failure', async () => {
    const p = await r.createPurchase(input())
    await r.refundPurchase(p.id, 50000, '2026-01-15', 'Devolução parcial')
    const count = await d.invoiceEntries.count()
    await expect(
      r.refundPurchase(p.id, 70001, '2026-01-16', 'Devolução excessiva'),
    ).rejects.toThrow('excede')
    expect(await d.invoiceEntries.count()).toBe(count)
  })
  it('charges only explicitly registered interest or penalties', async () => {
    await r.createPurchase(input())
    const invoice = await inv()
    expect(invoiceSummary(await s(), invoice, asOf).charges).toBe(0)
    await r.addCharge(invoice.id, 1234, '2026-01-25', 'Multa informada', categoryId)
    expect(invoiceSummary(await s(), invoice, asOf)).toMatchObject({
      charges: 1234,
      remaining: 121234,
    })
    expect(monthlySummary(await s(), new Date(2026, 0, 1), asOf).expense).toBe(121234)
  })
  it('monthly consumption can be recognized by invoice competence instead of whole purchase', async () => {
    await r.createPurchase(input({ amountCents: 300000, installmentCount: 6 }))
    const snapshot = await s()
    expect(monthlySummary(snapshot, new Date(2026, 0, 1), asOf, 'purchase').expense).toBe(300000)
    expect(monthlySummary(snapshot, new Date(2026, 0, 1), asOf, 'installment').expense).toBe(50000)
    expect(monthlySummary(snapshot, new Date(2026, 1, 1), asOf, 'installment').expense).toBe(50000)
  })
  it('cashflow uses unpaid residual invoices once, including after anticipation', async () => {
    await r.createPurchase(input({ amountCents: 300000, installmentCount: 6 }))
    const feb = (await d.invoices.toArray()).find((i) => i.period === '2026-02')!
    await r.pay({ invoiceId: feb.id, accountId: a.id, amountCents: 10000, date: '2026-01-15' })
    const snapshot = await s(),
      plan = creditPlanning(snapshot, new Date(2026, 1, 1), '2026-01-16', 390000)
    expect(plan.invoiceExpense).toBe(40000)
    expect(plan.projected).toBe(300000)
  })
})
describe('credit persistence, backup and atomic failures', () => {
  it('reopens database with all links and balances intact', async () => {
    await r.createPurchase(input({ installmentCount: 3 }))
    await r.pay({
      invoiceId: (await inv()).id,
      accountId: a.id,
      amountCents: 20000,
      date: '2026-01-15',
    })
    const name = d.name
    d.close()
    d = new FinancialDatabase(name)
    const snapshot = await s()
    expect(snapshot.cards).toHaveLength(1)
    expect(snapshot.installments).toHaveLength(3)
    expect(balancesAt(snapshot, asOf)[a.id]).toBe(380000)
    assertCreditIntegrity(snapshot)
  })
  it('exports and restores credit graph including refunds and payments', async () => {
    const p = await r.createPurchase(input({ installmentCount: 3 }))
    await r.pay({
      invoiceId: (await inv()).id,
      accountId: b.id,
      amountCents: 10000,
      date: '2026-01-15',
    })
    await r.refundPurchase(p.id, 5000, '2026-01-20', 'Estorno parcial')
    const copy = await backup.export(),
      before = await s()
    expect(copy.schemaVersion).toBe(3)
    await backup.restore(copy, 'RESTAURAR')
    expect(await s()).toEqual(before)
    assertCreditIntegrity(await s())
  })
  it('rejects orphaned installments and tampered financed totals on restore', async () => {
    await r.createPurchase(input({ installmentCount: 3 }))
    const copy = await backup.export(),
      bad = structuredClone(copy)
    bad.data.installments[0].amountCents += 1
    await expect(backup.restore(bad, 'RESTAURAR')).rejects.toThrow('parcelas divergente')
    const orphan = structuredClone(copy)
    orphan.data.invoices = []
    expect(() => backup.preview(orphan)).toThrow()
    expect(await d.installments.count()).toBe(3)
  })
  it('rolls back purchase, all invoices and installments when audit fails', async () => {
    d.audit.hook('creating', () => {
      throw new Error('Audit unavailable')
    })
    await expect(r.createPurchase(input({ installmentCount: 6 }))).rejects.toThrow(
      'Audit unavailable',
    )
    expect(await d.purchases.count()).toBe(0)
    expect(await d.invoices.count()).toBe(0)
    expect(await d.installments.count()).toBe(0)
  })
  it('rolls back payment and bank debit if audit fails', async () => {
    await r.createPurchase(input())
    d.audit.hook('creating', () => {
      throw new Error('Payment audit unavailable')
    })
    await expect(
      r.pay({
        invoiceId: (await inv()).id,
        accountId: a.id,
        amountCents: 120000,
        date: '2026-01-15',
      }),
    ).rejects.toThrow()
    expect(await d.payments.count()).toBe(0)
    expect(balancesAt(await s(), asOf)[a.id]).toBe(400000)
    expect(cardSummary(await s(), card, asOf).used).toBe(120000)
  })
  it('rolls back all credit notes when refund fails halfway', async () => {
    const p = await r.createPurchase(input({ installmentCount: 3 }))
    let count = 0
    d.invoiceEntries.hook('creating', () => {
      if (++count === 2) throw new Error('Credit note failure')
    })
    await expect(
      r.refundPurchase(p.id, 120000, '2026-01-25', 'Devolução completa'),
    ).rejects.toThrow('Credit note failure')
    expect(await d.invoiceEntries.count()).toBe(0)
    expect(cardSummary(await s(), card, asOf).used).toBe(120000)
  })
  it('serializes concurrent payments to prevent overpayment', async () => {
    await r.createPurchase(input())
    const invoiceId = (await inv()).id
    const results = await Promise.allSettled([
      r.pay({ invoiceId, accountId: a.id, amountCents: 120000, date: '2026-01-15' }),
      r.pay({ invoiceId, accountId: a.id, amountCents: 120000, date: '2026-01-15' }),
    ])
    expect(results.filter((v) => v.status === 'fulfilled')).toHaveLength(1)
    expect(await d.payments.count()).toBe(1)
    expect(balancesAt(await s(), asOf)[a.id]).toBe(280000)
  })
  it('migrates v2 without changing pre-existing bank balances or categories', async () => {
    const name = `v2-${crypto.randomUUID()}`,
      old = new Dexie(name)
    old.version(2).stores({
      accounts: 'id, name, createdAt',
      cards: 'id, accountId',
      transactions: 'id, accountId, categoryId, date, status',
      purchases: 'id, cardId, date',
      installments: 'id, purchaseId, invoiceId',
      invoices: 'id, cardId, [cardId+period]',
      payments: 'id, invoiceId, accountId',
      recurring: 'id, accountId',
      categories: 'id, direction',
      transfers: 'id, sourceAccountId, destinationAccountId, date, status',
      adjustments: 'id, accountId, categoryId, date, status',
      settings: 'id',
      audit: 'id, entityId, at',
    })
    await old.open()
    await old.table('accounts').bulkAdd([a, b])
    const category = (await d.categories.toArray())[0]
    await old.table('categories').add(category)
    await old.table('cards').add({
      id: card.id,
      accountId: a.id,
      name: 'Legado',
      limitCents: 12345,
      closingDay: 31,
      dueDay: 5,
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
    })
    old.close()
    const upgraded = new FinancialDatabase(name)
    try {
      await upgraded.open()
      expect(upgraded.verno).toBe(4)
      expect(await upgraded.accounts.get(a.id)).toEqual(a)
      expect(await upgraded.categories.toArray()).toEqual([category])
      expect((await upgraded.cards.get(card.id))?.archived).toBe(false)
      expect(balancesAt(await readSnapshot(upgraded), asOf)[a.id]).toBe(400000)
      expect(await upgraded.invoiceEntries.count()).toBe(0)
    } finally {
      await upgraded.delete()
    }
  })
})
