import { Pencil, Trash2, Check, ArrowLeftRight } from 'lucide-react'
import type { Movement } from '@/domain/models'
import type { FinanceData } from '@/hooks/use-finances'
import { movementDate, movementKey } from '@/domain/finance'
import { movementLabel, statusLabels } from './constants'
import { Button } from '@/components/ui/button'
const dateLabel = (value: string) => value.split('-').reverse().join('/')
export function MovementTable({
  rows,
  data,
  money,
  onView,
  onEdit,
  onDelete,
  onSettle,
  running,
  accountId,
}: {
  rows: Movement[]
  data: FinanceData
  money: (cents: number) => string
  onView: (m: Movement) => void
  onEdit?: (m: Movement) => void
  onDelete?: (m: Movement) => void
  onSettle?: (m: Movement) => void
  running?: Map<string, number>
  accountId?: string
}) {
  if (!rows.length)
    return (
      <div className="empty-state table-empty">
        <span className="empty-icon">
          <ArrowLeftRight size={25} />
        </span>
        <h3>Nenhuma movimentação por aqui.</h3>
        <p>Adicione um lançamento ou ajuste os filtros para consultar seu histórico.</p>
      </div>
    )
  return (
    <div className="table-scroll">
      <table className="movement-table">
        <thead>
          <tr>
            <th>Data</th>
            <th>Descrição</th>
            <th>Conta / categoria</th>
            <th>Status</th>
            <th className="numeric">Valor</th>
            {running && <th className="numeric">Saldo progressivo</th>}
            <th>
              <span className="sr-only">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const isOut =
              m.kind === 'transfer' ? m.accountId === accountId : m.direction === 'expense'
            const sign = m.kind === 'transfer' && !accountId ? '' : isOut ? '− ' : '+ '
            return (
              <tr key={movementKey(m)}>
                <td>
                  <span>{dateLabel(movementDate(m))}</span>
                  {m.status === 'settled' && m.settledDate !== m.date && (
                    <small>Venc. {dateLabel(m.date)}</small>
                  )}
                </td>
                <td>
                  <button className="row-title" onClick={() => onView(m)}>
                    {m.description}
                  </button>
                  <small>{movementLabel(m)}</small>
                </td>
                <td>
                  {data.accounts.find((a) => a.id === m.accountId)?.name}
                  {m.kind === 'transfer' && (
                    <> → {data.accounts.find((a) => a.id === m.destinationAccountId)?.name}</>
                  )}
                  <small>
                    {m.kind === 'transfer'
                      ? 'Entre suas contas'
                      : (data.categories.find((c) => c.id === m.categoryId)?.name ??
                        (m.paymentId
                          ? 'Liquidação de fatura · fora do consumo'
                          : 'Ajuste histórico'))}
                  </small>
                </td>
                <td>
                  <span className={`status-badge status-${m.status}`}>
                    {statusLabels[m.status]}
                  </span>
                </td>
                <td
                  className={`numeric ${m.status !== 'settled' ? 'muted' : m.kind === 'transfer' && !accountId ? '' : isOut ? 'expense-text' : 'income-text'}`}
                >
                  {sign}
                  {money(m.amountCents)}
                </td>
                {running && <td className="numeric">{money(running.get(movementKey(m)) ?? 0)}</td>}
                <td>
                  <div className="table-actions">
                    {onSettle && !m.readOnly && ['planned', 'pending'].includes(m.status) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onSettle(m)}
                        aria-label={`Efetivar ${m.description}`}
                        title="Marcar como pago ou recebido"
                      >
                        <Check size={15} />
                      </Button>
                    )}
                    {onEdit && !m.readOnly && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onEdit(m)}
                        aria-label={`Editar ${m.description}`}
                      >
                        <Pencil size={14} />
                      </Button>
                    )}
                    {onDelete && !m.readOnly && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onDelete(m)}
                        aria-label={`Excluir ${m.description}`}
                      >
                        <Trash2 size={14} />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
