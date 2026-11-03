import Dexie, { type EntityTable } from 'dexie'
import { defaultCategories } from '@/domain/default-categories'
import type {
  BankAccount,
  CreditCard,
  Transaction,
  CreditCardPurchase,
  Installment,
  CreditCardInvoice,
  InvoicePayment,
  RecurringTransaction,
  Category,
  Transfer,
  BalanceAdjustment,
  FinancialSettings,
  AuditEvent,
  InvoiceEntry,
  RecurringOccurrence,
  MonthlyBudget,
} from '@/domain/models'
export class FinancialDatabase extends Dexie {
  occurrences!: EntityTable<RecurringOccurrence, 'id'>
  budgets!: EntityTable<MonthlyBudget, 'id'>
  accounts!: EntityTable<BankAccount, 'id'>
  cards!: EntityTable<CreditCard, 'id'>
  transactions!: EntityTable<Transaction, 'id'>
  purchases!: EntityTable<CreditCardPurchase, 'id'>
  installments!: EntityTable<Installment, 'id'>
  invoices!: EntityTable<CreditCardInvoice, 'id'>
  payments!: EntityTable<InvoicePayment, 'id'>
  recurring!: EntityTable<RecurringTransaction, 'id'>
  categories!: EntityTable<Category, 'id'>
  transfers!: EntityTable<Transfer, 'id'>
  adjustments!: EntityTable<BalanceAdjustment, 'id'>
  settings!: EntityTable<FinancialSettings, 'id'>
  audit!: EntityTable<AuditEvent, 'id'>
  invoiceEntries!: EntityTable<InvoiceEntry, 'id'>
  constructor(name = 'money-saver') {
    super(name)
    this.version(1).stores({
      accounts: 'id, name, createdAt',
      cards: 'id, accountId',
      transactions: 'id, accountId, categoryId, date, status',
      purchases: 'id, cardId, date',
      installments: 'id, purchaseId, invoiceId',
      invoices: 'id, cardId, [cardId+period]',
      payments: 'id, invoiceId, accountId',
      recurring: 'id, accountId',
      categories: 'id, direction',
      transfers: 'id, sourceAccountId, destinationAccountId',
      adjustments: 'id, accountId',
      settings: 'id',
      audit: 'id, entityId, at',
    })
    this.version(2)
      .stores({
        transfers: 'id, sourceAccountId, destinationAccountId, date, status',
        adjustments: 'id, accountId, categoryId, date, status',
      })
      .upgrade(async (tx) => {
        await tx
          .table('transfers')
          .toCollection()
          .modify((t) => {
            t.status ??= 'settled'
            if (t.status === 'settled') t.settledDate ??= t.date
          })
        await tx
          .table('adjustments')
          .toCollection()
          .modify((t) => {
            t.status ??= 'settled'
            if (t.status === 'settled') t.settledDate ??= t.date
          })
        await tx
          .table('transactions')
          .toCollection()
          .modify((t) => {
            if (t.status === 'settled') t.settledDate ??= t.date
          })
        await tx
          .table('categories')
          .toCollection()
          .modify((c) => {
            c.archived ??= false
          })
        const existing = await tx.table('categories').toArray()
        const missing = defaultCategories().filter(
          (c) =>
            !existing.some(
              (previous) =>
                previous.id === c.id ||
                (previous.name.toLocaleLowerCase('pt-BR') === c.name.toLocaleLowerCase('pt-BR') &&
                  previous.direction === c.direction),
            ),
        )
        if (missing.length) await tx.table('categories').bulkAdd(missing)
      })
    this.version(3)
      .stores({
        invoices: 'id, cardId, &[cardId+period], dueDate, closingDate',
        installments: 'id, purchaseId, invoiceId, &[purchaseId+number]',
        purchases: 'id, cardId, date, categoryId',
        invoiceEntries: 'id, invoiceId, purchaseId, transferId, date',
      })
      .upgrade(async (tx) => {
        await tx
          .table('cards')
          .toCollection()
          .modify((c) => {
            c.institution ??= 'Instituição não informada'
            c.nickname ??= ''
            c.brand ??= ''
            c.lastFour ??= ''
            c.color ??= 'sage'
            c.archived ??= false
          })
        await tx
          .table('purchases')
          .toCollection()
          .modify((p) => {
            p.feeCents ??= 0
            p.status ??= 'active'
          })
        await tx
          .table('installments')
          .toCollection()
          .modify((i) => {
            i.principalCents ??= i.amountCents
          })
      })
    this.version(4).stores({
      recurring: 'id, accountId, cardId',
      occurrences: 'id, recurringId, &[recurringId+date]',
      budgets: 'id, &[month+categoryId]',
    })
    this.on('populate', (tx) =>
      tx
        .table('categories')
        .bulkAdd(defaultCategories())
        .then(() => undefined),
    )
  }
}
export const db = new FinancialDatabase()
