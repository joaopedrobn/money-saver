import { useState } from 'react'
import { useForm } from 'react-hook-form'
import type { FinanceData } from '@/hooks/use-finances'
import type { CreditCardInvoice, InvoicePayment, PaymentInput, CivilDate } from '@/domain/models'
import { formatMoney, formatMoneyInput, parseBRL } from '@/domain/money'
import { today } from '@/domain/financial-validation'
import { invoiceSummary } from '@/domain/credit'
import { paymentSchema } from '@/domain/credit-validation'
import { useRepositories } from '@/infrastructure/financial-context'
import { Button } from '@/components/ui/button'
export function PaymentForm({
  data,
  invoice,
  payment,
  onDone,
}: {
  data: FinanceData
  invoice: CreditCardInvoice
  payment?: InvoicePayment
  onDone: () => void
}) {
  const repositories = useRepositories()
  const card = data.cards.find((c) => c.id === invoice.cardId)!,
    summary = invoiceSummary(data, invoice, today())
  const [error, setError] = useState(''),
    [preview, setPreview] = useState<PaymentInput | null>(null),
    [busy, setBusy] = useState(false)
  const { register, handleSubmit } = useForm({
    defaultValues: {
      accountId: payment?.accountId ?? card.accountId,
      amount: formatMoneyInput(payment?.amountCents ?? summary.remaining),
      date: payment?.date ?? today(),
      notes: payment?.notes ?? '',
    },
  })
  async function confirm() {
    if (!preview) return
    setBusy(true)
    setError('')
    try {
      if (payment) await repositories.credit.correctPayment(payment.id, preview)
      else await repositories.credit.pay(preview)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível registrar o pagamento.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="account-form"
      onChange={() => setPreview(null)}
      onSubmit={handleSubmit((v) => {
        setError('')
        try {
          setPreview(
            paymentSchema.parse({
              invoiceId: invoice.id,
              accountId: v.accountId,
              amountCents: parseBRL(v.amount),
              date: v.date as CivilDate,
              notes: v.notes,
            }),
          )
        } catch {
          setError('Informe uma conta, valor positivo e data válida até hoje.')
        }
      })}
    >
      <p>
        Fatura {invoice.period} · saldo pendente {formatMoney(summary.remaining)}
      </p>
      <label>
        Valor pago (R$)
        <input autoFocus required inputMode="decimal" {...register('amount')} />
      </label>
      <label>
        Conta de origem
        <select required {...register('accountId')}>
          {data.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {a.institution}
            </option>
          ))}
        </select>
      </label>
      <label>
        Data efetiva
        <input type="date" required max={today()} {...register('date')} />
      </label>
      <label>
        Observações
        <textarea rows={2} maxLength={2000} {...register('notes')} />
      </label>
      <p className="form-hint">
        Registro manual: nenhuma transferência real será executada. A saída bancária será vinculada
        à fatura e não será outra despesa de consumo.{' '}
        {payment &&
          'A correção modifica o registro histórico; a auditoria preserva os valores anteriores.'}
      </p>
      {preview && (
        <p className="info-banner">
          Confirme a saída de {formatMoney(preview.amountCents)} de{' '}
          {data.accounts.find((a) => a.id === preview.accountId)?.name} em{' '}
          {preview.date.split('-').reverse().join('/')}.
        </p>
      )}
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <Button variant="outline" type="submit" disabled={busy}>
          Revisar {payment ? 'correção' : 'pagamento'}
        </Button>
        {preview && (
          <Button type="button" disabled={busy} onClick={confirm}>
            {busy ? 'Salvando…' : payment ? 'Confirmar correção' : 'Confirmar pagamento'}
          </Button>
        )}
      </div>
    </form>
  )
}
