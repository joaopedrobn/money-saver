import { useState, type FormEvent } from 'react'
import { format } from 'date-fns'
import type { FinanceData } from '@/hooks/use-finances'
import type { CivilDate, RecurringTransaction } from '@/domain/models'
import { budgetUsage, financialForecast, pendingOccurrences } from '@/domain/planning'
import { today } from '@/domain/financial-validation'
import { formatMoneyInput, parseBRL } from '@/domain/money'
import { useRepositories } from '@/infrastructure/financial-context'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

function RecurringForm({
  data,
  recurring,
  done,
}: {
  data: FinanceData
  recurring?: RecurringTransaction
  done: () => void
}) {
  const repositories = useRepositories()
  const [direction, setDirection] = useState(recurring?.direction ?? 'expense')
  const [frequency, setFrequency] = useState(recurring?.frequency ?? 'monthly')
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const v = new FormData(event.currentTarget)
    try {
      const target = String(v.get('target')),
        cardId = target.startsWith('card:') ? target.slice(5) : undefined
      const accountId = cardId
        ? data.cards.find((c) => c.id === cardId)!.accountId
        : target.slice(5)
      await repositories.planning.saveRecurring(
        {
          description: String(v.get('description')),
          amountCents: parseBRL(String(v.get('amount'))),
          categoryId: String(v.get('categoryId')),
          accountId,
          cardId,
          direction,
          frequency,
          dayOfMonth: Number(v.get('day')),
          startDate: String(v.get('start')) as CivilDate,
          endDate: v.get('end') ? (String(v.get('end')) as CivilDate) : undefined,
        },
        recurring?.id,
      )
      done()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="account-form" onSubmit={save}>
      <label>
        Descrição
        <input
          name="description"
          required
          minLength={2}
          maxLength={160}
          autoFocus
          defaultValue={recurring?.description}
        />
      </label>
      <div className="form-row">
        <label>
          Valor previsto (R$)
          <input
            name="amount"
            required
            inputMode="decimal"
            defaultValue={recurring ? formatMoneyInput(recurring.amountCents) : ''}
          />
        </label>
        <label>
          Tipo
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as typeof direction)}
          >
            <option value="expense">Despesa</option>
            <option value="income">Receita</option>
          </select>
        </label>
      </div>
      <label>
        Categoria
        <select
          name="categoryId"
          key={direction}
          required
          defaultValue={recurring?.categoryId ?? ''}
        >
          <option value="">Selecione</option>
          {data.categories
            .filter(
              (c) => c.direction === direction && (!c.archived || c.id === recurring?.categoryId),
            )
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </label>
      <label>
        Conta ou cartão
        <select
          name="target"
          key={direction}
          required
          defaultValue={
            recurring?.cardId && direction === 'expense'
              ? `card:${recurring.cardId}`
              : `bank:${recurring?.accountId ?? data.accounts[0]?.id ?? ''}`
          }
        >
          {data.accounts.map((a) => (
            <option key={a.id} value={`bank:${a.id}`}>
              Conta · {a.name}
            </option>
          ))}
          {direction === 'expense' &&
            data.cards
              .filter((c) => !c.archived || c.id === recurring?.cardId)
              .map((c) => (
                <option key={c.id} value={`card:${c.id}`}>
                  Cartão · {c.name}
                </option>
              ))}
        </select>
      </label>
      <div className="form-row">
        <label>
          Frequência
          <select
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as typeof frequency)}
          >
            <option value="monthly">Mensal</option>
            <option value="weekly">Semanal</option>
            <option value="yearly">Anual</option>
          </select>
        </label>
        <label>
          {frequency === 'weekly' ? 'Dia da semana (1=seg, 7=dom)' : 'Dia do vencimento'}
          <input
            name="day"
            type="number"
            required
            min={1}
            max={frequency === 'weekly' ? 7 : 31}
            defaultValue={recurring?.dayOfMonth ?? 1}
          />
        </label>
      </div>
      <div className="form-row">
        <label>
          Data inicial
          <input name="start" required type="date" defaultValue={recurring?.startDate ?? today()} />
        </label>
        <label>
          Data final (opcional)
          <input name="end" type="date" defaultValue={recurring?.endDate} />
        </label>
      </div>
      <p className="form-hint">
        Dias inexistentes usam o último dia do mês. A frequência anual usa o mês da data inicial.
        Editar não altera ocorrências já efetivadas. Pausar ou encerrar retira ocorrências não
        efetivadas da previsão; valores realizados permanecem no histórico.
      </p>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <Button type="submit" disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar recorrência'}
        </Button>
      </div>
    </form>
  )
}

