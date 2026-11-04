import { useState } from 'react'
import { endOfMonth, format, startOfMonth } from 'date-fns'
import type { FinanceData } from '@/hooks/use-finances'
import type { CreditRegime } from '@/domain/models'
import { cardSummary, creditPlanning, invoiceSummary, purchaseActive } from '@/domain/credit'
import { sumCents } from '@/domain/money'
import { today } from '@/domain/financial-validation'
import { useRepositories } from '@/infrastructure/financial-context'
export function CreditDashboardPanel({
  data,
  money,
  month,
}: {
  data: FinanceData
  money: (cents: number) => string
  month: Date
}) {
  const repositories = useRepositories()
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    plan = creditPlanning(data, month, today(), data.total),
    from = format(startOfMonth(month), 'yyyy-MM-dd'),
    to = format(endOfMonth(month), 'yyyy-MM-dd')
  const summaries = data.cards.map((c) => cardSummary(data, c, today())),
    open = data.invoices
      .map((i) => invoiceSummary(data, i, today()))
      .filter((i) => i.remaining > 0)
      .sort((a, b) => a.invoice.dueDate.localeCompare(b.invoice.dueDate)),
    used = sumCents(summaries.map((c) => c.used)),
    purchases = sumCents(
      data.purchases
        .filter((p) => purchaseActive(p) && p.date >= from && p.date <= to)
        .map((p) => p.amountCents + (p.feeCents ?? 0)),
    ),
    future = data.installments.filter(
      (i) =>
        data.invoices.some((inv) => inv.id === i.invoiceId && inv.dueDate > today()) &&
        data.purchases.some((p) => p.id === i.purchaseId && purchaseActive(p)),
    )
  return (
    <section className="panel credit-section dashboard-credit">
      <div className="panel-header">
        <div>
          <h2>Crédito e compromissos</h2>
          <p>Dinheiro em conta, consumo e desembolsos previstos têm papéis diferentes.</p>
        </div>
        <a className="text-link" href="#cards">
          Gerenciar cartões
        </a>
      </div>
      <div className="credit-metrics">
        {[
          ['Faturas em aberto', sumCents(open.map((i) => i.remaining))],
          ['Limite comprometido', used],
          ['Compras brutas no mês', purchases],
          ['Compromissos do mês', plan.commitments],
          ['Saldo projetado após pendências', plan.projected],
        ].map(([label, value]) => (
          <div className="metric" key={label as string}>
            <div className="metric-top">{label}</div>
            <strong className="metric-value">
              {plan.historical && label === 'Saldo projetado após pendências'
                ? '—'
                : money(value as number)}
            </strong>
          </div>
        ))}
      </div>
      <div className="credit-report-controls">
        <label>
          Apuração do consumo no crédito
          <select
            disabled={busy}
            value={data.settings[0]?.creditRegime ?? 'purchase'}
            onChange={async (e) => {
              setError('')
              setBusy(true)
              try {
                await repositories.settings.setCreditRegime(e.target.value as CreditRegime)
              } catch {
                setError('Não foi possível salvar o regime de apuração.')
              } finally {
                setBusy(false)
              }
            }}
          >
            <option value="purchase">Compra: total financiado na data da compra</option>
            <option value="installment">Parcelas: competência da fatura (mês de fechamento)</option>
          </select>
        </label>
        <p>
          {future.length} parcelas futuras registradas. Seus valores já compõem as faturas; não são
          somados novamente nos compromissos. A projeção inclui pendências vencidas até o fim do mês
          e exclui valores já pagos. Compras brutas incluem acréscimos.
        </p>
      </div>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {open.length > 0 && (
        <div className="credit-next-dates">
          {open.slice(0, 3).map((v) => (
            <div key={v.invoice.id}>
              <span>
                {data.cards.find((c) => c.id === v.invoice.cardId)?.name} ·{' '}
                {v.invoice.dueDate.split('-').reverse().join('/')}
              </span>
              <strong>{money(v.remaining)}</strong>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
