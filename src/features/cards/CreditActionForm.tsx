import { useState } from 'react'
import { useForm } from 'react-hook-form'
import type { FinanceData } from '@/hooks/use-finances'
import type {
  CivilDate,
  CreditCardPurchase,
  InvoicePayment,
  CreditCardInvoice,
  InvoiceEntry,
} from '@/domain/models'
import { formatMoney, formatMoneyInput, parseBRL } from '@/domain/money'
import { invoiceSummary } from '@/domain/credit'
import { today } from '@/domain/financial-validation'
import { repositories } from '@/infrastructure/repositories'
import { Button } from '@/components/ui/button'
import { refundableAmount } from '@/domain/credit-views'
export type CreditAction =
  | { kind: 'refund'; purchase: CreditCardPurchase }
  | { kind: 'cancel'; purchase: CreditCardPurchase }
  | { kind: 'reverse'; payment: InvoicePayment }
  | { kind: 'charge'; invoice: CreditCardInvoice }
  | { kind: 'credit'; invoice: CreditCardInvoice }
  | { kind: 'reverse-charge'; entry: InvoiceEntry }
export function CreditActionForm({
  data,
  action,
  onDone,
}: {
  data: FinanceData
  action: CreditAction
  onDone: () => void
}) {
  const [error, setError] = useState('')
  const defaultAmount =
    action.kind === 'credit'
      ? invoiceSummary(data, action.invoice, today()).credit
      : action.kind === 'refund'
        ? refundableAmount(data, action.purchase)
        : 0
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm({
    defaultValues: {
      amount: formatMoneyInput(defaultAmount),
      date: today(),
      reason: '',
      categoryId: '',
      targetId: '',
    },
  })
  async function submit(v: {
    amount: string
    date: string
    reason: string
    categoryId: string
    targetId: string
  }) {
    setError('')
    try {
      if (action.kind === 'cancel')
        await repositories.credit.cancelPurchase(action.purchase.id, v.reason)
      else if (action.kind === 'refund')
        await repositories.credit.refundPurchase(
          action.purchase.id,
          parseBRL(v.amount),
          v.date as CivilDate,
          v.reason,
        )
      else if (action.kind === 'reverse')
        await repositories.credit.reversePayment(action.payment.id, v.date as CivilDate, v.reason)
      else if (action.kind === 'charge')
        await repositories.credit.addCharge(
          action.invoice.id,
          parseBRL(v.amount),
          v.date as CivilDate,
          v.reason,
          v.categoryId,
        )
      else if (action.kind === 'reverse-charge')
        await repositories.credit.reverseCharge(action.entry.id, v.date as CivilDate, v.reason)
      else await repositories.credit.applyCredit(action.invoice.id, v.targetId, parseBRL(v.amount))
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível concluir.')
    }
  }
  return (
    <form className="account-form" onSubmit={handleSubmit(submit)}>
      {action.kind === 'refund' && (
        <p className="info-banner">
          Estorno de “{action.purchase.description}”. Primeiro serão abatidas as parcelas ainda em
          aberto. O excedente vira crédito de fatura; ele não entra automaticamente na conta
          bancária.
        </p>
      )}
      {action.kind === 'cancel' && (
        <p className="warning-banner">
          Cancelar remove este registro do consumo e dos compromissos, preservando as parcelas e a
          auditoria. Para uma devolução real, use estorno. Esta ação não pode ser desfeita pela
          interface.
        </p>
      )}
      {action.kind === 'reverse' && (
        <p className="warning-banner">
          Será registrada uma devolução de {formatMoney(action.payment.amountCents)} à conta
          original na data informada, reabrindo o saldo da fatura. O pagamento original permanece no
          histórico.
        </p>
      )}
      {action.kind === 'reverse-charge' && (
        <p className="warning-banner">
          O encargo de {formatMoney(action.entry.amountCents)} será compensado por um estorno
          datado. O registro original e a auditoria serão preservados. Não há entrada automática na
          conta bancária.
        </p>
      )}
      {!['cancel', 'reverse', 'reverse-charge'].includes(action.kind) && (
        <label>
          Valor (R$)
          <input autoFocus required inputMode="decimal" {...register('amount')} />
        </label>
      )}
      {action.kind !== 'credit' && action.kind !== 'cancel' && (
        <label>
          Data efetiva
          <input type="date" required max={today()} {...register('date')} />
        </label>
      )}
      {action.kind !== 'credit' && (
        <label>
          Motivo / descrição
          <input
            autoFocus={action.kind === 'cancel' || action.kind === 'reverse'}
            required
            minLength={3}
            maxLength={160}
            {...register('reason')}
          />
        </label>
      )}
      {action.kind === 'charge' && (
        <label>
          Categoria do encargo
          <select required {...register('categoryId')}>
            <option value="">Selecione uma despesa</option>
            {data.categories
              .filter((c) => c.direction === 'expense' && !c.archived)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
      )}
      {action.kind === 'credit' && (
        <>
          <p className="form-hint">
            A aplicação usa crédito existente em outra fatura do mesmo cartão. Não movimenta contas
            bancárias nem altera o consumo.
          </p>
          <label>
            Fatura de destino
            <select required {...register('targetId')}>
              <option value="">Selecione a fatura</option>
              {data.invoices
                .filter(
                  (i) =>
                    i.cardId === action.invoice.cardId &&
                    i.id !== action.invoice.id &&
                    invoiceSummary(data, i, today()).remaining > 0,
                )
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.period} · {formatMoney(invoiceSummary(data, i, today()).remaining)}
                  </option>
                ))}
            </select>
          </label>
        </>
      )}
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <Button
          type="submit"
          variant={
            action.kind === 'cancel' || action.kind === 'reverse' ? 'destructive' : 'default'
          }
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Salvando…' : 'Confirmar operação'}
        </Button>
      </div>
    </form>
  )
}
