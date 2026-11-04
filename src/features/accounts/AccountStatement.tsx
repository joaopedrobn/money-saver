import { useState } from 'react'
import { addDays, addMonths, endOfMonth, format, parseISO, startOfMonth } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ArrowLeft, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import type { BankAccount, CivilDate, Movement } from '@/domain/models'
import { filterMovements, movementKey, statement, type MovementFilter } from '@/domain/finance'
import { accountBalance, sumCents } from '@/domain/money'
import { today } from '@/domain/financial-validation'
import type { FinanceData } from '@/hooks/use-finances'
import { useRepositories } from '@/infrastructure/financial-context'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { MovementTable } from '@/features/movements/MovementTable'
import { MovementFilters } from '@/features/movements/MovementFilters'
import { NewMovementForm as MovementForm } from '@/features/movements/NewMovementForm'
import { movementLabel, statusLabels } from '@/features/movements/constants'
function monthFilter(month: Date): MovementFilter {
  return {
    from: format(startOfMonth(month), 'yyyy-MM-dd'),
    to: format(endOfMonth(month), 'yyyy-MM-dd'),
  }
}
export function AccountStatement({
  account,
  data,
  money,
  onBack,
  notify,
}: {
  account: BankAccount
  data: FinanceData
  money: (cents: number) => string
  onBack: () => void
  notify: (message: string) => void
}) {
  const repositories = useRepositories()
  const [month, setMonth] = useState(new Date()),
    [filter, setFilter] = useState<MovementFilter>(() => monthFilter(new Date())),
    [form, setForm] = useState<{ movement?: Movement } | null>(null),
    [view, setView] = useState<Movement | null>(null),
    [deleting, setDeleting] = useState<Movement | null>(null),
    [limit, setLimit] = useState(50)
  const all = statement(data, account.id, '9999-12-31'),
    rows = filterMovements(
      all.map((r) => r.movement),
      filter,
    ),
    keys = new Set(rows.map(movementKey)),
    filtered = all.filter((row) => keys.has(movementKey(row.movement)))
  const income = sumCents(filtered.filter((r) => r.delta > 0).map((r) => r.delta)),
    expense = sumCents(filtered.filter((r) => r.delta < 0).map((r) => -r.delta))
  const beforeDate = filter.from
    ? (format(addDays(parseISO(filter.from), -1), 'yyyy-MM-dd') as CivilDate)
    : undefined
  const before = beforeDate
    ? accountBalance(
        account,
        data.transactions,
        data.transfers,
        data.payments,
        data.adjustments,
        beforeDate,
      )
    : account.openingBalanceCents
  function changeMonth(next: Date) {
    setMonth(next)
    setFilter({ ...filter, ...monthFilter(next) })
    setLimit(50)
  }
  return (
    <>
      <Button variant="ghost" onClick={onBack}>
        <ArrowLeft size={15} />
        Todas as contas
      </Button>
      <div className="statement-heading">
        <div>
          <h2>{account.name}</h2>
          <p>
            {account.institution} · Saldo inicial em{' '}
            {account.openingDate.split('-').reverse().join('/')}:{' '}
            {money(account.openingBalanceCents)}
          </p>
        </div>
        <div>
          <span>Saldo atual</span>
          <strong className={data.balances[account.id] < 0 ? 'expense-text' : ''}>
            {money(data.balances[account.id])}
          </strong>
        </div>
      </div>
      <div className="section-heading">
        <h2>Extrato da conta</h2>
        <div className="month-picker">
          <button
            aria-label="Mês anterior do extrato"
            onClick={() => changeMonth(addMonths(month, -1))}
          >
            <ChevronLeft size={15} />
          </button>
          <span>{format(month, 'MMMM yyyy', { locale: ptBR })}</span>
          <button
            aria-label="Próximo mês do extrato"
            onClick={() => changeMonth(addMonths(month, 1))}
          >
            <ChevronRight size={15} />
          </button>
        </div>
        <Button onClick={() => setForm({})}>
          <Plus size={15} />
          Novo lançamento
        </Button>
      </div>
      <div className="statement-stats">
        <div>
          <span>Saldo antes do período</span>
          <strong>{money(before)}</strong>
        </div>
        <div>
          <span>Entradas filtradas</span>
          <strong className="income-text">{money(income)}</strong>
        </div>
        <div>
          <span>Saídas filtradas</span>
          <strong className="expense-text">{money(expense)}</strong>
        </div>
      </div>
      <p className="form-hint">
        Entradas e saídas incluem transferências e ajustes realizados. O saldo progressivo considera
        todo o histórico anterior, mesmo com filtros; previstos e cancelados não alteram o saldo.
      </p>
      <section className="panel">
        <MovementFilters
          value={filter}
          onChange={(next) => {
            setFilter(next)
            setLimit(50)
          }}
          categories={data.categories}
        />
        <MovementTable
          rows={rows.slice(0, limit)}
          data={data}
          money={money}
          accountId={account.id}
          running={new Map(all.map((row) => [movementKey(row.movement), row.balance]))}
          onView={setView}
          onEdit={(movement) => setForm({ movement })}
          onDelete={setDeleting}
          onSettle={(movement) =>
            setForm({ movement: { ...movement, status: 'settled', settledDate: today() } })
          }
        />
        {rows.length > limit && (
          <div className="table-pagination">
            <Button variant="outline" onClick={() => setLimit(limit + 50)}>
              Mostrar mais 50
            </Button>
          </div>
        )}
      </section>
      <Dialog
        open={!!form}
        onOpenChange={(open) => {
          if (!open) setForm(null)
        }}
        title={form?.movement ? 'Editar movimentação' : 'Novo lançamento'}
        description="As alterações recalculam os saldos das contas envolvidas."
      >
        {form && (
          <MovementForm
            data={data}
            movement={form.movement}
            defaultAccountId={account.id}
            onDone={(message) => {
              setForm(null)
              notify(message)
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={!!view}
        onOpenChange={(open) => {
          if (!open) setView(null)
        }}
        title={view?.description ?? 'Movimentação'}
        description="Detalhes do registro no extrato."
      >
        {view && (
          <dl className="detail-list">
            <div>
              <dt>Tipo</dt>
              <dd>{movementLabel(view)}</dd>
            </div>
            <div>
              <dt>Valor</dt>
              <dd>{money(view.amountCents)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{statusLabels[view.status]}</dd>
            </div>
            <div>
              <dt>Vencimento / operação</dt>
              <dd>{view.date.split('-').reverse().join('/')}</dd>
            </div>
            <div>
              <dt>Efetivação</dt>
              <dd>
                {view.status === 'settled'
                  ? (view.settledDate ?? view.date).split('-').reverse().join('/')
                  : 'Não efetivado'}
              </dd>
            </div>
            <div>
              <dt>Observações</dt>
              <dd className="notes">{view.notes || 'Sem observações'}</dd>
            </div>
            <div>
              <dt>Identificador</dt>
              <dd className="record-id">{view.id}</dd>
            </div>
          </dl>
        )}
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Excluir movimentação?"
        confirmLabel="Excluir"
        onConfirm={async () => {
          if (deleting) {
            await repositories.movements.remove(deleting.kind, deleting.id)
            notify('Movimentação excluída e saldos recalculados.')
          }
        }}
      >
        “{deleting?.description}” será removido definitivamente.{' '}
        {deleting?.kind === 'transfer'
          ? 'As duas contas serão atualizadas juntas.'
          : 'O saldo será recalculado a partir do histórico restante.'}
      </ConfirmDialog>
    </>
  )
}
