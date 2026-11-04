import type {
  AccountRepository,
  ReadRepository,
  FinancialRepositories,
} from '@/domain/repositories'
import type {
  AccountInput,
  BankAccount,
  Entity,
  CivilDate,
  CreditCard,
  Transaction,
  CreditCardPurchase,
  Installment,
  CreditCardInvoice,
  InvoicePayment,
  RecurringTransaction,
  Transfer,
  BalanceAdjustment,
} from '@/domain/models'
import { FinancialDatabase, db } from './database'
import { accountFormSchema } from '@/domain/validation'
import { formatMoneyInput } from '@/domain/money'
import {
  DexieMovementRepository,
  DexieCategoryRepository,
  readSnapshot,
} from './movement-repository'
import { DexieBackupRepository } from './backup-repository'
import { DexiePlanningRepository } from './planning-repository'
import { DexieCreditRepository, DexieSettingsRepository } from './credit-repository'
import { selectPersistenceBackend } from './supabase/config'
function validate(input: AccountInput): AccountInput {
  const parsed = accountFormSchema.parse({
    ...input,
    openingBalance: formatMoneyInput(input.openingBalanceCents),
  })
  if (!Number.isSafeInteger(input.openingBalanceCents)) throw new Error('Saldo inválido.')
  return {
    name: parsed.name,
    institution: parsed.institution,
    type: parsed.type,
    color: parsed.color,
    openingDate: parsed.openingDate as CivilDate,
    openingBalanceCents: input.openingBalanceCents,
  }
}
export class DexieAccountRepository implements AccountRepository {
  constructor(private readonly database: FinancialDatabase) {}
  list() {
    return this.database.accounts.orderBy('createdAt').toArray()
  }
  get(id: string) {
    return this.database.accounts.get(id)
  }
  async create(input: AccountInput) {
    const now = new Date().toISOString()
    const account: BankAccount = {
      ...validate(input),
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }
    await this.database.transaction(
      'rw',
      [this.database.accounts, this.database.audit],
      async () => {
        await this.database.accounts.add(account)
        await this.database.audit.add({
          id: crypto.randomUUID(),
          entityId: account.id,
          entityType: 'account',
          action: 'create',
          at: now,
          after: account,
        })
      },
    )
    return account
  }
  async update(id: string, input: AccountInput) {
    const validated = validate(input)
    return this.database.transaction(
      'rw',
      [
        this.database.accounts,
        this.database.audit,
        this.database.transactions,
        this.database.transfers,
        this.database.payments,
        this.database.adjustments,
      ],
      async () => {
        const before = await this.get(id)
        if (!before) throw new Error('Conta não encontrada. Atualize a página e tente novamente.')
        if (
          before.openingBalanceCents !== validated.openingBalanceCents ||
          before.openingDate !== validated.openingDate
        ) {
          if (await this.hasMovements(id))
            throw new Error(
              'Contas com movimentações não permitem alterar o saldo ou a data inicial. Registre um ajuste de saldo na página Lançamentos.',
            )
        }
        const after = { ...before, ...validated, updatedAt: new Date().toISOString() }
        await this.database.accounts.put(after)
        await this.database.audit.add({
          id: crypto.randomUUID(),
          entityId: id,
          entityType: 'account',
          action: 'update',
          at: after.updatedAt,
          before,
          after,
        })
        return after
      },
    )
  }
  private async hasMovements(id: string) {
    const d = this.database
    const counts = await Promise.all([
      d.transactions.where('accountId').equals(id).count(),
      d.transfers.where('sourceAccountId').equals(id).count(),
      d.transfers.where('destinationAccountId').equals(id).count(),
      d.payments.where('accountId').equals(id).count(),
      d.adjustments.where('accountId').equals(id).count(),
    ])
    return counts.some(Boolean)
  }
  async remove(id: string) {
    const d = this.database
    await d.transaction(
      'rw',
      [
        d.accounts,
        d.audit,
        d.cards,
        d.transactions,
        d.transfers,
        d.payments,
        d.adjustments,
        d.recurring,
      ],
      async () => {
        const before = await this.get(id)
        if (!before) throw new Error('Conta não encontrada.')
        if (
          (await this.hasMovements(id)) ||
          (await d.cards.where('accountId').equals(id).count()) ||
          (await d.recurring.where('accountId').equals(id).count())
        )
          throw new Error('Esta conta possui vínculos financeiros e não pode ser excluída.')
        await d.accounts.delete(id)
        await d.audit.add({
          id: crypto.randomUUID(),
          entityId: id,
          entityType: 'account',
          action: 'delete',
          at: new Date().toISOString(),
          before,
        })
      },
    )
  }
}
const read = <T extends Entity>(table: {
  toArray(): Promise<T[]>
  get(id: string): Promise<T | undefined>
}): ReadRepository<T> => ({ list: () => table.toArray(), get: (id) => table.get(id) })
export const activePersistenceBackend = selectPersistenceBackend()
export const repositories: FinancialRepositories = {
  planning: new DexiePlanningRepository(db),
  accounts: new DexieAccountRepository(db),
  cards: read<CreditCard>(db.cards),
  transactions: read<Transaction>(db.transactions),
  purchases: read<CreditCardPurchase>(db.purchases),
  installments: read<Installment>(db.installments),
  invoices: read<CreditCardInvoice>(db.invoices),
  payments: read<InvoicePayment>(db.payments),
  recurring: read<RecurringTransaction>(db.recurring),
  categories: new DexieCategoryRepository(db),
  transfers: read<Transfer>(db.transfers),
  adjustments: read<BalanceAdjustment>(db.adjustments),
  settings: new DexieSettingsRepository(db),
  movements: new DexieMovementRepository(db),
  snapshot: () => readSnapshot(db),
  backup: new DexieBackupRepository(db),
  credit: new DexieCreditRepository(db),
}
