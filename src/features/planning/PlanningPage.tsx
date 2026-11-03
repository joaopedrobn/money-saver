import { useState } from 'react'
import { addMonths, format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { FinanceData } from '@/hooks/use-finances'
import { creditPlanning } from '@/domain/credit'
import { today } from '@/domain/financial-validation'
import { MovementsPage } from '@/features/movements/MovementsPage'
import { Button } from '@/components/ui/button'
import { PlanningTools } from './PlanningTools'
export function PlanningPage({
  data,
  money,
  notify,
}: {
  data: FinanceData
  money: (cents: number) => string
  notify: (message: string) => void
}) {
  const [month, setMonth] = useState(new Date()),
    plan = creditPlanning(data, month, today(), data.total)
  return (
    <>
      <div className="overview-toolbar">
        <span>Pendências registradas · recorrências incluídas na projeção abaixo</span>
        <div className="month-picker">
          <button
            aria-label="Mês anterior do planejamento"
            onClick={() => setMonth(addMonths(month, -1))}
          >
            <ChevronLeft size={16} />
          </button>
          <span>{format(month, 'MMMM yyyy', { locale: ptBR })}</span>
          <button
            aria-label="Próximo mês do planejamento"
            onClick={() => setMonth(addMonths(month, 1))}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="credit-metrics">
        {[
          ['Dinheiro em conta hoje', data.total],
          ['Receitas previstas no mês', plan.income],
          ['Despesas bancárias previstas', plan.bankExpense],
          ['Faturas pendentes no mês', plan.invoiceExpense],
          ['Compromissos do mês', plan.commitments],
          ['Saldo projetado até fim do mês', plan.projected],
        ].map(([label, value]) => (
          <section key={label as string} className="metric">
            <div className="metric-top">{label}</div>
            <strong className="metric-value">
              {plan.historical && label === 'Saldo projetado até fim do mês'
                ? '—'
                : money(value as number)}
            </strong>
          </section>
        ))}
      </div>
      <p className="info-banner">
        {plan.historical
          ? 'Mês anterior: os registros permanecem consultáveis, mas não projetamos o saldo de hoje para o passado.'
          : 'A projeção parte do saldo atual e inclui receitas, despesas e faturas ainda pendentes até o fim do mês, inclusive vencidas. Transferências próprias são neutras; parcelas já incluídas nas faturas não são somadas novamente.'}{' '}
        Créditos de fatura não são dinheiro em conta; aplique-os explicitamente em Cartões para
        abater outras faturas.
      </p>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Faturas com vencimento no mês</h2>
            <p>Saldo residual após pagamentos e estornos; sem repetir valores liquidados.</p>
          </div>
          <Button asChild variant="outline">
            <a href="#cards">Consultar cartões</a>
          </Button>
        </div>
        {plan.monthInvoices.length ? (
          <div className="table-scroll">
            <table className="movement-table">
              <thead>
                <tr>
                  <th>Cartão</th>
                  <th>Competência</th>
                  <th>Vencimento</th>
                  <th>Saldo pendente</th>
                </tr>
              </thead>
              <tbody>
                {plan.monthInvoices.map((v) => (
                  <tr key={v.invoice.id}>
                    <td>{data.cards.find((c) => c.id === v.invoice.cardId)?.name}</td>
                    <td>{v.invoice.period}</td>
                    <td>{v.invoice.dueDate.split('-').reverse().join('/')}</td>
                    <td>{money(v.remaining)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="credit-empty">Nenhuma fatura pendente com vencimento neste mês.</p>
        )}
      </section>
      <section className="panel credit-section">
        <div className="panel-header">
          <div>
            <h2>Parcelas nas faturas do mês</h2>
            <p>
              Apenas detalhamento de competência; estes valores já estão nas faturas acima e não são
              somados novamente.
            </p>
          </div>
        </div>
        {plan.monthInstallments.length ? (
          <div className="table-scroll">
            <table className="movement-table">
              <thead>
                <tr>
                  <th>Compra</th>
                  <th>Parcela</th>
                  <th>Competência</th>
                  <th>Valor original</th>
                </tr>
              </thead>
              <tbody>
                {plan.monthInstallments.map((i) => (
                  <tr key={i.id}>
                    <td>{data.purchases.find((p) => p.id === i.purchaseId)?.description}</td>
                    <td>
                      {i.number}/
                      {data.purchases.find((p) => p.id === i.purchaseId)?.installmentCount}
                    </td>
                    <td>{data.invoices.find((inv) => inv.id === i.invoiceId)?.period}</td>
                    <td>{money(i.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="credit-empty">Nenhuma parcela em fatura pendente neste mês.</p>
        )}
      </section>
      <PlanningTools data={data} month={month} money={money} notify={notify} />
      <MovementsPage
        key={format(month, 'yyyy-MM')}
        data={data}
        money={money}
        notify={notify}
        plannedOnly
        period={{ from: plan.from, to: plan.to }}
      />
    </>
  )
}
