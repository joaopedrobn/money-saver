import { useState } from 'react'
import type { FinanceData } from '@/hooks/use-finances'
import type { CreditCardPurchase } from '@/domain/models'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { PurchaseForm } from './PurchaseForm'
export function PurchaseLedger({
  data,
  money,
  notify,
}: {
  data: FinanceData
  money: (cents: number) => string
  notify: (message: string) => void
}) {
  const [purchase, setPurchase] = useState<CreditCardPurchase | null>(null),
    [search, setSearch] = useState(''),
    [cardId, setCardId] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [categoryId, setCategoryId] = useState(''),
    [limit, setLimit] = useState(50)
  const rows = data.purchases
    .filter(
      (p) =>
        (!cardId || p.cardId === cardId) &&
        (!categoryId || p.categoryId === categoryId) &&
        (!from || p.date >= from) &&
        (!to || p.date <= to) &&
        `${p.description} ${p.notes ?? ''}`
          .toLocaleLowerCase('pt-BR')
          .includes(search.toLocaleLowerCase('pt-BR')),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
  return (
    <section className="panel credit-section">
      <div className="panel-header">
        <div>
          <h2>Compras no crédito</h2>
          <p>
            Histórico separado das saídas bancárias. Pagamentos e estornos são gerenciados em
            Cartões.
          </p>
        </div>
        <a href="#cards" className="text-link">
          Ir para cartões
        </a>
      </div>
      <div className="movement-filters">
        <label className="search-filter">
          Pesquisar
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setLimit(50)
            }}
          />
        </label>
        <label>
          Cartão
          <select value={cardId} onChange={(e) => setCardId(e.target.value)}>
            <option value="">Todos os cartões</option>
            {data.cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Categoria
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Todas as despesas</option>
            {data.categories
              .filter((c) => c.direction === 'expense')
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          De
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          Até
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      {rows.length ? (
        <div className="table-scroll">
          <table className="movement-table">
            <thead>
              <tr>
                <th>Compra</th>
                <th>Data / cartão</th>
                <th>Total financiado</th>
                <th>Parcelas</th>
                <th>Registro</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.description}
                    <small>{data.categories.find((c) => c.id === p.categoryId)?.name}</small>
                  </td>
                  <td>
                    {p.date.split('-').reverse().join('/')}
                    <small>{data.cards.find((c) => c.id === p.cardId)?.name}</small>
                  </td>
                  <td>{money(p.amountCents + (p.feeCents ?? 0))}</td>
                  <td>{p.installmentCount}x</td>
                  <td>
                    {p.status === 'cancelled' ? (
                      'Cancelada'
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => setPurchase(p)}>
                        Consultar / editar
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="credit-empty">
          Nenhuma compra encontrada. Use Novo lançamento → Cartão de crédito para registrar.
        </p>
      )}
      {rows.length > limit && (
        <div className="table-pagination">
          <Button variant="outline" onClick={() => setLimit(limit + 50)}>
            Mostrar mais 50
          </Button>
        </div>
      )}
      <Dialog
        open={!!purchase}
        onOpenChange={(open) => {
          if (!open) setPurchase(null)
        }}
        title="Compra no crédito"
        description="Consulte a prévia das parcelas e as observações da compra."
      >
        {purchase && (
          <PurchaseForm
            data={data}
            purchase={purchase}
            onDone={(message) => {
              setPurchase(null)
              notify(message)
            }}
          />
        )}
      </Dialog>
    </section>
  )
}
