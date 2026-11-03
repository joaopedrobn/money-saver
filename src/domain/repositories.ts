import type {
  BankAccount,
  AccountInput,
  Entity,
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
  Movement,
  MovementInput,
  MovementKind,
  CivilDate,
  CategoryInput,
  CreditSnapshot,
  CardInput,
  PurchaseInput,
  PaymentInput,
  InvoiceEntry,
  CreditRegime,
  RecurringInput,
} from './models'
import type { Backup } from './backup'
export interface BackupRepository {
  export(): Promise<Backup>
  preview(value: unknown): Backup
  restore(value: unknown, confirmation: string): Promise<void>
}
export interface ReadRepository<T extends Entity> {
  list(): Promise<T[]>
  get(id: string): Promise<T | undefined>
}
export interface AccountRepository extends ReadRepository<BankAccount> {
  create(input: AccountInput): Promise<BankAccount>
  update(id: string, input: AccountInput): Promise<BankAccount>
  remove(id: string): Promise<void>
}
export interface MovementRepository {
  list(): Promise<Movement[]>
  create(input: MovementInput): Promise<Movement>
  update(kind: MovementKind, id: string, input: MovementInput): Promise<Movement>
  remove(kind: MovementKind, id: string): Promise<void>
  settle(kind: MovementKind, id: string, date: CivilDate): Promise<Movement>
}
export interface CategoryRepository extends ReadRepository<Category> {
  create(input: CategoryInput): Promise<Category>
  update(id: string, input: CategoryInput): Promise<Category>
  archive(id: string, archived: boolean): Promise<void>
}
export interface CreditRepository {
  createCard(input: CardInput): Promise<CreditCard>
  updateCard(id: string, input: CardInput): Promise<CreditCard>
  archiveCard(id: string, archived: boolean): Promise<void>
  createPurchase(input: PurchaseInput, expectedPlan?: string): Promise<CreditCardPurchase>
  updatePurchase(
    id: string,
    input: PurchaseInput,
    expectedPlan?: string,
  ): Promise<CreditCardPurchase>
  cancelPurchase(id: string, reason: string): Promise<void>
  refundPurchase(id: string, amountCents: number, date: CivilDate, reason: string): Promise<void>
  pay(input: PaymentInput): Promise<InvoicePayment>
  correctPayment(id: string, input: PaymentInput): Promise<InvoicePayment>
  reversePayment(id: string, date: CivilDate, reason: string): Promise<void>
  addCharge(
    invoiceId: string,
    amountCents: number,
    date: CivilDate,
    description: string,
    categoryId: string,
  ): Promise<InvoiceEntry>
  applyCredit(sourceInvoiceId: string, targetInvoiceId: string, amountCents: number): Promise<void>
  reverseCharge(id: string, date: CivilDate, reason: string): Promise<void>
}
export interface SettingsRepository extends ReadRepository<FinancialSettings> {
  setCreditRegime(regime: CreditRegime): Promise<void>
}
/** Ports for subsequent modules; no write operations exposed before their invariants exist. */
export interface FinancialRepositories {
  planning: {
    saveRecurring(input: RecurringInput, id?: string): Promise<RecurringTransaction>
    status(id: string, status: 'active' | 'paused' | 'ended'): Promise<void>
    realize(
      id: string,
      date: CivilDate,
      amountCents: number,
      effectiveDate: CivilDate,
    ): Promise<void>
    saveBudget(month: string, categoryId: string, amountCents: number): Promise<void>
    removeBudget(id: string): Promise<void>
  }
  accounts: AccountRepository
  cards: ReadRepository<CreditCard>
  transactions: ReadRepository<Transaction>
  purchases: ReadRepository<CreditCardPurchase>
  installments: ReadRepository<Installment>
  invoices: ReadRepository<CreditCardInvoice>
  payments: ReadRepository<InvoicePayment>
  recurring: ReadRepository<RecurringTransaction>
  categories: CategoryRepository
  transfers: ReadRepository<Transfer>
  adjustments: ReadRepository<BalanceAdjustment>
  settings: SettingsRepository
  movements: MovementRepository
  snapshot(): Promise<CreditSnapshot>
  backup: BackupRepository
  credit: CreditRepository
}
