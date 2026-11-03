import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Wallet,
  ChartNoAxesCombined,
  ChevronLeft,
  ChevronRight,
  Landmark,
  Plus,
  CalendarDays,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { addMonths, format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { FinanceData } from '@/hooks/use-finances'
import { compareMovements, monthlySummary } from '@/domain/finance'
import { today } from '@/domain/financial-validation'
import { Button } from '@/components/ui/button'
import { CreditDashboardPanel } from './CreditDashboardPanel'
import { sumCents } from '@/domain/money'
import { RecurringIndicators } from './RecurringIndicators'
export function DashboardPage({
  data,
  money,
  hidden,
  month,
  setMonth,
  onNewAccount,
  onMovements,
  onAccounts,
  onPlanning,
}: {
  data: FinanceData
  money: (cents: number) => string
  hidden: boolean
  month: Date
  setMonth: (date: Date) => void
  onNewAccount: () => void
  onMovements: () => void
  onAccounts: () => void
  onPlanning: () => void
}) {
  const summary = monthlySummary(
      data,
      month,
      today(),
      data.settings[0]?.creditRegime ?? 'purchase',
    ),
    latest = data.movements
      .filter((m) => m.status === 'settled')
      .sort((a, b) => -compareMovements(a, b))
      .slice(0, 5),
    scheduled = data.movements
      .filter((m) => ['planned', 'pending'].includes(m.status))
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
      .slice(0, 5)
  const metrics = [
    {
      icon: Wallet,
      label: 'Saldo total atual',
      value: data.total,
      detail: `${data.accounts.length} contas cadastradas`,
      accent: true,
    },
    {
      icon: ArrowDownLeft,
      label: 'Receitas realizadas',
      value: summary.income,
      detail: 'No mês selecionado',
      color: 'green',
    },
    {
      icon: ArrowUpRight,
      label: 'Consumo líquido do mês',
      value: summary.expense,
      detail: 'Conforme apuração selecionada',
      color: 'rose',
    },
    {
      icon: ChartNoAxesCombined,
      label: 'Receitas menos consumo',
      value: summary.net,
      detail: 'Receitas menos despesas',
      color: 'amber',
    },
  ]
  return (
    <>
      <div className="overview-toolbar">
        <div>
          <span className="section-dot" />
          Visão do mês <span className="muted">/</span>
          <span className="muted">Seu resumo financeiro</span>
        </div>
        <div className="month-picker">
          <button aria-label="Mês anterior" onClick={() => setMonth(addMonths(month, -1))}>
            <ChevronLeft size={15} />
          </button>
          <span>{format(month, 'MMMM yyyy', { locale: ptBR })}</span>
          <button aria-label="Próximo mês" onClick={() => setMonth(addMonths(month, 1))}>
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
      <div className="stats-grid">
        {metrics.map(({ icon: Icon, ...m }) => (
          <section key={m.label} className={`metric ${m.accent ? 'metric-accent' : ''}`}>
            <div className="metric-top">
              <span>{m.label}</span>
              <span className={`metric-icon ${m.color ?? ''}`}>
                <Icon size={17} />
              </span>
            </div>
            <strong className={`metric-value ${m.value < 0 ? 'expense-text' : ''}`}>
              {money(m.value)}
            </strong>
            <div className="metric-detail">{m.detail}</div>
          </section>
        ))}
      </div>
      <CreditDashboardPanel data={data} money={money} month={month} />
      <RecurringIndicators data={data} money={money} />
      {!data.accounts.length && (
        <section className="welcome-banner">
          <div className="welcome-art">
            <Landmark size={28} />
          </div>
          <div className="welcome-copy">
            <span className="tiny-label">SEU PRIMEIRO PASSO</span>
            <h2>Uma boa relação com o dinheiro começa com clareza.</h2>
            <p>Adicione sua primeira conta para começar.</p>
          </div>
          <Button variant="outline" onClick={onNewAccount}>
            <Plus size={16} />
            Adicionar minha conta
          </Button>
        </section>
      )}
      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Evolução dos saldos</h2>
              <p>Patrimônio consolidado realizado · saldo diário</p>
            </div>
            <span className="phase-badge">{format(month, 'MMM yyyy', { locale: ptBR })}</span>
          </div>
          {summary.evolution.length && !hidden ? (
            <div
              className="real-chart"
              role="img"
              aria-label={`Evolução diária do patrimônio em ${format(month, 'MMMM yyyy', { locale: ptBR })}. Saldo inicial do período ${money(summary.evolution[0].balanceCents)} e último saldo ${money(summary.evolution.at(-1)!.balanceCents)}.`}
            >
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <AreaChart
                  data={summary.evolution}
                  margin={{ top: 12, right: 12, bottom: 5, left: 0 }}
                >
                  <CartesianGrid stroke="#303a2c" strokeDasharray="3 4" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(v) => String(v).slice(8)}
                    stroke="#8e9b85"
                    fontSize={10}
                    minTickGap={22}
                  />
                  <YAxis hide domain={['auto', 'auto']} />
                  <Tooltip
                    contentStyle={{
                      background: '#1a2218',
                      border: '1px solid #45543b',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    labelFormatter={(v) => String(v).split('-').reverse().join('/')}
                    formatter={(value) => [money(Number(value)), 'Saldo']}
                  />
                  <Area
                    type="stepAfter"
                    dataKey="balanceCents"
                    stroke="#b7d99f"
                    fill="#b7d99f"
                    fillOpacity={0.08}
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="empty-state chart-placeholder">
              <span className="empty-icon">
                <ChartNoAxesCombined size={24} />
              </span>
              <h3>{hidden ? 'Valores ocultos.' : 'Sua história financeira começa aqui.'}</h3>
              <p>
                {hidden
                  ? 'Use o ícone no topo para mostrar os valores.'
                  : 'Os saldos reais aparecerão conforme você registrar suas contas e movimentações.'}
              </p>
            </div>
          )}
          <p className="chart-explanation">
            Inclui saldos iniciais, transferências e ajustes. Pendências não entram na evolução.{' '}
            <button className="text-link" onClick={onAccounts}>
              Consultar extratos <ArrowUpRight size={13} />
            </button>
          </p>
        </section>
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Consumo líquido por categoria</h2>
              <p>Conforme apuração selecionada · estornos entram como abatimentos</p>
            </div>
          </div>
          {summary.categories.length ? (
            <div className="category-breakdown">
              {summary.categories
                .sort((a, b) => b.amountCents - a.amountCents)
                .map((c) => (
                  <div key={c.id}>
                    <div>
                      <span>{c.name}</span>
                      <strong>{money(c.amountCents)}</strong>
                    </div>
                    <div className="category-bar">
                      <span
                        className={c.color}
                        style={{
                          width: hidden
                            ? '0%'
                            : `${(Math.abs(c.amountCents) / sumCents(summary.categories.map((row) => Math.abs(row.amountCents)))) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <div className="empty-state compact">
              <span className="empty-icon">
                <Wallet size={24} />
              </span>
              <h3>Nenhuma despesa realizada.</h3>
              <p>
                As despesas deste mês aparecerão aqui.
                <br />
                Transferências e ajustes ficam fora do consumo.
              </p>
            </div>
          )}
        </section>
      </div>
      <div className="dashboard-grid lower-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Últimas movimentações</h2>
              <p>Seus registros realizados mais recentes</p>
            </div>
            <button className="text-link" onClick={onMovements}>
              Ver todas <ArrowUpRight size={14} />
            </button>
          </div>
          {latest.length ? (
            <div className="summary-list">
              {latest.map((m) => (
                <div className="dashboard-movement" key={`${m.kind}:${m.id}`}>
                  <span className="empty-icon">
                    <ArrowLeftRight size={17} />
                  </span>
                  <div>
                    <strong>{m.description}</strong>
                    <small>
                      {(m.settledDate ?? m.date).split('-').reverse().join('/')} ·{' '}
                      {data.accounts.find((a) => a.id === m.accountId)?.name}
                    </small>
                  </div>
                  <strong
                    className={
                      m.kind === 'transfer'
                        ? ''
                        : m.direction === 'income'
                          ? 'income-text'
                          : 'expense-text'
                    }
                  >
                    {m.kind === 'transfer' ? '' : m.direction === 'income' ? '+ ' : '− '}
                    {money(m.amountCents)}
                  </strong>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state horizontal-empty">
              <span className="empty-icon">
                <ArrowLeftRight size={23} />
              </span>
              <div>
                <h3>Uma página em branco, cheia de possibilidades.</h3>
                <p>Registre sua primeira movimentação.</p>
              </div>
            </div>
          )}
        </section>
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>No horizonte</h2>
              <p>Compromissos previstos e pendentes</p>
            </div>
            <button className="text-link" onClick={onPlanning}>
              Planejar <ArrowUpRight size={14} />
            </button>
          </div>
          {scheduled.length ? (
            <div className="summary-list">
              {scheduled.map((m) => (
                <div key={`${m.kind}:${m.id}`} className="dashboard-movement">
                  <CalendarDays size={18} className="muted" />
                  <div>
                    <strong>{m.description}</strong>
                    <small className={m.date < today() ? 'expense-text' : ''}>
                      {m.date.split('-').reverse().join('/')}
                      {' · '}
                      {m.kind === 'transfer'
                        ? 'Entre contas'
                        : m.kind === 'adjustment'
                          ? 'Ajuste'
                          : m.direction === 'income'
                            ? 'A receber'
                            : 'A pagar'}
                      {m.date < today() ? ' · Vencido' : ''}
                    </small>
                  </div>
                  <strong>{money(m.amountCents)}</strong>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state compact">
              <span className="empty-icon">
                <CalendarDays size={23} />
              </span>
              <h3>Tudo tranquilo por aqui.</h3>
              <p>Nenhum compromisso previsto ou pendente.</p>
            </div>
          )}
        </section>
      </div>
      <div className="insight-note">Organizar o presente é abrir espaço para o futuro.</div>
    </>
  )
}
