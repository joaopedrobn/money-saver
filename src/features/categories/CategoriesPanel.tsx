import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Plus,
  Pencil,
  ArchiveRestore,
  Archive,
  Wallet,
  Home,
  Car,
  Heart,
  BookOpen,
  ShoppingBag,
  Coffee,
  Repeat,
  Briefcase,
  Gift,
  Tag,
  type LucideIcon,
} from 'lucide-react'
import type { Category } from '@/domain/models'
import type { z } from 'zod'
import { categorySchema } from '@/domain/financial-validation'
import { useRepositories } from '@/infrastructure/financial-context'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { accountColors } from '@/features/accounts/constants'
const icons: Record<string, { label: string; icon: LucideIcon }> = {
  wallet: { label: 'Carteira', icon: Wallet },
  home: { label: 'Casa', icon: Home },
  car: { label: 'Transporte', icon: Car },
  heart: { label: 'Saúde', icon: Heart },
  book: { label: 'Educação', icon: BookOpen },
  shopping: { label: 'Compras', icon: ShoppingBag },
  coffee: { label: 'Alimentação', icon: Coffee },
  repeat: { label: 'Recorrente', icon: Repeat },
  briefcase: { label: 'Trabalho', icon: Briefcase },
  gift: { label: 'Presente', icon: Gift },
  tag: { label: 'Etiqueta', icon: Tag },
}
function CategoryForm({ category, onDone }: { category?: Category; onDone: () => void }) {
  const repositories = useRepositories()
  const [error, setError] = useState('')
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof categorySchema>>({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      name: category?.name ?? '',
      direction: category?.direction ?? 'expense',
      color: (category?.color ?? 'sage') as z.infer<typeof categorySchema>['color'],
      icon: (category?.icon ?? 'tag') as z.infer<typeof categorySchema>['icon'],
    },
  })
  return (
    <form
      className="account-form"
      onSubmit={handleSubmit(async (values) => {
        setError('')
        try {
          if (category) await repositories.categories.update(category.id, values)
          else await repositories.categories.create(values)
          onDone()
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Não foi possível salvar.')
        }
      })}
      noValidate
    >
      <label>
        Nome
        <input autoFocus {...register('name')} />
        {errors.name && <small className="field-error">Use entre 2 e 60 caracteres.</small>}
      </label>
      <label>
        Grupo
        {category ? (
          <>
            <input type="hidden" {...register('direction')} />
            <span>{category.direction === 'income' ? 'Receita' : 'Despesa'}</span>
          </>
        ) : (
          <select {...register('direction')}>
            <option value="expense">Despesa</option>
            <option value="income">Receita</option>
          </select>
        )}
      </label>
      <div className="form-row">
        <label>
          Cor
          <select {...register('color')}>
            {Object.entries(accountColors).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ícone
          <select {...register('icon')}>
            {Object.entries(icons).map(([key, item]) => (
              <option key={key} value={key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      <p className="form-hint">
        O grupo não muda após a criação, para preservar o significado dos lançamentos existentes.
      </p>
      <div className="dialog-actions">
        <Button disabled={isSubmitting} type="submit">
          {isSubmitting ? 'Salvando…' : 'Salvar categoria'}
        </Button>
      </div>
    </form>
  )
}
export function CategoriesPanel({
  categories,
  notify,
}: {
  categories: Category[]
  notify: (message: string) => void
}) {
  const repositories = useRepositories()
  const [form, setForm] = useState<{ category?: Category } | null>(null),
    [archiving, setArchiving] = useState<Category | null>(null),
    [showArchived, setShowArchived] = useState(false)
  return (
    <section className="panel categories-panel">
      <div className="panel-header">
        <div>
          <h2>Categorias financeiras</h2>
          <p>Dê sentido aos seus lançamentos.</p>
        </div>
        <Button variant="outline" onClick={() => setForm({})}>
          <Plus size={15} />
          Nova categoria
        </Button>
      </div>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />{' '}
        Mostrar categorias arquivadas
      </label>
      {(['expense', 'income'] as const).map((group) => (
        <div className="category-group" key={group}>
          <h3>{group === 'expense' ? 'Despesas' : 'Receitas'}</h3>
          <div className="category-grid">
            {categories
              .filter((c) => c.direction === group && (showArchived || !c.archived))
              .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
              .map((c) => {
                const Icon = icons[c.icon]?.icon ?? Tag
                return (
                  <article
                    className={`category-item ${c.archived ? 'is-archived' : ''}`}
                    key={c.id}
                  >
                    <span className={`account-symbol ${c.color}`}>
                      <Icon size={18} />
                    </span>
                    <div>
                      <strong>{c.name}</strong>
                      {c.archived && <small>Arquivada</small>}
                    </div>
                    <div className="table-actions">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Editar categoria ${c.name}`}
                        onClick={() => setForm({ category: c })}
                      >
                        <Pencil size={14} />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`${c.archived ? 'Reativar' : 'Arquivar'} categoria ${c.name}`}
                        onClick={() => setArchiving(c)}
                      >
                        {c.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                      </Button>
                    </div>
                  </article>
                )
              })}
          </div>
        </div>
      ))}
      <Dialog
        open={!!form}
        onOpenChange={(open) => {
          if (!open) setForm(null)
        }}
        title={form?.category ? 'Editar categoria' : 'Nova categoria'}
        description="Categorias organizam o histórico sem alterar saldos."
      >
        {form && (
          <CategoryForm
            category={form.category}
            onDone={() => {
              setForm(null)
              notify('Categoria salva.')
            }}
          />
        )}
      </Dialog>
      <ConfirmDialog
        open={!!archiving}
        onClose={() => setArchiving(null)}
        title={archiving?.archived ? 'Reativar categoria?' : 'Arquivar categoria?'}
        confirmLabel={archiving?.archived ? 'Reativar' : 'Arquivar'}
        onConfirm={async () => {
          if (archiving) {
            await repositories.categories.archive(archiving.id, !archiving.archived)
            notify(archiving.archived ? 'Categoria reativada.' : 'Categoria arquivada.')
          }
        }}
      >
        A categoria “{archiving?.name}”{' '}
        {archiving?.archived
          ? 'voltará a aparecer nos novos lançamentos.'
          : 'sairá dos novos lançamentos. O histórico e os vínculos existentes serão preservados.'}
      </ConfirmDialog>
    </section>
  )
}
