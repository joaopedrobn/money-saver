import type { MovementFilter } from '@/domain/finance'
import type { Category, BankAccount } from '@/domain/models'
import { statusLabels } from './constants'
export function MovementFilters({
  value,
  onChange,
  categories,
  accounts,
  noStatus = false,
}: {
  value: MovementFilter
  onChange: (filter: MovementFilter) => void
  categories: Category[]
  accounts?: BankAccount[]
  noStatus?: boolean
}) {
  const set = (key: keyof MovementFilter, next: string) => onChange({ ...value, [key]: next })
  return (
    <div className="movement-filters">
      <label className="search-filter">
        Pesquisar
        <input
          type="search"
          placeholder="Descrição ou observações…"
          value={value.search ?? ''}
          onChange={(e) => set('search', e.target.value)}
        />
      </label>
      <label>
        De
        <input type="date" value={value.from ?? ''} onChange={(e) => set('from', e.target.value)} />
      </label>
      <label>
        Até
        <input
          type="date"
          min={value.from}
          value={value.to ?? ''}
          onChange={(e) => set('to', e.target.value)}
        />
      </label>
      {accounts && (
        <label>
          Conta
          <select value={value.accountId ?? ''} onChange={(e) => set('accountId', e.target.value)}>
            <option value="">Todas as contas</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Categoria
        <select value={value.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value)}>
          <option value="">Todas as categorias</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.direction === 'income' ? 'Receita' : 'Despesa'}
              {c.archived ? ' (arquivada)' : ''}
            </option>
          ))}
        </select>
      </label>
      <label>
        Tipo
        <select value={value.type ?? ''} onChange={(e) => set('type', e.target.value)}>
          <option value="">Todos os tipos</option>
          <option value="income">Receita</option>
          <option value="expense">Despesa</option>
          <option value="pix">Pix</option>
          <option value="transfer">Transferência</option>
          <option value="adjustment">Ajuste</option>
          <option value="payment">Pagamento / estorno de fatura</option>
        </select>
      </label>
      {!noStatus && (
        <label>
          Status
          <select value={value.status ?? ''} onChange={(e) => set('status', e.target.value)}>
            <option value="">Todos os status</option>
            {Object.entries(statusLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}
