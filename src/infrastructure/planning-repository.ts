import type { FinancialDatabase } from './database'
import type { CivilDate, RecurringInput, Entity } from '@/domain/models'
import { recurringDates, recurringSchema } from '@/domain/planning'
import { centsSchema, civilDateSchema, today } from '@/domain/financial-validation'
import { DexieMovementRepository } from './movement-repository'
import { DexieCreditRepository } from './credit-repository'
const entity = () => {
  const now = new Date().toISOString()
  return { id: crypto.randomUUID(), createdAt: now, updatedAt: now }
}
export class DexiePlanningRepository {
  constructor(private readonly d: FinancialDatabase) {}
  private async audit(type: 'recurring' | 'budget', before: Entity | undefined, after: Entity) {
    await this.d.audit.add({
      id: crypto.randomUUID(),
      entityId: after.id,
      entityType: type,
      action: before ? 'update' : 'create',
      at: new Date().toISOString(),
      before,
      after,
    })
  }
  async saveRecurring(input: RecurringInput, id?: string) {
    const value = recurringSchema.parse(input)
    return this.d.transaction('rw', this.d.tables, async () => {
      const before = id ? await this.d.recurring.get(id) : undefined
      if (id && !before) throw new Error('Recorrência não encontrada.')
      const account = await this.d.accounts.get(value.accountId)
      const category = await this.d.categories.get(value.categoryId)
      if (!account || (!value.cardId && value.startDate < account.openingDate))
        throw new Error('Conta ou data inicial inválida.')
      if (
        !category ||
        category.direction !== value.direction ||
        (category.archived && category.id !== before?.categoryId)
      )
        throw new Error('Categoria inválida ou arquivada.')
      if (value.cardId) {
        const card = await this.d.cards.get(value.cardId)
        if (!card || (card.archived && value.cardId !== before?.cardId))
          throw new Error('Cartão inválido ou arquivado.')
      }
      const after = {
        ...entity(),
        ...before,
        ...value,
        active: before?.active ?? true,
        updatedAt: new Date().toISOString(),
      }
      await this.d.recurring.put(after)
      await this.audit('recurring', before, after)
      return after
    })
  }
  async status(id: string, status: 'active' | 'paused' | 'ended') {
    await this.d.transaction('rw', this.d.tables, async () => {
      const before = await this.d.recurring.get(id)
      if (!before) throw new Error('Recorrência não encontrada.')
      if (before.ended) throw new Error('Recorrência encerrada não pode ser reaberta.')
      const after = {
        ...before,
        active: status === 'active',
        ended: status === 'ended',
        updatedAt: new Date().toISOString(),
      }
      await this.d.recurring.put(after)
      await this.audit('recurring', before, after)
    })
  }
  async realize(id: string, date: CivilDate, amountCents: number, effectiveDate: CivilDate) {
    centsSchema.parse(amountCents)
    civilDateSchema.parse(date)
    civilDateSchema.parse(effectiveDate)
    if (effectiveDate > today()) throw new Error('Efetivação não pode estar no futuro.')
    await this.d.transaction('rw', this.d.tables, async () => {
      const r = await this.d.recurring.get(id)
      if (!r || !recurringDates(r, date, date).length)
        throw new Error('Ocorrência inválida ou recorrência inativa.')
      if (await this.d.occurrences.where('[recurringId+date]').equals([id, date]).count())
        throw new Error('Ocorrência já efetivada.')
      const occurrence = { ...entity(), recurringId: id, date }
      if (r.cardId) {
        const purchase = await new DexieCreditRepository(this.d).createPurchase({
          cardId: r.cardId,
          categoryId: r.categoryId,
          description: r.description,
          amountCents,
          feeCents: 0,
          installmentCount: 1,
          date: effectiveDate,
        })
        await this.d.occurrences.add({ ...occurrence, purchaseId: purchase.id })
      } else {
        const movement = await new DexieMovementRepository(this.d).create({
          kind: 'transaction',
          accountId: r.accountId,
          categoryId: r.categoryId,
          description: r.description,
          direction: r.direction,
          method: 'other',
          status: 'settled',
          amountCents,
          date,
          settledDate: effectiveDate,
        })
        await this.d.transactions.update(movement.id, { recurringId: id })
        await this.d.occurrences.add({ ...occurrence, transactionId: movement.id })
      }
    })
  }
  async saveBudget(month: string, categoryId: string, amountCents: number) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Mês inválido.')
    centsSchema.parse(amountCents)
    await this.d.transaction('rw', this.d.tables, async () => {
      const category = await this.d.categories.get(categoryId)
      if (!category || category.direction !== 'expense')
        throw new Error('Escolha uma categoria de despesa.')
      const before = await this.d.budgets
        .where('[month+categoryId]')
        .equals([month, categoryId])
        .first()
      const after = {
        ...entity(),
        ...before,
        month,
        categoryId,
        amountCents,
        updatedAt: new Date().toISOString(),
      }
      await this.d.budgets.put(after)
      await this.audit('budget', before, after)
    })
  }
  async removeBudget(id: string) {
    await this.d.transaction('rw', this.d.tables, async () => {
      const before = await this.d.budgets.get(id)
      if (!before) throw new Error('Orçamento não encontrado.')
      await this.d.budgets.delete(id)
      await this.d.audit.add({
        id: crypto.randomUUID(),
        entityId: id,
        entityType: 'budget',
        action: 'delete',
        at: new Date().toISOString(),
        before,
      })
    })
  }
}
