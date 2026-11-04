import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { FinanceData } from '@/hooks/use-finances'
import type { CreditRegime } from '@/domain/models'
import { today } from '@/domain/financial-validation'
import { financialReport, reportPeriod } from '@/domain/reports'
import { sumCents } from '@/domain/money'
import './reports.css'

const dateLabel = (value: string) => value.split('-').reverse().join('/')
const fields = [
  { key: 'income', label: 'Receitas', color: '#b7d99f' },
  { key: 'expense', label: 'Consumo', color: '#d6a6a6' },
]
const expenseField = [{ key: 'amountCents', label: 'Consumo líquido', color: '#b7d99f' }]
const tooltipStyle = {
  background: '#1a2218',
  border: '1px solid #45543b',
  borderRadius: 8,
  color: '#e6edde',
}

function ReportChart({
  title,
  description,
  rows,
  series,
  money,
  hidden,
  line = false,
}: {
  title: string
  description?: string
  rows: { name: string; [key: string]: string | number }[]
  series: { key: string; label: string; color: string }[]
  money: (value: number) => string
  hidden: boolean
  line?: boolean
}) {
  const chartRows: typeof rows = rows.map((r) => ({
    ...r,
    time: line ? new Date(`${r.name}T12:00:00`).getTime() : 0,
    name: /^\d{4}-/.test(r.name) ? dateLabel(r.name) : r.name,
  }))
  const axes = (
    <>
      <CartesianGrid stroke="#303a2c" strokeDasharray="3 4" vertical={false} />
      <XAxis
        dataKey={line ? 'time' : 'name'}
        type={line ? 'number' : 'category'}
        scale={line ? 'time' : 'auto'}
        domain={line ? ['dataMin', 'dataMax'] : undefined}
        tickFormatter={
          line
            ? (v) =>
                new Date(Number(v)).toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: '2-digit',
                })
            : undefined
        }
        stroke="#8e9b85"
        fontSize={11}
        minTickGap={15}
      />
      <YAxis
        stroke="#8e9b85"
        width={72}
        fontSize={10}
        tickFormatter={(v: number) => (v / 100).toLocaleString('pt-BR', { notation: 'compact' })}
      />
      <Tooltip
        contentStyle={tooltipStyle}
        labelFormatter={line ? (v) => new Date(Number(v)).toLocaleDateString('pt-BR') : undefined}
        formatter={(v) => money(Number(v))}
      />
      <ReferenceLine y={0} stroke="#617354" />
      <Legend />
    </>
  )
  return (
    <section className="panel report-section">
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {rows.length === 0 ? (
        <p className="report-empty">Sem dados para os filtros selecionados.</p>
      ) : (
        <>
          {hidden ? (
            <p className="report-empty">Valores ocultos.</p>
          ) : (
            <div className="report-chart" aria-label={title}>
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                {line ? (
                  <LineChart data={chartRows}>
                    {axes}
                    {series.map((s) => (
                      <Line
                        key={s.key}
                        dataKey={s.key}
                        name={s.label}
                        stroke={s.color}
                        type="stepAfter"
                        dot={rows.length === 1}
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                ) : (
                  <BarChart data={chartRows}>
                    {axes}
                    {series.map((s) => (
                      <Bar
                        key={s.key}
                        dataKey={s.key}
                        name={s.label}
                        fill={s.color}
                        maxBarSize={42}
                        isAnimationActive={false}
                      />
                    ))}
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          )}
          <details className="report-details">
            <summary>Ver dados em tabela</summary>
            <div className="report-table-scroll">
              <table>
                <caption>{title}</caption>
                <thead>
                  <tr>
                    <th scope="col">{line ? 'Data' : 'Grupo'}</th>
                    {series.map((s) => (
                      <th scope="col" key={s.key}>
                        {s.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {chartRows.map((r, index) => (
                    <tr key={index}>
                      <th scope="row">{r.name}</th>
                      {series.map((s) => (
                        <td key={s.key}>{money(Number(r[s.key]))}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  )
}

export function ReportsPage({
  data,
  money,
  hidden,
}: {
  data: FinanceData
  money: (value: number) => string
  hidden: boolean
}) {
  const asOf = today()
  const [mode, setMode] = useState('month'),
    [month, setMonth] = useState(asOf.slice(0, 7))
  const [from, setFrom] = useState(`${asOf.slice(0, 7)}-01`),
    [to, setTo] = useState<string>(asOf)
  const [accountId, setAccount] = useState(''),
    [cardId, setCard] = useState(''),
    [categoryId, setCategory] = useState('')
  const [regimeOverride, setRegime] = useState<CreditRegime | null>(null)
  const regime = regimeOverride ?? data.settings[0]?.creditRegime ?? 'purchase'
  const result = useMemo(() => {
    try {
      const period = reportPeriod(mode, month, from, to, asOf)
      return {
        report: financialReport(data, { ...period, accountId, cardId, categoryId, regime }, asOf),
        error: '',
        period,
      }
    } catch (e) {
      return {
        report: null,
        error: e instanceof Error ? e.message : 'Confira o período informado.',
        period: null,
      }
    }
  }, [data, mode, month, from, to, asOf, accountId, cardId, categoryId, regime])
  const r = result.report
  return (
    <div className="reports-page">
      <div className="report-filters" role="group" aria-label="Filtros dos relatórios">
        <label>
          Período
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="month">Mês</option>
            <option value="custom">Intervalo personalizado</option>
            <option value="3">Últimos 3 meses</option>
            <option value="6">Últimos 6 meses</option>
            <option value="12">Últimos 12 meses</option>
          </select>
        </label>
        {mode === 'month' ? (
          <label>
            Mês
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </label>
        ) : mode === 'custom' ? (
          <>
            <label>
              De
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label>
              Até
              <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </label>
          </>
        ) : null}
        <label>
          Conta
          <select
            value={accountId}
            onChange={(e) => {
              setAccount(e.target.value)
              if (e.target.value) setCard('')
            }}
          >
            <option value="">Todas as contas</option>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Cartão
          <select
            value={cardId}
            onChange={(e) => {
              setCard(e.target.value)
              if (e.target.value) setAccount('')
            }}
          >
            <option value="">Todos os cartões</option>
            {data.cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nickname || c.name}
                {c.archived ? ' (arquivado)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Categoria
          <select value={categoryId} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Todas as categorias</option>
            {data.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.archived ? ' (arquivada)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Apuração no crédito
          <select value={regime} onChange={(e) => setRegime(e.target.value as CreditRegime)}>
            <option value="purchase">Compra</option>
            <option value="installment">Parcelas</option>
          </select>
        </label>
      </div>
      <p className="report-note">
        Conta seleciona consumo bancário; cartão seleciona consumo no crédito. As duas origens são
        alternativas. Categoria filtra o consumo. Saldos consideram o histórico completo das contas,
        com filtro apenas de conta e período. A apuração desta página não altera sua preferência
        salva.
      </p>
      {result.error && (
        <p className="error-banner" role="alert">
          {result.error}
        </p>
      )}
      {r && result.period && (
        <>
          <p className="report-note">
            Selecionado: {dateLabel(result.period.from)} a {dateLabel(result.period.to)} · Anterior:{' '}
            {dateLabel(r.previousPeriod.from)} a {dateLabel(r.previousPeriod.to)}. Meses completos
            comparam com meses anteriores; demais intervalos usam igual quantidade de dias. Dados
            realizados até {dateLabel(asOf)}.
          </p>
          <div className="report-metrics">
            {(
              [
                { key: 'income', label: 'Receitas' },
                { key: 'expense', label: 'Despesas de consumo' },
                { key: 'net', label: 'Resultado líquido' },
              ] as const
            ).map(({ key, label }) => (
              <div key={key}>
                <span>{label}</span>
                <strong>{money(r.current[key])}</strong>
                <small>
                  Anterior {money(r.previous[key])} · Variação{' '}
                  {money(sumCents([r.current[key], -r.previous[key]]))}
                </small>
              </div>
            ))}
            <div>
              <span>Saldo bancário no fim do período</span>
              <strong>{r.closing === null ? '—' : money(r.closing)}</strong>
              <small>
                Antes do período {r.opening === null ? '—' : money(r.opening)} · Variação{' '}
                {r.balanceChange === null ? '—' : money(r.balanceChange)}
              </small>
            </div>
          </div>
          <div className="report-grid">
            <ReportChart
              title="Receitas e consumo por mês"
              rows={r.monthly}
              series={fields}
              money={money}
              hidden={hidden}
            />
            <ReportChart
              title="Evolução do saldo bancário"
              description="Inclui saldos iniciais, transferências, ajustes e pagamentos de fatura. Sem previsões."
              rows={r.evolution}
              series={[{ key: 'balanceCents', label: 'Saldo bancário', color: '#b7d99f' }]}
              money={money}
              hidden={hidden}
              line
            />
            <ReportChart
              title="Consumo por categoria"
              description="Valores líquidos; estornos podem produzir valores negativos."
              rows={r.categories}
              series={expenseField}
              money={money}
              hidden={hidden}
            />
            <ReportChart
              title="Comparação entre períodos"
              rows={
                r.hasConsumption || r.previous.income !== 0 || r.previous.expense !== 0
                  ? r.comparison
                  : []
              }
              series={fields}
              money={money}
              hidden={hidden}
            />
            <ReportChart
              title="Gastos por conta e cartão"
              description="Compras pertencem ao cartão; pagamentos de fatura não entram novamente no consumo."
              rows={r.sources}
              series={expenseField}
              money={money}
              hidden={hidden}
            />
          </div>
        </>
      )}
    </div>
  )
}
