import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { FinanceData } from '@/hooks/use-finances'
import type { CivilDate, Movement } from '@/domain/models'
import { compareMovements, filterMovements, type MovementFilter } from '@/domain/finance'
import { today } from '@/domain/financial-validation'
import { repositories } from '@/infrastructure/repositories'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { NewMovementForm as MovementForm } from './NewMovementForm'
import { PurchaseLedger } from '@/features/cards/PurchaseLedger'
import { MovementFilters } from './MovementFilters'
import { MovementTable } from './MovementTable'
import { statusLabels, movementLabel } from './constants'
export function MovementsPage({
  data,
  money,
  notify,
  plannedOnly = false,
  defaultAccountId,
  period,
}: {
  data: FinanceData
  money: (cents: number) => string
  notify: (message: string) => void
  plannedOnly?: boolean
  defaultAccountId?: string
  period?: { from: string; to: string }
}) {
  const [filter, setFilter] = useState<MovementFilter>({ accountId: defaultAccountId, ...period }),
    [form, setForm] = useState<{ movement?: Movement } | null>(null),
    [deleting, setDeleting] = useState<Movement | null>(null),
    [view, setView] = useState<Movement | null>(null),
    [settling, setSettling] = useState<Movement | null>(null),
    [settledDate, setSettledDate] = useState(today()),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const rows = filterMovements(
    data.movements.filter((m) => !plannedOnly || ['planned', 'pending'].includes(m.status)),
    filter,
  ).sort((a, b) => -compareMovements(a, b))
  const [limit, setLimit] = useState(50)
  async function settle() {
    if (!settling) return
    setError('')
    setBusy(true)
    try {
      await repositories.movements.settle(settling.kind, settling.id, settledDate as CivilDate)
      setSettling(null)
      notify('Efetivação registrada. Saldos atualizados.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível efetivar.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>
            {plannedOnly ? 'Compromissos previstos e pendentes' : 'Histórico financeiro'}{' '}
            <span className="count-badge">{rows.length}</span>
          </h2>
          <p className="form-hint">
            {plannedOnly
              ? 'Inclui vencidos. Os valores só afetam o saldo após a efetivação.'
              : 'Receitas, despesas, Pix, transferências e ajustes em uma única visão.'}
          </p>
        </div>
        <Button onClick={() => setForm({})} disabled={!data.accounts.length || !!data.error}>
          <Plus size={16} />
          {plannedOnly ? 'Novo compromisso' : 'Novo lançamento'}
        </Button>
      </div>
      {!data.accounts.length && (
        <p className="info-banner">
          Cadastre uma conta na área Contas para começar a lançar movimentações.
        </p>
      )}
      <section className="panel">
        <MovementFilters
          value={filter}
          onChange={(next) => {
            setFilter(next)
            setLimit(50)
          }}
          categories={data.categories}
          accounts={data.accounts}
          noStatus={plannedOnly}
        />
        <MovementTable
          rows={rows.slice(0, limit)}
          data={data}
          money={money}
          onView={setView}
          onEdit={(movement) => setForm({ movement })}
          onDelete={setDeleting}
          onSettle={(m) => {
            setError('')
            setSettledDate(today())
            setSettling(m)
          }}
        />
        {rows.length > limit && (
          <div className="table-pagination">
            <Button variant="outline" onClick={() => setLimit(limit + 50)}>
              Mostrar mais 50
            </Button>
            <span>
              {limit} de {rows.length}
            </span>
          </div>
        )}
      </section>
      {!plannedOnly && <PurchaseLedger data={data} money={money} notify={notify} />}
      <Dialog
        open={!!form}
        onOpenChange={(open) => {
          if (!open) setForm(null)
        }}
        title={
          form?.movement
            ? 'Editar lançamento'
            : plannedOnly
              ? 'Novo compromisso'
              : 'Novo lançamento'
        }
        description="Registre seu dinheiro com clareza. Valores em reais."
      >
        {form && (
          <MovementForm
            data={data}
            movement={form.movement}
            planned={plannedOnly}
            defaultAccountId={defaultAccountId}
            onDone={(message) => {
              setForm(null)
              notify(message)
            }}
          />
        )}
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Excluir lançamento?"
        confirmLabel="Excluir lançamento"
        onConfirm={async () => {
          if (deleting) {
            await repositories.movements.remove(deleting.kind, deleting.id)
            notify('Lançamento excluído e saldos recalculados.')
          }
        }}
      >
        “{deleting?.description}” será removido do histórico. Esta ação não pode ser desfeita.{' '}
        {deleting?.kind === 'transfer' && 'As duas contas serão recalculadas juntas.'}
      </ConfirmDialog>
      <Dialog
        open={!!settling}
        onOpenChange={(open) => {
          if (!open && !busy) setSettling(null)
        }}
        title="Confirmar efetivação"
        description="O saldo será atualizado na data real do pagamento ou recebimento."
      >
        <form
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault()
            void settle()
          }}
        >
          <p>
            {settling?.description} · {settling && money(settling.amountCents)}
          </p>
          <label>
            Data real da efetivação
            <input
              type="date"
              required
              max={today()}
              value={settledDate}
              onChange={(e) => setSettledDate(e.target.value as CivilDate)}
            />
          </label>
          {error && (
            <p role="alert" className="error-banner">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <Button type="submit" disabled={busy}>
              {busy ? 'Salvando…' : 'Confirmar pagamento / recebimento'}
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={!!view}
        onOpenChange={(open) => {
          if (!open) setView(null)
        }}
        title={view?.description ?? 'Lançamento'}
        description="Detalhes da movimentação registrada."
      >
        {view && (
          <dl className="detail-list">
            <div>
              <dt>Valor</dt>
              <dd>{money(view.amountCents)}</dd>
            </div>
            <div>
              <dt>Tipo</dt>
              <dd>{movementLabel(view)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{statusLabels[view.status]}</dd>
            </div>
            <div>
              <dt>Operação / vencimento</dt>
              <dd>{view.date.split('-').reverse().join('/')}</dd>
            </div>
            <div>
              <dt>Efetivação</dt>
              <dd>
                {view.status === 'settled'
                  ? (view.settledDate ?? view.date).split('-').reverse().join('/')
                  : 'Ainda não efetivado'}
              </dd>
            </div>
            <div>
              <dt>Conta</dt>
              <dd>{data.accounts.find((a) => a.id === view.accountId)?.name}</dd>
            </div>
            {view.destinationAccountId && (
              <div>
                <dt>Destino</dt>
                <dd>{data.accounts.find((a) => a.id === view.destinationAccountId)?.name}</dd>
              </div>
            )}
            <div>
              <dt>Categoria</dt>
              <dd>
                {data.categories.find((c) => c.id === view.categoryId)?.name ?? 'Não se aplica'}
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
    </>
  )
}
