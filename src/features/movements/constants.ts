import type { Movement } from '@/domain/models'
export const statusLabels = {
  planned: 'Previsto',
  pending: 'Pendente',
  settled: 'Realizado',
  cancelled: 'Cancelado',
}
export const operationLabels = {
  income: 'Receita',
  expense: 'Despesa',
  'pix-income': 'Pix recebido',
  'pix-expense': 'Pix enviado',
  transfer: 'Transferência entre contas',
  'adjustment-income': 'Ajuste de saldo (+)',
  'adjustment-expense': 'Ajuste de saldo (−)',
}
export type Operation = keyof typeof operationLabels
export const movementLabel = (m: Movement) =>
  m.paymentId
    ? m.paymentReversal
      ? 'Estorno de pagamento de fatura'
      : 'Pagamento de fatura'
    : operationLabels[operationOf(m)]
export function operationOf(m: Movement): Operation {
  return m.kind === 'transfer'
    ? 'transfer'
    : m.kind === 'adjustment'
      ? `adjustment-${m.direction}`
      : m.method === 'pix'
        ? `pix-${m.direction}`
        : m.direction
}
