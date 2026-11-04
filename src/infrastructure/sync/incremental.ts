import { z } from 'zod'
import {
  decodeRemoteBackup,
  fromRemoteRow,
  toRemoteRow,
  type RemoteEntity,
} from '../supabase/mapping'
import { canonicalJson, entities, reconciliationManifest } from './protocol'
import type { Backup } from '@/domain/backup'
import type { CivilDate } from '@/domain/models'
import { purchaseHasHistory } from '@/domain/credit-integrity'

export type WireData = Record<RemoteEntity, Record<string, unknown>[]>
const changeSchema = z
  .object({
    entity: z.enum(entities as [RemoteEntity, ...RemoteEntity[]]),
    id: z.uuid(),
    row: z.record(z.string(), z.unknown()).nullable(),
  })
  .strict()
export const deltaSchema = z
  .object({
    protocol: z.literal(2),
    asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    changes: z.array(changeSchema).min(1).max(1000),
  })
  .strict()
export type Delta = z.infer<typeof deltaSchema>
export function wireData(backup: Backup, owner: string): WireData {
  return Object.fromEntries(
    entities.map((e) => [e, backup.data[e].map((r) => toRemoteRow(e, r, owner))]),
  ) as WireData
}
export function diffData(before: WireData, after: WireData, asOf: CivilDate): Delta {
  const changes: Delta['changes'] = []
  for (const entity of entities) {
    const old = new Map(before[entity].map((r) => [String(r.id), r]))
    const next = new Map(after[entity].map((r) => [String(r.id), r]))
    for (const [id, row] of next)
      if (canonicalJson(old.get(id) ?? null) !== canonicalJson(row))
        changes.push({ entity, id, row })
    for (const id of old.keys()) if (!next.has(id)) changes.push({ entity, id, row: null })
  }
  return deltaSchema.parse({ protocol: 2, asOf, changes })
}
export function applyDelta(before: WireData, value: unknown, owner: string): WireData {
  const delta = deltaSchema.parse(value)
  // PostgreSQL timestamptz uses +00:00 while IDB uses .000Z; compare domain-normalized rows.
  const source = decodeRemoteBackup(before, owner)
  const data = wireData(source, owner)
  const seen = new Set<string>()
  for (const change of delta.changes) {
    const key = `${change.entity}:${change.id}`
    if (seen.has(key)) throw new Error('Registro repetido no mesmo conjunto.')
    seen.add(key)
    const rows = data[change.entity]
    const index = rows.findIndex((r) => r.id === change.id)
    const old = index < 0 ? null : rows[index]
    if (change.row && (change.row.user_id !== owner || change.row.id !== change.id))
      throw new Error('Proprietário ou UUID divergente.')
    if (old && change.row && old.created_at !== change.row.created_at)
      throw new Error('A criação original do registro deve ser preservada.')
    if (
      old &&
      change.row &&
      change.entity === 'accounts' &&
      (old.opening_balance_cents !== change.row.opening_balance_cents ||
        old.opening_date !== change.row.opening_date)
    ) {
      const linked = ['transactions', 'payments', 'transfers', 'adjustments'].some((e) =>
        before[e as RemoteEntity].some((r) =>
          ['account_id', 'source_account_id', 'destination_account_id'].some(
            (k) => r[k] === change.id,
          ),
        ),
      )
      if (linked) throw new Error('Conta com movimentações exige ajuste de saldo explícito.')
    }
    if (
      old?.status === 'cancelled' &&
      change.entity === 'purchases' &&
      change.row?.status !== 'cancelled'
    )
      throw new Error('Compra cancelada não pode ser reativada por mesclagem.')
    // Historical facts are retained. Corrections use the existing domain reversal paths.
    const financialPurchaseFields = [
      'card_id',
      'category_id',
      'amount_cents',
      'date',
      'installment_count',
      'fee_cents',
    ]
    const protectedPurchase =
      change.entity === 'purchases' && purchaseHasHistory(source.data, change.id)
    if (old && change.row && change.entity === 'purchases') {
      if (old.status === 'cancelled' && canonicalJson(old) !== canonicalJson(change.row))
        throw new Error('Compra cancelada não pode ser alterada.')
      if (
        protectedPurchase &&
        (change.row.status === 'cancelled' ||
          financialPurchaseFields.some(
            (k) => canonicalJson(old[k] ?? 0) !== canonicalJson(change.row![k] ?? 0),
          ))
      )
        throw new Error(
          'Compra com histórico de liquidação ou estorno exige preservação das parcelas.',
        )
    }
    const editableInstallment =
      old &&
      change.entity === 'installments' &&
      !purchaseHasHistory(source.data, String(old.purchase_id)) &&
      delta.changes.some(
        (c) => c.entity === 'purchases' && c.id === old.purchase_id && c.row !== null,
      )
    if (
      old &&
      change.row &&
      change.entity === 'installments' &&
      change.row.purchase_id !== old.purchase_id
    )
      throw new Error('Parcela não pode ser transferida para outra compra.')
    if (
      old &&
      ['audit', 'payments', 'invoiceEntries', 'installments', 'purchases'].includes(
        change.entity,
      ) &&
      !editableInstallment
    ) {
      if (!change.row) throw new Error('Histórico financeiro não pode ser apagado.')
      let paymentCorrection = false
      if (change.entity === 'payments') {
        if (change.row.invoice_id !== old.invoice_id)
          throw new Error('A correção deve permanecer na mesma fatura.')
        paymentCorrection = ['account_id', 'amount_cents', 'date', 'notes'].some(
          (k) => canonicalJson(old[k] ?? null) !== canonicalJson(change.row![k] ?? null),
        )
        if (
          paymentCorrection &&
          !delta.changes.some(
            (c) =>
              c.entity === 'audit' &&
              c.row &&
              !source.data.audit.some((a) => a.id === c.id) &&
              c.row.entity_id === change.id &&
              c.row.entity_type === 'payment' &&
              c.row.action === 'update' &&
              canonicalJson(c.row.before_data) ===
                canonicalJson(fromRemoteRow('payments', old, owner)) &&
              canonicalJson(c.row.after_data) ===
                canonicalJson(fromRemoteRow('payments', change.row!, owner)),
          )
        )
          throw new Error(
            'Correção de pagamento exige auditoria completa do histórico anterior e posterior.',
          )
      }
      const mutable =
        change.entity === 'payments'
          ? [
              'updated_at',
              'reversal_date',
              'reversal_reason',
              'reversed_at',
              ...(paymentCorrection ? ['account_id', 'amount_cents', 'date', 'notes'] : []),
            ]
          : change.entity === 'purchases'
            ? [
                'updated_at',
                'status',
                'cancellation_reason',
                'description',
                'notes',
                ...(!protectedPurchase ? financialPurchaseFields : []),
              ]
            : []
      for (const key of new Set([...Object.keys(old), ...Object.keys(change.row)]))
        if (
          !mutable.includes(key) &&
          canonicalJson(old[key] ?? null) !== canonicalJson(change.row[key] ?? null)
        )
          throw new Error('Alteração de histórico exige uma operação financeira explícita.')
      if (
        change.entity === 'payments' &&
        old.reversed_at &&
        canonicalJson(old) !== canonicalJson(change.row)
      )
        throw new Error('Pagamento já estornado é imutável.')
    }
    if (index >= 0) rows.splice(index, 1)
    if (change.row) rows.push(change.row)
  }
  decodeRemoteBackup(data, owner) // Existing reference, cents, invoice and payment validations.
  return data
}
export async function validateDelta(before: WireData, value: unknown, owner: string) {
  const delta = deltaSchema.parse(value)
  const data = applyDelta(before, delta, owner)
  const manifest = await reconciliationManifest(
    decodeRemoteBackup(data, owner),
    delta.asOf as CivilDate,
  )
  return { data, manifest }
}
