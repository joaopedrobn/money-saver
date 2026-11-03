import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import type { CreditCard } from '@/domain/models'
import type { FinanceData } from '@/hooks/use-finances'
import { formatMoneyInput, parseBRL } from '@/domain/money'
import { repositories } from '@/infrastructure/repositories'
import { Button } from '@/components/ui/button'
import { accountColors } from '@/features/accounts/constants'
export function CardForm({
  data,
  card,
  onDone,
}: {
  data: FinanceData
  card?: CreditCard
  onDone: () => void
}) {
  const [error, setError] = useState('')
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm({
    defaultValues: {
      name: card?.name ?? '',
      institution: card?.institution ?? '',
      nickname: card?.nickname ?? '',
      brand: card?.brand ?? '',
      lastFour: card?.lastFour ?? '',
      color: card?.color ?? 'sage',
      accountId: card?.accountId ?? data.accounts[0]?.id ?? '',
      limit: card ? formatMoneyInput(card.limitCents) : '',
      closingDay: card?.closingDay ?? 10,
      dueDay: card?.dueDay ?? 20,
    },
  })
  return (
    <form
      className="account-form"
      onSubmit={handleSubmit(async (values) => {
        setError('')
        try {
          const { limit, ...rest } = values
          const input = { ...rest, limitCents: parseBRL(limit) }
          if (card) await repositories.credit.updateCard(card.id, input)
          else await repositories.credit.createCard(input)
          onDone()
        } catch (e) {
          setError(
            e instanceof z.ZodError
              ? e.issues.map((i) => i.message).join(' ')
              : e instanceof Error
                ? e.message
                : 'Não foi possível salvar.',
          )
        }
      })}
    >
      <label>
        Nome do cartão
        <input autoFocus required minLength={2} maxLength={60} {...register('name')} />
      </label>
      <div className="form-row">
        <label>
          Instituição financeira
          <input required minLength={2} maxLength={60} {...register('institution')} />
        </label>
        <label>
          Apelido
          <input maxLength={60} {...register('nickname')} />
        </label>
      </div>
      <div className="form-row">
        <label>
          Bandeira (opcional)
          <input maxLength={30} placeholder="Ex.: Visa" {...register('brand')} />
        </label>
        <label>
          Últimos quatro dígitos (opcional)
          <input
            inputMode="numeric"
            maxLength={4}
            pattern="[0-9]{4}|"
            autoComplete="off"
            {...register('lastFour')}
          />
        </label>
      </div>
      <label>
        Limite total (R$)
        <input required inputMode="decimal" placeholder="0,00" {...register('limit')} />
      </label>
      <div className="form-row">
        <label>
          Dia de fechamento
          <input
            type="number"
            required
            min={1}
            max={31}
            {...register('closingDay', { valueAsNumber: true })}
          />
        </label>
        <label>
          Dia de vencimento
          <input
            type="number"
            required
            min={1}
            max={31}
            {...register('dueDay', { valueAsNumber: true })}
          />
        </label>
      </div>
      <label>
        Conta sugerida para pagamento
        <select required {...register('accountId')}>
          <option value="">Selecione uma conta</option>
          {data.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {a.institution}
            </option>
          ))}
        </select>
      </label>
      <label>
        Cor
        <select {...register('color')}>
          {Object.entries(accountColors).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <p className="form-hint">
        O vínculo apenas sugere a conta: nenhum pagamento é automático. Mudanças de fechamento e
        vencimento valem para ciclos ainda não criados; faturas e parcelas existentes preservam suas
        datas. Não informe número completo, CVV ou senha.
      </p>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <Button type="submit" disabled={isSubmitting || !data.accounts.length}>
          {isSubmitting ? 'Salvando…' : card ? 'Salvar cartão' : 'Cadastrar cartão'}
        </Button>
      </div>
    </form>
  )
}