export function PlanningTools({
  data,
  month,
  money,
  notify,
}: {
  data: FinanceData
  month: Date
  money: (cents: number) => string
  notify: (message: string) => void
}) {
  const repositories = useRepositories()
  const period = format(month, 'yyyy-MM')
  const [form, setForm] = useState<{ recurring?: RecurringTransaction } | null>(null)
  const [realizing, setRealizing] = useState<ReturnType<typeof pendingOccurrences>[number] | null>(
    null,
  )
  const [ending, setEnding] = useState<RecurringTransaction | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [horizon, setHorizon] = useState(3),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const occurrences = pendingOccurrences(data, `${period}-01`, `${period}-31`)
  const forecasts = financialForecast(data, today(), horizon, data.total)
  async function run(action: () => Promise<void>, message: string) {
    setBusy(true)
    setError('')
    try {
      await action()
      notify(message)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível concluir.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <section className="panel credit-section">
        <div className="panel-header">
          <div>
            <h2>Receitas e despesas recorrentes</h2>
            <p>Previsões não movimentam sua conta. Confirme cada ocorrência.</p>
          </div>
          <Button disabled={!data.accounts.length} onClick={() => setForm({})}>
            Nova recorrência
          </Button>
        </div>
        <div className="summary-list">
          {(data.recurring ?? []).map((r) => (
            <div key={r.id} className="dashboard-movement">
              <div>
                <strong>
                  {r.description} · {money(r.amountCents)}
                </strong>
                <small>
                  {r.frequency === 'monthly'
                    ? 'Mensal'
                    : r.frequency === 'weekly'
                      ? 'Semanal'
                      : 'Anual'}{' '}
                  · {r.ended ? 'Encerrada' : r.active ? 'Ativa' : 'Pausada'} ·{' '}
                  {r.cardId ? 'Cartão' : r.direction === 'income' ? 'A receber' : 'A pagar'}
                </small>
              </div>
              <div className="credit-row-actions">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={r.ended || busy}
                  onClick={() => setForm({ recurring: r })}
                >
                  Editar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={r.ended || busy}
                  onClick={() =>
                    void run(
                      () => repositories.planning.status(r.id, r.active ? 'paused' : 'active'),
                      'Status atualizado.',
                    )
                  }
                >
                  {r.active ? 'Pausar' : 'Retomar'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={r.ended || busy}
                  onClick={() => setEnding(r)}
                >
                  Encerrar
                </Button>
              </div>
            </div>
          ))}
          {!data.recurring?.length && (
            <p className="credit-empty">Nenhuma recorrência cadastrada.</p>
          )}
        </div>
        <div className="panel-header">
          <div>
            <h2>Ocorrências de {period}</h2>
            <p>Cartão: confirmar registra uma compra; o pagamento da fatura continua em Cartões.</p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="movement-table">
            <thead>
              <tr>
                <th>Data prevista</th>
                <th>Descrição</th>
                <th>Valor previsto</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {occurrences.map((o) => (
                <tr key={`${o.recurring.id}:${o.date}`}>
                  <td>{o.date.split('-').reverse().join('/')}</td>
                  <td>{o.recurring.description}</td>
                  <td>{money(o.recurring.amountCents)}</td>
                  <td>
                    <Button size="sm" variant="outline" onClick={() => setRealizing(o)}>
                      {o.recurring.cardId
                        ? 'Registrar compra'
                        : o.recurring.direction === 'income'
                          ? 'Marcar recebida'
                          : 'Marcar paga'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!occurrences.length && (
          <p className="credit-empty">Nenhuma ocorrência pendente neste mês.</p>
        )}
      </section>
      <section className="panel credit-section">
        <div className="panel-header">
          <div>
            <h2>Orçamentos de {period}</h2>
            <p>Consumo realizado por categoria, conforme o regime escolhido no dashboard.</p>
          </div>
        </div>
        <form
          className="movement-filters"
          onSubmit={(event) => {
            event.preventDefault()
            const v = new FormData(event.currentTarget)
            void run(
              async () =>
                repositories.planning.saveBudget(
                  period,
                  String(v.get('category')),
                  parseBRL(String(v.get('amount'))),
                ),
              'Orçamento salvo.',
            )
          }}
        >
          <label>
            Categoria
            <select name="category" required>
              <option value="">Selecione</option>
              {data.categories
                .filter((c) => c.direction === 'expense' && !c.archived)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Limite mensal (R$)
            <input name="amount" required inputMode="decimal" />
          </label>
          <Button type="submit" disabled={busy}>
            Salvar limite
          </Button>
        </form>
        <div className="table-scroll">
          <table className="movement-table">
            <thead>
              <tr>
                <th>Categoria</th>
                <th>Limite</th>
                <th>Utilizado</th>
                <th>Disponível</th>
                <th>Consumido</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {budgetUsage(data, period, today()).map((b) => (
                <tr key={b.id}>
                  <td>{data.categories.find((c) => c.id === b.categoryId)?.name}</td>
                  <td>{money(b.amountCents)}</td>
                  <td>{money(b.used)}</td>
                  <td className={b.available < 0 ? 'expense-text' : ''}>{money(b.available)}</td>
                  <td>
                    {b.percent}%{b.available < 0 ? ' · Acima do limite' : ''}
                  </td>
                  <td>
                    <Button size="sm" variant="ghost" onClick={() => setRemoving(b.id)}>
                      Remover
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.budgets?.some((b) => b.month === period) && (
          <p className="credit-empty">
            Nenhum limite definido. Salvar a mesma categoria atualiza seu limite.
          </p>
        )}
      </section>
      <section className="panel credit-section">
        <div className="panel-header">
          <div>
            <h2>Projeção de caixa</h2>
            <p>
              Parte do saldo realizado de hoje. Inclui pendências bancárias, recorrências e faturas
              pelo vencimento, sem repetir parcelas.
            </p>
          </div>
          <label>
            Horizonte
            <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>
              {[3, 6, 12].map((n) => (
                <option key={n} value={n}>
                  {n} meses
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="table-scroll">
          <table className="movement-table">
            <thead>
              <tr>
                <th>Mês</th>
                <th>Receitas previstas</th>
                <th>Despesas bancárias previstas</th>
                <th>Faturas previstas</th>
                <th>Saldo projetado ao fim do mês</th>
              </tr>
            </thead>
            <tbody>
              {forecasts.map((f) => (
                <tr key={f.period}>
                  <td>{f.period}</td>
                  <td>{money(f.income)}</td>
                  <td>{money(f.bankExpense)}</td>
                  <td>{money(f.invoiceExpense)}</td>
                  <td className={f.projected < 0 ? 'expense-text' : ''}>{money(f.projected)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="chart-explanation">
          Recorrências projetadas a partir de hoje, inclusive hoje, não são lançamentos realizados.
          Valores podem mudar após confirmação. Compras recorrentes no cartão seguem o fechamento e
          o vencimento; não debitam a conta na compra.
        </p>
      </section>
      <Dialog
        open={!!form}
        onOpenChange={(open) => {
          if (!open) setForm(null)
        }}
        title={form?.recurring ? 'Editar recorrência' : 'Nova recorrência'}
        description="Configure previsões sem alterar registros efetivados."
      >
        {form && (
          <RecurringForm
            data={data}
            recurring={form.recurring}
            done={() => {
              setForm(null)
              notify('Recorrência salva.')
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={!!realizing}
        onOpenChange={(open) => {
          if (!open && !busy) setRealizing(null)
        }}
        title="Confirmar ocorrência"
        description="Ajuste o valor e a data efetiva antes de registrar."
      >
        {realizing && (
          <form
            className="account-form"
            onSubmit={(event) => {
              event.preventDefault()
              const v = new FormData(event.currentTarget)
              void run(async () => {
                await repositories.planning.realize(
                  realizing.recurring.id,
                  realizing.date,
                  parseBRL(String(v.get('amount'))),
                  String(v.get('date')) as CivilDate,
                )
                setRealizing(null)
              }, 'Ocorrência efetivada uma única vez.')
            }}
          >
            <p>
              {realizing.recurring.description} · previsto em {realizing.date}
            </p>
            <label>
              Valor efetivo (R$)
              <input
                name="amount"
                autoFocus
                required
                inputMode="decimal"
                defaultValue={formatMoneyInput(realizing.recurring.amountCents)}
              />
            </label>
            <label>
              Data efetiva
              <input
                name="date"
                type="date"
                required
                max={today()}
                defaultValue={realizing.date > today() ? today() : realizing.date}
              />
            </label>
            {error && (
              <p role="alert" className="error-banner">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? 'Salvando…' : 'Confirmar efetivação'}
            </Button>
          </form>
        )}
      </Dialog>
      <ConfirmDialog
        open={!!ending}
        title="Encerrar recorrência?"
        onClose={() => setEnding(null)}
        onConfirm={async () => {
          if (ending) await repositories.planning.status(ending.id, 'ended')
        }}
      >
        Ocorrências não efetivadas sairão da previsão. O histórico será preservado. Não é possível
        retomar uma recorrência encerrada.
      </ConfirmDialog>
      <ConfirmDialog
        open={!!removing}
        title="Remover limite mensal?"
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (removing) await repositories.planning.removeBudget(removing)
        }}
      >
        Somente o limite será removido. As despesas permanecem no histórico.
      </ConfirmDialog>
    </>
  )
}
