import type { MovementRepository, CategoryRepository } from '@/domain/repositories'
import type {
  MovementInput,
  MovementKind,
  Movement,
  CategoryInput,
  CivilDate,
  Entity,
  AuditEvent,
  CreditSnapshot,
} from '@/domain/models'
import { validateMovement, validateCategory } from '@/domain/financial-validation'
import { movementsFrom, movementKey } from '@/domain/finance'
import type { FinancialDatabase } from './database'
export class DexieMovementRepository implements MovementRepository {
  constructor(private readonly d: FinancialDatabase) {}
  private tables() {
    const d = this.d
    return [d.accounts, d.categories, d.transactions, d.transfers, d.adjustments, d.audit]
  }
  async list() {
    return this.d.transaction('r', this.tables(), async () =>
      movementsFrom({
        transactions: await this.d.transactions.toArray(),
        transfers: await this.d.transfers.toArray(),
        adjustments: await this.d.adjustments.toArray(),
      }),
    )
  }
  private table(kind: MovementKind) {
    return kind === 'transaction'
      ? this.d.transactions
      : kind === 'transfer'
        ? this.d.transfers
        : this.d.adjustments
  }
  private async save(input: MovementInput, id?: string): Promise<Movement> {
    const value = validateMovement(input),
      d = this.d
    return d.transaction('rw', this.tables(), async () => {
      const table = this.table(value.kind),
        before = id ? await table.get(id) : undefined
      if (id && !before) throw new Error('Lançamento não encontrado. Atualize a página.')
      const previous = id
        ? (await this.list()).find((m) => movementKey(m) === `${value.kind}:${id}`)
        : undefined
      for (const accountId of [
        value.accountId,
        ...(value.kind === 'transfer' ? [value.destinationAccountId!] : []),
      ]) {
        const account = await d.accounts.get(accountId)
        if (!account) throw new Error('Conta bancária não encontrada.')
        if (
          value.date < account.openingDate ||
          (value.settledDate && value.settledDate < account.openingDate)
        )
          throw new Error(
            `A operação e sua efetivação devem ser a partir da data inicial de ${account.name}.`,
          )
      }
      if (value.kind !== 'transfer') {
        const category = value.categoryId ? await d.categories.get(value.categoryId) : undefined
        if (!category || category.direction !== value.direction)
          throw new Error('Categoria inexistente ou incompatível com receita/despesa.')
        if (category.archived && (!previous || previous.categoryId !== category.id))
          throw new Error('Esta categoria está arquivada. Escolha uma categoria ativa.')
      }
      const now = new Date().toISOString(),
        entity = {
          id: id ?? crypto.randomUUID(),
          createdAt: before?.createdAt ?? now,
          updatedAt: now,
        }
      const common = {
        ...entity,
        date: value.date,
        status: value.status,
        settledDate: value.settledDate,
        notes: value.notes,
      }
      if (value.kind === 'transaction')
        await d.transactions.put({
          ...common,
          accountId: value.accountId,
          categoryId: value.categoryId!,
          description: value.description,
          amountCents: value.amountCents,
          direction: value.direction,
          method: value.method,
          recurringId: before && 'recurringId' in before ? before.recurringId : undefined,
        })
      else if (value.kind === 'transfer')
        await d.transfers.put({
          ...common,
          sourceAccountId: value.accountId,
          destinationAccountId: value.destinationAccountId!,
          description: value.description,
          amountCents: value.amountCents,
        })
      else
        await d.adjustments.put({
          ...common,
          accountId: value.accountId,
          categoryId: value.categoryId,
          reason: value.description,
          deltaCents: value.amountCents * (value.direction === 'income' ? 1 : -1),
        })
      const after = await table.get(entity.id)
      await d.audit.add({
        id: crypto.randomUUID(),
        entityId: entity.id,
        entityType: value.kind,
        action: before ? 'update' : 'create',
        at: now,
        before,
        after,
      })
      return (await this.list()).find((m) => movementKey(m) === `${value.kind}:${entity.id}`)!
    })
  }
  create(input: MovementInput) {
    return this.save(input)
  }
  update(kind: MovementKind, id: string, input: MovementInput) {
    if (kind !== input.kind)
      return Promise.reject(new Error('O tipo estrutural do lançamento não pode ser alterado.'))
    return this.save(input, id)
  }
  async remove(kind: MovementKind, id: string) {
    await this.d.transaction('rw', this.tables(), async () => {
      const table = this.table(kind)
      const before = await table.get(id)
      if (!before) throw new Error('Lançamento não encontrado.')
      if ('recurringId' in before && before.recurringId)
        throw new Error(
          'Ocorrência efetivada: edite ou cancele o lançamento para preservar o vínculo.',
        )
      await table.delete(id)
      await this.d.audit.add({
        id: crypto.randomUUID(),
        entityId: id,
        entityType: kind,
        action: 'delete',
        at: new Date().toISOString(),
        before,
      })
    })
  }
  async settle(kind: MovementKind, id: string, date: CivilDate) {
    return this.d.transaction('rw', this.tables(), async () => {
      const previous = (await this.list()).find((m) => m.id === id && m.kind === kind)
      if (!previous || !['planned', 'pending'].includes(previous.status))
        throw new Error('Somente lançamentos previstos ou pendentes podem ser efetivados.')
      return this.save({ ...previous, status: 'settled', settledDate: date }, id)
    })
  }
}
export class DexieCategoryRepository implements CategoryRepository {
  constructor(private readonly d: FinancialDatabase) {}
  list() {
    return this.d.categories.toArray()
  }
  get(id: string) {
    return this.d.categories.get(id)
  }
  private async save(input: CategoryInput, id?: string) {
    const value = validateCategory(input)
    return this.d.transaction('rw', [this.d.categories, this.d.audit], async () => {
      const before = id ? await this.get(id) : undefined
      if (id && !before) throw new Error('Categoria não encontrada.')
      if (before && before.direction !== value.direction)
        throw new Error('O grupo da categoria não pode ser alterado. Crie outra categoria.')
      if (
        (await this.list()).some(
          (c) =>
            c.id !== id &&
            c.direction === value.direction &&
            c.name.toLocaleLowerCase('pt-BR') === value.name.toLocaleLowerCase('pt-BR'),
        )
      )
        throw new Error('Já existe uma categoria com este nome neste grupo.')
      const now = new Date().toISOString(),
        after = {
          ...value,
          id: id ?? crypto.randomUUID(),
          createdAt: before?.createdAt ?? now,
          updatedAt: now,
          archived: before?.archived ?? false,
        }
      await this.d.categories.put(after)
      await this.audit(before ? 'update' : 'create', after, before)
      return after
    })
  }
  private audit(action: AuditEvent['action'], after: Entity, before?: Entity) {
    return this.d.audit.add({
      id: crypto.randomUUID(),
      entityId: after.id,
      entityType: 'category',
      action,
      at: new Date().toISOString(),
      before,
      after,
    })
  }
  create(input: CategoryInput) {
    return this.save(input)
  }
  update(id: string, input: CategoryInput) {
    return this.save(input, id)
  }
  async archive(id: string, archived: boolean) {
    await this.d.transaction('rw', [this.d.categories, this.d.audit], async () => {
      const before = await this.get(id)
      if (!before) throw new Error('Categoria não encontrada.')
      const after = { ...before, archived, updatedAt: new Date().toISOString() }
      await this.d.categories.put(after)
      await this.audit('update', after, before)
    })
  }
}
export function readSnapshot(d: FinancialDatabase): Promise<CreditSnapshot> {
  return d.transaction(
    'r',
    [
      d.accounts,
      d.transactions,
      d.transfers,
      d.adjustments,
      d.payments,
      d.categories,
      d.cards,
      d.purchases,
      d.installments,
      d.invoices,
      d.invoiceEntries,
      d.settings,
      d.recurring,
      d.occurrences,
      d.budgets,
    ],
    async () => ({
      accounts: await d.accounts.toArray(),
      transactions: await d.transactions.toArray(),
      transfers: await d.transfers.toArray(),
      adjustments: await d.adjustments.toArray(),
      payments: await d.payments.toArray(),
      categories: await d.categories.toArray(),
      cards: await d.cards.toArray(),
      purchases: await d.purchases.toArray(),
      installments: await d.installments.toArray(),
      invoices: await d.invoices.toArray(),
      invoiceEntries: await d.invoiceEntries.toArray(),
      settings: await d.settings.toArray(),
      recurring: await d.recurring.toArray(),
      occurrences: await d.occurrences.toArray(),
      budgets: await d.budgets.toArray(),
    }),
  )
}
