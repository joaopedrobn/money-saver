import type { CreditRepository, SettingsRepository } from '@/domain/repositories'
import type {
  CardInput,
  PurchaseInput,
  PaymentInput,
  CivilDate,
  Entity,
  AuditEvent,
  CreditRegime,
  InvoiceEntry,
  CreditCardPurchase,
} from '@/domain/models'
import { cardSchema, paymentSchema, purchaseSchema } from '@/domain/credit-validation'
import { centsSchema, civilDateSchema, today } from '@/domain/financial-validation'
import { installmentPlan, invoiceSummary, planFingerprint } from '@/domain/credit'
import { assertCreditIntegrity } from '@/domain/credit-integrity'
import { sumCents } from '@/domain/money'
import { readSnapshot } from './movement-repository'
import type { FinancialDatabase } from './database'
let creditClock = 0
const syncClock = (instant?: string) => {
  if (instant) creditClock = Math.max(creditClock, Date.parse(instant) || 0)
}
// Logical millisecond ordering avoids ambiguous same-day payment/refund events on coarse clocks.
const nextInstant = () => {
  creditClock = Math.max(Date.now(), creditClock + 1)
  return new Date(creditClock).toISOString()
}
const entity = () => {
  const now = nextInstant()
  return { id: crypto.randomUUID(), createdAt: now, updatedAt: now }
}
export class DexieCreditRepository implements CreditRepository {
  constructor(private readonly d: FinancialDatabase) {}
  private atomic<T>(fn: () => Promise<T>) {
    return this.d.transaction('rw', this.d.tables, async () => {
      syncClock((await this.d.audit.orderBy('at').last())?.at)
      return fn()
    })
  }
  private async audit(
    entityType: AuditEvent['entityType'],
    before: Entity | undefined,
    after: Entity | undefined,
  ) {
    await this.d.audit.add({
      id: crypto.randomUUID(),
      entityId: (after ?? before)!.id,
      entityType,
      action: before ? 'update' : 'create',
      at: nextInstant(),
      before,
      after,
    })
  }
  private async verify() {
    assertCreditIntegrity(await readSnapshot(this.d))
  }
  private async saveCard(input: CardInput, id?: string) {
    const value = cardSchema.parse(input)
    return this.atomic(async () => {
      const before = id ? await this.d.cards.get(id) : undefined
      if (id && !before) throw new Error('Cartão não encontrado.')
      if (!(await this.d.accounts.get(value.accountId)))
        throw new Error('Conta padrão não encontrada.')
      const after = {
        ...entity(),
        ...before,
        ...value,
        archived: before?.archived ?? false,
        updatedAt: nextInstant(),
      }
      await this.d.cards.put(after)
      await this.verify()
      await this.audit('card', before, after)
      return after
    })
  }
  createCard(input: CardInput) {
    return this.saveCard(input)
  }
  updateCard(id: string, input: CardInput) {
    return this.saveCard(input, id)
  }
  async archiveCard(id: string, archived: boolean) {
    await this.atomic(async () => {
      const before = await this.d.cards.get(id)
      if (!before) throw new Error('Cartão não encontrado.')
      const after = { ...before, archived, updatedAt: nextInstant() }
      await this.d.cards.put(after)
      await this.audit('card', before, after)
    })
  }
  private async protectedPurchase(id: string) {
    const parts = await this.d.installments.where('purchaseId').equals(id).toArray()
    const invoices = new Set(parts.map((p) => p.invoiceId))
    return (
      (await this.d.payments.toArray()).some((p) => invoices.has(p.invoiceId)) ||
      (await this.d.invoiceEntries.where('purchaseId').equals(id).count()) > 0
    )
  }
  private async savePurchase(input: PurchaseInput, id?: string, expectedPlan?: string) {
    const value = purchaseSchema.parse(input)
    return this.atomic(async () => {
      const before = id ? await this.d.purchases.get(id) : undefined
      if (id && !before) throw new Error('Compra não encontrada.')
      if (before?.status === 'cancelled')
        throw new Error('Uma compra cancelada não pode ser alterada.')
      const card = await this.d.cards.get(value.cardId)
      if (!card) throw new Error('Cartão não encontrado.')
      const financialChange =
        !before ||
        (
          ['cardId', 'categoryId', 'amountCents', 'date', 'installmentCount', 'feeCents'] as const
        ).some((k) => (before[k] ?? 0) !== (value[k] ?? 0))
      if (card.archived && (!before || financialChange))
        throw new Error('Cartão arquivado: novas compras não são permitidas.')
      if (before && financialChange && (await this.protectedPurchase(before.id)))
        throw new Error(
          'Compra com histórico de liquidação ou estorno: preserve as parcelas e use o fluxo explícito de estorno. Descrição e observações podem ser corrigidas.',
        )
      const category = await this.d.categories.get(value.categoryId)
      if (
        !category ||
        category.direction !== 'expense' ||
        (category.archived && before?.categoryId !== category.id)
      )
        throw new Error('Escolha uma categoria de despesa ativa.')
      const after: CreditCardPurchase = {
        ...entity(),
        ...before,
        ...value,
        status: 'active',
        updatedAt: nextInstant(),
      }
      const oldParts = before
        ? await this.d.installments.where('purchaseId').equals(before.id).toArray()
        : []
      const invoices = await this.d.invoices.where('cardId').equals(card.id).toArray()
      const plan = financialChange
        ? installmentPlan(card, value, invoices)
        : oldParts
            .sort((a, b) => a.number - b.number)
            .map((part) => ({
              number: part.number,
              amountCents: part.amountCents,
              principalCents: part.principalCents ?? part.amountCents,
              cycle: invoices.find((i) => i.id === part.invoiceId)!,
            }))
      if (expectedPlan !== undefined && expectedPlan !== planFingerprint(plan))
        throw new Error(
          'O cartão ou as faturas mudaram desde a prévia. Revise as parcelas novamente antes de confirmar.',
        )
      await this.d.purchases.put(after)
      if (financialChange) {
        if (before) await this.d.installments.where('purchaseId').equals(before.id).delete()
        for (const part of plan) {
          let inv = invoices.find((i) => i.period === part.cycle.period)
          if (!inv) {
            inv = { ...entity(), ...part.cycle, cardId: card.id }
            await this.d.invoices.add(inv)
            invoices.push(inv)
          }
          await this.d.installments.add({
            ...entity(),
            purchaseId: after.id,
            invoiceId: inv.id,
            number: part.number,
            amountCents: part.amountCents,
            principalCents: part.principalCents,
          })
        }
      }
      await this.verify()
      const parts = await this.d.installments.where('purchaseId').equals(after.id).toArray()
      await this.audit(
        'purchase',
        before ? Object.assign({}, before, { installments: oldParts }) : undefined,
        Object.assign({}, after, { installments: parts }),
      )
      return after
    })
  }
  createPurchase(input: PurchaseInput, expectedPlan?: string) {
    return this.savePurchase(input, undefined, expectedPlan)
  }
  updatePurchase(id: string, input: PurchaseInput, expectedPlan?: string) {
    return this.savePurchase(input, id, expectedPlan)
  }
  async cancelPurchase(id: string, reason: string) {
    if (reason.trim().length < 3 || reason.length > 160)
      throw new Error('Informe o motivo do cancelamento (3 a 160 caracteres).')
    await this.atomic(async () => {
      const before = await this.d.purchases.get(id)
      if (!before || before.status === 'cancelled')
        throw new Error('Compra inexistente ou já cancelada.')
      if (await this.protectedPurchase(id))
        throw new Error(
          'Esta compra possui liquidações ou estornos. Use o fluxo de estorno para preservar o histórico.',
        )
      const after = {
        ...before,
        status: 'cancelled' as const,
        cancellationReason: reason.trim(),
        updatedAt: nextInstant(),
      }
      await this.d.purchases.put(after)
      await this.verify()
      await this.audit('purchase', before, after)
    })
  }
  private validateDate(date: CivilDate) {
    civilDateSchema.parse(date)
    if (date > today()) throw new Error('A data efetiva não pode estar no futuro.')
  }
  async refundPurchase(id: string, amountCents: number, date: CivilDate, reason: string) {
    centsSchema.parse(amountCents)
    this.validateDate(date)
    if (reason.trim().length < 3 || reason.length > 160)
      throw new Error('Informe o motivo do estorno (3 a 160 caracteres).')
    await this.atomic(async () => {
      const purchase = await this.d.purchases.get(id)
      if (!purchase || purchase.status === 'cancelled')
        throw new Error('Compra não encontrada ou cancelada.')
      if (date < purchase.date) throw new Error('O estorno não pode anteceder a compra.')
      const s = await readSnapshot(this.d)
      const refunded = sumCents(
        s.invoiceEntries
          .filter((e) => e.purchaseId === id && e.kind === 'refund')
          .map((e) => e.amountCents),
      )
      if (amountCents > purchase.amountCents + (purchase.feeCents ?? 0) - refunded)
        throw new Error('O estorno excede o valor ainda não estornado da compra.')
      const card = s.cards.find((c) => c.id === purchase.cardId)!
      let remainder = amountCents
      const affected = new Set(
        s.installments.filter((i) => i.purchaseId === id).map((i) => i.invoiceId),
      )
      const invoices = s.invoices
        .filter((i) => affected.has(i.id))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      for (const inv of invoices) {
        if (!remainder) break
        const summary = invoiceSummary(s, inv, today()),
          part = s.installments.find((i) => i.purchaseId === id && i.invoiceId === inv.id)!
        const prior = sumCents(
          s.invoiceEntries
            .filter((e) => e.kind === 'refund' && e.purchaseId === id && e.invoiceId === inv.id)
            .map((e) => e.amountCents),
        )
        const portion = Math.min(
          remainder,
          summary.remaining,
          Math.max(part.amountCents - prior, 0),
        )
        if (portion) {
          const entry: InvoiceEntry = {
            ...entity(),
            invoiceId: inv.id,
            kind: 'refund',
            purchaseId: id,
            categoryId: purchase.categoryId,
            amountCents: portion,
            date,
            description: reason.trim(),
          }
          await this.d.invoiceEntries.add(entry)
          await this.audit('invoice-entry', undefined, entry)
          s.invoiceEntries.push(entry)
          remainder -= portion
        }
      }
      if (remainder) {
        const cycle = installmentPlan(
          card,
          { date, amountCents: 1, feeCents: 0, installmentCount: 1 },
          s.invoices,
        )[0].cycle
        let invoice = s.invoices.find((i) => i.cardId === card.id && i.period === cycle.period)
        if (!invoice) {
          invoice = { ...entity(), ...cycle, cardId: card.id }
          await this.d.invoices.add(invoice)
        }
        const entry: InvoiceEntry = {
          ...entity(),
          invoiceId: invoice.id,
          kind: 'refund',
          purchaseId: id,
          categoryId: purchase.categoryId,
          amountCents: remainder,
          date,
          description: reason.trim(),
        }
        await this.d.invoiceEntries.add(entry)
        await this.audit('invoice-entry', undefined, entry)
      }
      await this.verify()
    })
  }
  private async savePayment(input: PaymentInput, id?: string) {
    const value = paymentSchema.parse(input)
    return this.atomic(async () => {
      const before = id ? await this.d.payments.get(id) : undefined
      if (id && (!before || before.reversalDate))
        throw new Error('Pagamento inexistente ou já estornado.')
      if (before && before.invoiceId !== value.invoiceId)
        throw new Error('A correção deve permanecer na mesma fatura.')
      const account = await this.d.accounts.get(value.accountId)
      if (!account || value.date < account.openingDate)
        throw new Error('Conta inexistente ou pagamento anterior ao saldo inicial.')
      const s = await readSnapshot(this.d),
        invoice = s.invoices.find((i) => i.id === value.invoiceId)
      if (!invoice) throw new Error('Fatura não encontrada.')
      const without = { ...s, payments: s.payments.filter((p) => p.id !== id) }
      const available = invoiceSummary(without, invoice, value.date).remaining
      if (value.amountCents > available)
        throw new Error(
          'O pagamento excede o saldo da fatura nesta data. Antecipações são permitidas apenas até a dívida registrada.',
        )
      const after = { ...entity(), ...before, ...value, updatedAt: nextInstant() }
      await this.d.payments.put(after)
      await this.verify()
      await this.audit('payment', before, after)
      return after
    })
  }
  pay(input: PaymentInput) {
    return this.savePayment(input)
  }
  correctPayment(id: string, input: PaymentInput) {
    return this.savePayment(input, id)
  }
  async reversePayment(id: string, date: CivilDate, reason: string) {
    this.validateDate(date)
    if (reason.trim().length < 3 || reason.length > 160)
      throw new Error('Informe o motivo do estorno (3 a 160 caracteres).')
    await this.atomic(async () => {
      const before = await this.d.payments.get(id)
      if (!before || before.reversalDate) throw new Error('Pagamento inexistente ou já estornado.')
      if (date < before.date) throw new Error('O estorno não pode anteceder o pagamento.')
      const after = {
        ...before,
        reversalDate: date,
        reversalReason: reason.trim(),
        reversedAt: nextInstant(),
        updatedAt: nextInstant(),
      }
      await this.d.payments.put(after)
      await this.verify()
      await this.audit('payment', before, after)
    })
  }
  async addCharge(
    invoiceId: string,
    amountCents: number,
    date: CivilDate,
    description: string,
    categoryId: string,
  ) {
    centsSchema.parse(amountCents)
    this.validateDate(date)
    if (description.trim().length < 3 || description.length > 160)
      throw new Error('Descreva o encargo (3 a 160 caracteres).')
    return this.atomic(async () => {
      const c = await this.d.categories.get(categoryId)
      if (!c || c.direction !== 'expense' || c.archived || !(await this.d.invoices.get(invoiceId)))
        throw new Error('Fatura ou categoria de despesa inválida.')
      const entry: InvoiceEntry = {
        ...entity(),
        invoiceId,
        amountCents,
        date,
        description: description.trim(),
        categoryId,
        kind: 'charge',
      }
      await this.d.invoiceEntries.add(entry)
      await this.verify()
      await this.audit('invoice-entry', undefined, entry)
      return entry
    })
  }
  async applyCredit(sourceInvoiceId: string, targetInvoiceId: string, amountCents: number) {
    centsSchema.parse(amountCents)
    await this.atomic(async () => {
      const s = await readSnapshot(this.d),
        source = s.invoices.find((i) => i.id === sourceInvoiceId),
        target = s.invoices.find((i) => i.id === targetInvoiceId)
      if (!source || !target || source.cardId !== target.cardId || source.id === target.id)
        throw new Error('Selecione faturas diferentes do mesmo cartão.')
      if (
        amountCents > invoiceSummary(s, source, today()).credit ||
        amountCents > invoiceSummary(s, target, today()).remaining
      )
        throw new Error('Valor superior ao crédito disponível ou ao saldo da fatura de destino.')
      const transferId = crypto.randomUUID()
      for (const [invoice, kind] of [
        [source, 'credit-out'],
        [target, 'credit-in'],
      ] as const) {
        const entry: InvoiceEntry = {
          ...entity(),
          invoiceId: invoice.id,
          kind,
          amountCents,
          date: today(),
          description: 'Aplicação explícita de crédito entre faturas',
          transferId,
        }
        await this.d.invoiceEntries.add(entry)
        await this.audit('invoice-entry', undefined, entry)
      }
      await this.verify()
    })
  }
  async reverseCharge(id: string, date: CivilDate, reason: string) {
    this.validateDate(date)
    if (reason.trim().length < 3 || reason.length > 160)
      throw new Error('Informe o motivo do estorno (3 a 160 caracteres).')
    await this.atomic(async () => {
      const original = await this.d.invoiceEntries.get(id)
      if (!original || original.kind !== 'charge' || date < original.date)
        throw new Error('Encargo ou data de estorno inválidos.')
      if ((await this.d.invoiceEntries.toArray()).some((e) => e.originalEntryId === id))
        throw new Error('Este encargo já foi estornado.')
      const entry: InvoiceEntry = {
        ...entity(),
        invoiceId: original.invoiceId,
        kind: 'charge-reversal',
        originalEntryId: id,
        categoryId: original.categoryId,
        amountCents: original.amountCents,
        date,
        description: reason.trim(),
      }
      await this.d.invoiceEntries.add(entry)
      await this.verify()
      await this.audit('invoice-entry', undefined, entry)
    })
  }
}
export class DexieSettingsRepository implements SettingsRepository {
  constructor(private readonly d: FinancialDatabase) {}
  list() {
    return this.d.settings.toArray()
  }
  get(id: string) {
    return this.d.settings.get(id)
  }
  async setCreditRegime(creditRegime: CreditRegime) {
    if (!['purchase', 'installment'].includes(creditRegime)) throw new Error('Regime inválido.')
    await this.d.transaction('rw', [this.d.settings, this.d.audit], async () => {
      const before = (await this.list())[0],
        after = {
          ...entity(),
          ...before,
          currency: 'BRL' as const,
          locale: 'pt-BR' as const,
          theme: 'dark' as const,
          weekStartsOn: before?.weekStartsOn ?? (1 as const),
          creditRegime,
          updatedAt: nextInstant(),
        }
      await this.d.settings.put(after)
      await this.d.audit.add({
        id: crypto.randomUUID(),
        entityId: after.id,
        entityType: 'settings',
        action: before ? 'update' : 'create',
        at: after.updatedAt,
        before,
        after,
      })
    })
  }
}
