import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { format } from 'date-fns'
import { LoaderCircle, Check } from 'lucide-react'
import { accountFormSchema, type AccountFormValues } from '@/domain/validation'
import type { BankAccount, CivilDate } from '@/domain/models'
import { parseBRL, formatMoneyInput } from '@/domain/money'
import { repositories } from '@/infrastructure/repositories'
import { Button } from '@/components/ui/button'
import { accountTypes, accountColors } from './constants'
export function AccountForm({
  account,
  onDone,
  onCancel,
}: {
  account?: BankAccount
  onDone: () => void
  onCancel: () => void
}) {
  const [error, setError] = useState('')
  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: {
      name: account?.name ?? '',
      institution: account?.institution ?? '',
      type: account?.type ?? 'checking',
      openingBalance: account ? formatMoneyInput(account.openingBalanceCents) : '0,00',
      openingDate: account?.openingDate ?? format(new Date(), 'yyyy-MM-dd'),
      color: (account?.color as AccountFormValues['color']) ?? 'sage',
    },
  })
  const color = useWatch({ control, name: 'color' })
  async function submit(values: AccountFormValues) {
    setError('')
    try {
      const input = {
        name: values.name,
        institution: values.institution,
        type: values.type,
        openingBalanceCents: parseBRL(values.openingBalance),
        openingDate: values.openingDate as CivilDate,
        color: values.color,
      }
      if (account) await repositories.accounts.update(account.id, input)
      else await repositories.accounts.create(input)
      onDone()
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Não foi possível salvar. Verifique se o navegador permite armazenamento local.',
      )
    }
  }
  return (
    <form onSubmit={handleSubmit(submit)} className="account-form" noValidate>
      <label>
        Nome da conta
        <input
          autoFocus
          placeholder="Ex.: Minha conta principal"
          {...register('name')}
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? 'name-error' : undefined}
        />
        {errors.name && (
          <small id="name-error" className="field-error">
            {errors.name.message}
          </small>
        )}
      </label>
      <div className="form-row">
        <label>
          Instituição
          <input
            placeholder="Ex.: Nubank, Itaú ou carteira"
            {...register('institution')}
            aria-invalid={!!errors.institution}
          />
          {errors.institution && (
            <small className="field-error">{errors.institution.message}</small>
          )}
        </label>
        <label>
          Tipo de conta
          <select {...register('type')}>
            {Object.entries(accountTypes).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-row">
        <label>
          Saldo inicial (R$)
          <input
            inputMode="decimal"
            {...register('openingBalance')}
            aria-invalid={!!errors.openingBalance}
          />
          {errors.openingBalance && (
            <small className="field-error">{errors.openingBalance.message}</small>
          )}
        </label>
        <label>
          Data do saldo inicial
          <input
            type="date"
            max={format(new Date(), 'yyyy-MM-dd')}
            {...register('openingDate')}
            aria-invalid={!!errors.openingDate}
          />
          {errors.openingDate && (
            <small className="field-error">{errors.openingDate.message}</small>
          )}
        </label>
      </div>
      <p className="form-hint">
        O saldo inicial é o ponto de partida da conta, sem criar uma receita.
      </p>
      <fieldset>
        <legend>Cor da conta</legend>
        <div className="color-options">
          {Object.entries(accountColors).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`color-choice ${value}`}
              aria-label={label}
              aria-pressed={color === value}
              onClick={() =>
                setValue('color', value as AccountFormValues['color'], { shouldDirty: true })
              }
            >
              {color === value && <Check size={17} />}
            </button>
          ))}
        </div>
      </fieldset>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <Button variant="outline" type="button" onClick={onCancel} disabled={isSubmitting}>
          Cancelar
        </Button>
        <Button disabled={isSubmitting} type="submit">
          {isSubmitting && <LoaderCircle className="spin" size={16} />}{' '}
          {account ? 'Salvar alterações' : 'Criar conta'}
        </Button>
      </div>
    </form>
  )
}
