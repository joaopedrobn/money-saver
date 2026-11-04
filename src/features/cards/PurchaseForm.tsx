import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import type { CreditCardPurchase, PurchaseInput, CivilDate } from '@/domain/models'
import type { FinanceData } from '@/hooks/use-finances'
import { formatMoney, formatMoneyInput, parseBRL } from '@/domain/money'
import { today } from '@/domain/financial-validation'
import { purchaseSchema } from '@/domain/credit-validation'
import { cardSummary, installmentPlan, planFingerprint } from '@/domain/credit'
import { useRepositories } from '@/infrastructure/financial-context'
import { Button } from '@/components/ui/button'
export function PurchaseForm({
  data,
  purchase,
  cardId,
  onDone,
}: {
  data: FinanceData
  purchase?: CreditCardPurchase
  cardId?: string
  onDone: (message: string) => void
}) {
  const repositories = useRepositories()
  const [error, setError] = useState(''),
    [preview, setPreview] = useState<{
      input: PurchaseInput
      parts: ReturnType<typeof installmentPlan>
    } | null>(null),
    [busy, setBusy] = useState(false)
  const locked =
    !!purchase &&
    (data.payments.some((p) =>
      data.installments.some((i) => i.purchaseId === purchase.id && i.invoiceId === p.invoiceId),
    ) ||
      data.invoiceEntries.some((e) => e.purchaseId === purchase.id))
  const { register, handleSubmit } = useForm({
    defaultValues: {
      cardId: purchase?.cardId ?? cardId ?? data.cards.find((c) => !c.archived)?.id ?? '',
      categoryId: purchase?.categoryId ?? '',
      description: purchase?.description ?? '',
      amount: purchase ? formatMoneyInput(purchase.amountCents) : '',
      fee: formatMoneyInput(purchase?.feeCents ?? 0),
      date: purchase?.date ?? today(),
      installmentCount: purchase?.installmentCount ?? 1,
      notes: purchase?.notes ?? '',
    },
  })
  function review(values: {
    cardId: string
    categoryId: string
    description: string
    amount: string
    fee: string
    date: string
    installmentCount: number
    notes: string
  }) {
    setError('')
    try {
      const { amount, fee, ...rest } = values
      const input = purchaseSchema.parse({
          ...rest,
          date: rest.date as CivilDate,
          amountCents: parseBRL(amount),
          feeCents: parseBRL(fee),
        }),
        card = data.cards.find((c) => c.id === input.cardId)
      if (!card) throw new Error('Selecione um cartão.')
      const same =
        purchase &&
        (
          ['cardId', 'categoryId', 'amountCents', 'feeCents', 'date', 'installmentCount'] as const
        ).every((k) => (purchase[k] ?? 0) === (input[k] ?? 0))
      const parts = same
        ? data.installments
            .filter((i) => i.purchaseId === purchase.id)
            .sort((a, b) => a.number - b.number)
            .map((i) => ({
              number: i.number,
              amountCents: i.amountCents,
              principalCents: i.principalCents ?? i.amountCents,
              cycle: data.invoices.find((inv) => inv.id === i.invoiceId)!,
            }))
        : installmentPlan(card, input, data.invoices)
      setPreview({ input, parts })
    } catch (e) {
      setError(
        e instanceof z.ZodError
          ? e.issues.map((i) => i.message).join(' ')
          : e instanceof Error
            ? e.message
            : 'Dados inválidos.',
      )
    }
  }
  async function confirm() {
    if (!preview) return
    setBusy(true)
    setError('')
    try {
      if (purchase)
        await repositories.credit.updatePurchase(
          purchase.id,
          preview.input,
          planFingerprint(preview.parts),
        )
      else await repositories.credit.createPurchase(preview.input, planFingerprint(preview.parts))
      onDone(
        purchase
          ? 'Compra atualizada. Histórico e faturas preservados.'
          : 'Compra registrada. Parcelas e limite atualizados; saldo bancário preservado.',
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar.')
    } finally {
      setBusy(false)
    }
  }
  const currentCard = preview && data.cards.find((c) => c.id === preview.input.cardId)
  return (
    <form
      className="account-form"
      onChange={() => setPreview(null)}
      onSubmit={handleSubmit(review)}
    >
      <label>
        Descrição da compra
        <input autoFocus required minLength={2} maxLength={160} {...register('description')} />
      </label>
      {locked && (
        <p className="info-banner">
          Há histórico de liquidação ou estorno. Somente descrição e observações podem ser
          alteradas. Para devolver valores, use “Estornar compra”.
        </p>
      )}
      <fieldset disabled={locked || busy} className="credit-fields">
        <label>
          Cartão
          <select required {...register('cardId')}>
            <option value="">Selecione um cartão</option>
            {data.cards
              .filter((c) => !c.archived || c.id === purchase?.cardId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.lastFour ? ` · final ${c.lastFour}` : ''}
                  {c.archived ? ' (arquivado)' : ''}
                </option>
              ))}
          </select>
        </label>
        <div className="form-row">
          <label>
            Valor original (R$)
            <input required inputMode="decimal" placeholder="0,00" {...register('amount')} />
          </label>
          <label>
            Juros / acréscimo total (R$)
            <input required inputMode="decimal" {...register('fee')} />
          </label>
        </div>
        <div className="form-row">
          <label>
            Data da compra
            <input required type="date" max={today()} {...register('date')} />
          </label>
          <label>
            Quantidade de parcelas
            <input
              type="number"
              required
              min={1}
              max={360}
              {...register('installmentCount', { valueAsNumber: true })}
            />
          </label>
        </div>
        <label>
          Categoria de despesa
          <select required {...register('categoryId')}>
            <option value="">Selecione uma categoria</option>
            {data.categories
              .filter(
                (c) => c.direction === 'expense' && (!c.archived || c.id === purchase?.categoryId),
              )
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.archived ? ' (arquivada)' : ''}
                </option>
              ))}
          </select>
        </label>
      </fieldset>
      <label>
        Observações
        <textarea rows={2} maxLength={2000} {...register('notes')} />
      </label>
      <p className="form-hint">
        Compra no fechamento entra no próximo ciclo. A compra compromete todo o valor financiado e
        não debita a conta bancária.
      </p>
      {preview && (
        <section className="installment-preview">
          <h3>
            Prévia · total financiado{' '}
            {formatMoney(preview.input.amountCents + preview.input.feeCents)}
          </h3>
          {currentCard &&
            cardSummary(data, currentCard, today()).available +
              (purchase?.cardId === currentCard.id
                ? purchase.amountCents + (purchase.feeCents ?? 0)
                : 0) <
              preview.input.amountCents + preview.input.feeCents && (
              <p className="warning-banner">
                Esta compra ultrapassa o limite disponível. O registro excepcional é permitido para
                representar uma compra que ocorreu.
              </p>
            )}
          <div className="table-scroll">
            <table className="movement-table">
              <thead>
                <tr>
                  <th>Parcela</th>
                  <th>Competência</th>
                  <th>Fechamento</th>
                  <th>Vencimento</th>
                  <th>Valor</th>
                </tr>
              </thead>
              <tbody>
                {preview.parts.map((p) => (
                  <tr key={p.number}>
                    <td>
                      {p.number}/{preview.parts.length}
                    </td>
                    <td>{p.cycle.period}</td>
                    <td>{p.cycle.closingDate.split('-').reverse().join('/')}</td>
                    <td>{p.cycle.dueDate.split('-').reverse().join('/')}</td>
                    <td>{formatMoney(p.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <Button variant="outline" type="submit" disabled={busy || !data.cards.length}>
          Revisar parcelas
        </Button>
        {preview && (
          <Button type="button" onClick={confirm} disabled={busy}>
            {busy ? 'Salvando…' : 'Confirmar compra'}
          </Button>
        )}
      </div>
    </form>
  )
}
