import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { Movement, MovementStatus, CivilDate } from '@/domain/models'
import { today } from '@/domain/financial-validation'
import { formatMoneyInput, parseBRL } from '@/domain/money'
import { useRepositories } from '@/infrastructure/financial-context'
import type { FinanceData } from '@/hooks/use-finances'
import { Button } from '@/components/ui/button'
import { operationLabels, operationOf, statusLabels } from './constants'
const formSchema = z.object({
  operation: z.enum([
    'income',
    'expense',
    'pix-income',
    'pix-expense',
    'transfer',
    'adjustment-income',
    'adjustment-expense',
  ]),
  description: z.string().trim().min(2, 'Informe uma descrição.').max(160),
  amount: z.string().refine((v) => {
    try {
      return parseBRL(v) > 0
    } catch {
      return false
    }
  }, 'Informe um valor positivo no formato 1.234,56.'),
  accountId: z.string().min(1, 'Selecione uma conta.'),
  destinationAccountId: z.string(),
  categoryId: z.string(),
  date: z.string().min(1, 'Informe a data.'),
  status: z.enum(['planned', 'pending', 'settled', 'cancelled']),
  settledDate: z.string(),
  notes: z.string().max(2000),
  method: z.enum(['pix', 'debit', 'cash', 'other']),
})
type Values = z.infer<typeof formSchema>
export function MovementForm({
  data,
  movement,
  onDone,
  defaultAccountId,
  planned = false,
}: {
  data: FinanceData
  movement?: Movement
  onDone: (message: string) => void
  defaultAccountId?: string
  planned?: boolean
}) {
  const repositories = useRepositories()
  const [error, setError] = useState('')
  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      operation: movement ? operationOf(movement) : 'expense',
      description: movement?.description ?? '',
      amount: movement ? formatMoneyInput(movement.amountCents) : '',
      accountId: movement?.accountId ?? defaultAccountId ?? data.accounts[0]?.id ?? '',
      destinationAccountId: movement?.destinationAccountId ?? '',
      categoryId: movement?.categoryId ?? '',
      date: movement?.date ?? today(),
      status: movement?.status ?? (planned ? 'planned' : 'settled'),
      settledDate:
        movement?.status === 'settled'
          ? (movement.settledDate ?? movement.date)
          : planned
            ? ''
            : today(),
      notes: movement?.notes ?? '',
      method: movement?.method ?? 'debit',
    },
  })
  const operation = useWatch({ control, name: 'operation' }),
    status = useWatch({ control, name: 'status' })
  const direction = operation.endsWith('income') || operation === 'income' ? 'income' : 'expense'
  const categories = data.categories.filter(
    (c) => c.direction === direction && (!c.archived || c.id === movement?.categoryId),
  )
  async function submit(v: Values) {
    setError('')
    try {
      const input = {
        kind:
          v.operation === 'transfer'
            ? ('transfer' as const)
            : v.operation.startsWith('adjustment')
              ? ('adjustment' as const)
              : ('transaction' as const),
        direction:
          v.operation.endsWith('income') || v.operation === 'income'
            ? ('income' as const)
            : ('expense' as const),
        method: v.operation.startsWith('pix') ? ('pix' as const) : v.method,
        description: v.description,
        amountCents: parseBRL(v.amount),
        accountId: v.accountId,
        destinationAccountId: v.destinationAccountId || undefined,
        categoryId: v.categoryId || undefined,
        date: v.date as CivilDate,
        status: v.status,
        settledDate: v.status === 'settled' ? (v.settledDate as CivilDate) : undefined,
        notes: v.notes || undefined,
      }
      if (movement) await repositories.movements.update(movement.kind, movement.id, input)
      else await repositories.movements.create(input)
      onDone(movement ? 'Lançamento atualizado e saldos recalculados.' : 'Lançamento salvo.')
    } catch (e) {
      setError(
        e instanceof z.ZodError
          ? e.issues.map((i) => i.message).join(' ')
          : e instanceof Error
            ? e.message
            : 'Não foi possível salvar o lançamento.',
      )
    }
  }
  return (
    <form className="account-form" onSubmit={handleSubmit(submit)} noValidate>
      <label>
        Tipo de movimentação
        <select {...register('operation', { onChange: () => setValue('categoryId', '') })}>
          {Object.entries(operationLabels).map(([value, label]) => (
            <option
              key={value}
              value={value}
              disabled={
                !!movement &&
                ((movement.kind === 'transfer' && value !== 'transfer') ||
                  (movement.kind === 'adjustment' && !value.startsWith('adjustment')) ||
                  (movement.kind === 'transaction' &&
                    (value === 'transfer' || value.startsWith('adjustment'))))
              }
            >
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Descrição
        <input
          autoFocus
          placeholder="Ex.: Salário, supermercado ou internet"
          {...register('description')}
          aria-invalid={!!errors.description}
        />
        {errors.description && <small className="field-error">{errors.description.message}</small>}
      </label>
      <div className="form-row">
        <label>
          Valor (R$)
          <input
            inputMode="decimal"
            placeholder="0,00"
            {...register('amount')}
            aria-invalid={!!errors.amount}
          />
          {errors.amount && <small className="field-error">{errors.amount.message}</small>}
        </label>
        <label>
          Data da operação / vencimento
          <input
            type="date"
            {...register('date', {
              onChange: (e) => {
                if (!movement && e.target.value > today() && status === 'settled') {
                  setValue('status', 'planned')
                  setValue('settledDate', '')
                }
              },
            })}
            aria-invalid={!!errors.date}
          />
          {errors.date && <small className="field-error">{errors.date.message}</small>}
        </label>
      </div>
      <label>
        {operation === 'transfer' ? 'Conta de origem' : 'Conta bancária'}
        <select {...register('accountId')}>
          <option value="">Selecione uma conta</option>
          {data.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {a.institution}
            </option>
          ))}
        </select>
        {errors.accountId && <small className="field-error">{errors.accountId.message}</small>}
      </label>
      {operation === 'transfer' ? (
        <label>
          Conta de destino
          <select {...register('destinationAccountId')}>
            <option value="">Selecione o destino</option>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.institution}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div className="form-row">
          <label>
            Categoria
            <select {...register('categoryId')}>
              <option value="">Selecione uma categoria</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.archived ? ' (arquivada)' : ''}
                </option>
              ))}
            </select>
          </label>
          {!operation.startsWith('pix') && !operation.startsWith('adjustment') && (
            <label>
              Meio de pagamento
              <select {...register('method')}>
                <option value="debit">Débito</option>
                <option value="cash">Dinheiro</option>
                <option value="pix">Pix</option>
                <option value="other">Outro</option>
              </select>
            </label>
          )}
        </div>
      )}
      <div className="form-row">
        <label>
          Status
          <select
            {...register('status', {
              onChange: (e) => {
                const next = e.target.value as MovementStatus
                setValue('settledDate', next === 'settled' ? today() : '')
              },
            })}
          >
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {status === 'settled' && (
          <label>
            Data real da efetivação
            <input type="date" max={today()} {...register('settledDate')} />
          </label>
        )}
      </div>
      <label>
        Observações (opcional)
        <textarea rows={3} {...register('notes')} />
        {errors.notes && <small className="field-error">{errors.notes.message}</small>}
      </label>
      <p className="form-hint">
        Previstos, pendentes e cancelados não alteram o saldo. Transferências não são receitas ou
        despesas. Ajustes corrigem o saldo sem alterar os indicadores de consumo.
      </p>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <Button type="submit" disabled={isSubmitting || !!data.error}>
          {isSubmitting ? 'Salvando…' : movement ? 'Salvar alterações' : 'Salvar lançamento'}
        </Button>
      </div>
    </form>
  )
}
