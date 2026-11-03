import { endOfMonth, format, parseISO } from 'date-fns'
import type { FinanceData } from '@/hooks/use-finances'
import { financialForecast, pendingOccurrences } from '@/domain/planning'
import { today } from '@/domain/financial-validation'
export function RecurringIndicators({
  data,
  money,
}: {
  data: FinanceData
  money: (cents: number) => string
}) {
  const date = today(),
    to = format(endOfMonth(parseISO(date)), 'yyyy-MM-dd')
  const next = pendingOccurrences(data, date, to)
  const forecast = financialForecast(data, date, 1, data.total)[0]
  return (
    <div className="credit-metrics">
      <section className="metric">
        <div className="metric-top">Próximos compromissos recorrentes</div>
        <strong className="metric-value">{next.length}</strong>
        <div className="metric-detail">
          {next[0]
            ? `${next[0].recurring.description} · ${next[0].date.split('-').reverse().join('/')}`
            : 'Nenhuma ocorrência até o fim do mês'}
        </div>
      </section>
      <section className="metric">
        <div className="metric-top">Total previsto de despesas do mês</div>
        <strong className="metric-value">{money(forecast.commitments)}</strong>
        <div className="metric-detail">Pendências e recorrências por vencimento · mês atual</div>
      </section>
      <section className="metric">
        <div className="metric-top">Saldo projetado ao final do mês</div>
        <strong className="metric-value">{money(forecast.projected)}</strong>
        <div className="metric-detail">Saldo de hoje e previsões, incluindo recorrências</div>
      </section>
    </div>
  )
}
