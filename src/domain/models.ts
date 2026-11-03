/** Dates are local civil YYYY-MM-DD; instants are UTC ISO 8601. Money is integer BRL cents. */
export type CivilDate = `${number}-${number}-${number}`
export type Instant = string
export type Cents = number
export interface Entity {
  id: string
  createdAt: Instant
  updatedAt: Instant
}
export type AccountType = 'checking' | 'savings' | 'cash' | 'investment'
export interface BankAccount extends Entity {
  name: string
  institution: string
  type: AccountType
  openingBalanceCents: Cents
  openingDate: CivilDate
  color: string
}
export type AccountInput = Omit<BankAccount, keyof Entity>
export interface CreditCard extends Entity {
  accountId: string
  name: string
  limitCents: Cents
  closingDay: number
  dueDay: number
  institution?: string
  nickname?: string
  brand?: string
  lastFour?: string
  color?: string
  archived?: boolean
}
export interface Transaction extends Entity {
  accountId: string
  categoryId: string
  description: string
  amountCents: Cents
  direction: 'income' | 'expense'
  method: 'pix' | 'debit' | 'cash' | 'other'
  date: CivilDate
  status: MovementStatus
  settledDate?: CivilDate
  recurringId?: string
  notes?: string
}
export interface CreditCardPurchase extends Entity {
  cardId: string
  categoryId: string
  description: string
  amountCents: Cents
  date: CivilDate
  installmentCount: number
  feeCents?: Cents
  notes?: string
  status?: 'active' | 'cancelled'
  cancellationReason?: string
}
export interface Installment extends Entity {
  purchaseId: string
  invoiceId: string
  number: number
  amountCents: Cents
  principalCents?: Cents
}
export interface CreditCardInvoice extends Entity {
  cardId: string
  period: string
  closingDate: CivilDate
  dueDate: CivilDate
  startDate?: CivilDate
  closingDaySnapshot?: number
  dueDaySnapshot?: number
}
/** Invoice status and totals are derived from closing date, installments and payments. */
export interface InvoicePayment extends Entity {
  invoiceId: string
  accountId: string
  amountCents: Cents
  date: CivilDate
  reversalDate?: CivilDate
  reversalReason?: string
  reversedAt?: Instant
  notes?: string
}
export interface InvoiceEntry extends Entity {
  invoiceId: string
  kind: 'charge' | 'refund' | 'credit-in' | 'credit-out' | 'charge-reversal'
  amountCents: Cents
  date: CivilDate
  description: string
  purchaseId?: string
  categoryId?: string
  transferId?: string
  originalEntryId?: string
}
export interface CardInput {
  accountId: string
  name: string
  institution: string
  nickname: string
  brand: string
  lastFour: string
  color: string
  limitCents: Cents
  closingDay: number
  dueDay: number
}
export type PurchaseInput = Pick<
  CreditCardPurchase,
  'cardId' | 'categoryId' | 'description' | 'amountCents' | 'date' | 'installmentCount' | 'notes'
> & { feeCents: Cents }
export interface PaymentInput {
  invoiceId: string
  accountId: string
  amountCents: Cents
  date: CivilDate
  notes?: string
}
export type CreditRegime = 'purchase' | 'installment'
export interface RecurringTransaction extends Entity {
  accountId: string
  categoryId: string
  description: string
  direction: 'income' | 'expense'
  amountCents: Cents
  startDate: CivilDate
  endDate?: CivilDate
  dayOfMonth: number
  frequency: 'monthly' | 'weekly' | 'yearly'
  active: boolean
  cardId?: string
  ended?: boolean
}
export type RecurringInput = Omit<RecurringTransaction, keyof Entity | 'active' | 'ended'>
export interface RecurringOccurrence extends Entity {
  recurringId: string
  date: CivilDate
  transactionId?: string
  purchaseId?: string
}
export interface MonthlyBudget extends Entity {
  month: string
  categoryId: string
  amountCents: Cents
}
export interface Category extends Entity {
  name: string
  direction: 'income' | 'expense'
  color: string
  icon: string
  archived?: boolean
}
export interface Transfer extends Entity {
  sourceAccountId: string
  destinationAccountId: string
  amountCents: Cents
  date: CivilDate
  description: string
  status?: MovementStatus
  settledDate?: CivilDate
  notes?: string
}
export interface BalanceAdjustment extends Entity {
  accountId: string
  deltaCents: Cents
  date: CivilDate
  reason: string
  categoryId?: string
  status?: MovementStatus
  settledDate?: CivilDate
  notes?: string
}
export interface FinancialSettings extends Entity {
  currency: 'BRL'
  locale: 'pt-BR'
  theme: 'dark'
  weekStartsOn: 0 | 1
  creditRegime?: CreditRegime
}
export interface AuditEvent {
  id: string
  entityId: string
  entityType:
    | 'account'
    | 'transaction'
    | 'transfer'
    | 'adjustment'
    | 'category'
    | 'backup'
    | 'card'
    | 'purchase'
    | 'payment'
    | 'invoice-entry'
    | 'settings'
    | 'recurring'
    | 'budget'
  action: 'create' | 'update' | 'delete'
  at: Instant
  before?: Entity & { name?: string }
  after?: Entity & { name?: string }
}
export type MovementStatus = 'planned' | 'pending' | 'settled' | 'cancelled'
export type MovementKind = 'transaction' | 'transfer' | 'adjustment'
export interface MovementInput {
  kind: MovementKind
  accountId: string
  destinationAccountId?: string
  categoryId?: string
  description: string
  amountCents: Cents
  direction: 'income' | 'expense'
  method: Transaction['method']
  date: CivilDate
  status: MovementStatus
  settledDate?: CivilDate
  notes?: string
}
export interface Movement extends Entity, MovementInput {
  readOnly?: boolean
  paymentId?: string
  paymentReversal?: boolean
}
export type CategoryInput = Pick<Category, 'name' | 'direction' | 'color' | 'icon'>
export interface FinancialSnapshot {
  recurring?: RecurringTransaction[]
  occurrences?: RecurringOccurrence[]
  budgets?: MonthlyBudget[]
  accounts: BankAccount[]
  transactions: Transaction[]
  transfers: Transfer[]
  adjustments: BalanceAdjustment[]
  payments: InvoicePayment[]
  categories: Category[]
  cards?: CreditCard[]
  purchases?: CreditCardPurchase[]
  installments?: Installment[]
  invoices?: CreditCardInvoice[]
  invoiceEntries?: InvoiceEntry[]
  settings?: FinancialSettings[]
}
export interface CreditSnapshot extends FinancialSnapshot {
  cards: CreditCard[]
  purchases: CreditCardPurchase[]
  installments: Installment[]
  invoices: CreditCardInvoice[]
  invoiceEntries: InvoiceEntry[]
  settings: FinancialSettings[]
}
