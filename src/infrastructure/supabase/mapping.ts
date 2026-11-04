import { validateBackup, type Backup } from '@/domain/backup'
import { assertCents } from '@/domain/money'

/** Explicit allowlist, shared by decoding and the future import planner. No I/O. */
export const remoteFields = {
  accounts: 'id createdAt updatedAt name institution type openingBalanceCents openingDate color',
  categories: 'id createdAt updatedAt name direction color icon archived',
  cards:
    'id createdAt updatedAt accountId name limitCents closingDay dueDay institution nickname brand lastFour color archived',
  recurring:
    'id createdAt updatedAt accountId categoryId description direction amountCents startDate endDate dayOfMonth frequency active cardId ended',
  transactions:
    'id createdAt updatedAt accountId categoryId description amountCents direction method date status settledDate recurringId notes',
  transfers:
    'id createdAt updatedAt sourceAccountId destinationAccountId amountCents date description status settledDate notes',
  adjustments:
    'id createdAt updatedAt accountId deltaCents date reason categoryId status settledDate notes',
  purchases:
    'id createdAt updatedAt cardId categoryId description amountCents date installmentCount feeCents notes status cancellationReason',
  invoices:
    'id createdAt updatedAt cardId period closingDate dueDate startDate closingDaySnapshot dueDaySnapshot',
  installments: 'id createdAt updatedAt purchaseId invoiceId number amountCents principalCents',
  payments:
    'id createdAt updatedAt invoiceId accountId amountCents date reversalDate reversalReason reversedAt notes',
  invoiceEntries:
    'id createdAt updatedAt invoiceId kind amountCents date description purchaseId categoryId transferId originalEntryId',
  occurrences: 'id createdAt updatedAt recurringId date transactionId purchaseId',
  budgets: 'id createdAt updatedAt month categoryId amountCents',
  settings: 'id createdAt updatedAt currency locale theme weekStartsOn creditRegime',
  audit: 'id entityId entityType action at before after',
} as const satisfies Record<keyof Backup['data'], string>
export type RemoteEntity = keyof typeof remoteFields
export const sqlTable = (entity: RemoteEntity) =>
  `ms_${entity.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`
const column = (field: string) =>
  field === 'before' || field === 'after'
    ? `${field}_data`
    : field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function validateField(field: string, value: unknown) {
  if ((field === 'id' || field.endsWith('Id')) && (typeof value !== 'string' || !uuid.test(value)))
    throw new Error('UUID remoto inválido; nenhum identificador será regenerado automaticamente.')
  if (field.endsWith('Cents')) {
    if (typeof value !== 'number') throw new Error('Centavos remotos devem ser inteiros seguros.')
    assertCents(value)
  }
}
export function toRemoteRow(
  entity: RemoteEntity,
  value: object,
  userId: string,
): Record<string, unknown> {
  validateField('id', userId)
  const fields = remoteFields[entity].split(' ')
  const row: Record<string, unknown> = { user_id: userId }
  for (const [field, item] of Object.entries(value)) {
    if (!fields.includes(field)) throw new Error(`Campo não permitido em ${entity}.`)
    if (item === undefined) continue
    validateField(field, item)
    row[column(field)] = item
  }
  return row
}
export function fromRemoteRow(
  entity: RemoteEntity,
  row: Record<string, unknown>,
  userId: string,
): Record<string, unknown> {
  validateField('id', userId)
  if (row.user_id !== userId) throw new Error('Registro remoto pertence a outro usuário.')
  const fields = remoteFields[entity].split(' ')
  const allowed = ['user_id', ...fields.map(column)]
  if (Object.keys(row).some((key) => !allowed.includes(key)))
    throw new Error(`Coluna inesperada em ${entity}.`)
  const value: Record<string, unknown> = {}
  for (const field of fields) {
    let item = row[column(field)]
    if (item === undefined || item === null) continue
    validateField(field, item)
    if (['createdAt', 'updatedAt', 'reversedAt', 'at'].includes(field)) {
      if (typeof item !== 'string' || Number.isNaN(Date.parse(item)))
        throw new Error('Instante remoto inválido.')
      item = new Date(item).toISOString()
    }
    value[field] = item
  }
  return value
}
export function decodeRemoteBackup(value: unknown, userId: string): Backup {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Snapshot remoto inválido.')
  const source = value as Record<string, unknown>
  const data: Record<string, unknown> = {}
  for (const entity of Object.keys(remoteFields) as RemoteEntity[]) {
    const rows = source[entity]
    if (!Array.isArray(rows)) throw new Error(`Tabela remota ausente: ${entity}.`)
    data[entity] = rows.map((row: unknown) => {
      if (!row || typeof row !== 'object' || Array.isArray(row))
        throw new Error('Registro remoto inválido.')
      return fromRemoteRow(entity, row as Record<string, unknown>, userId)
    })
  }
  return validateBackup({
    app: 'money-saver',
    version: 2,
    schemaVersion: 4,
    exportedAt: new Date().toISOString(),
    data,
  })
}
