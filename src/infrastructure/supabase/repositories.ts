import type { SupabaseClient } from '@supabase/supabase-js'
import type { FinancialRepositories, ReadRepository } from '@/domain/repositories'
import type { CreditSnapshot, Entity } from '@/domain/models'
import { validateBackup, type Backup } from '@/domain/backup'
import { bankMovementsFrom } from '@/domain/finance'
import { decodeRemoteBackup } from './mapping'

export const remoteWritesUnavailable = async (): Promise<never> => {
  throw new Error(
    'Escritas remotas bloqueadas na fase 3.1. São necessárias operações transacionais e migração explícita.',
  )
}
/** Staged adapter. Never selected by the application; reads require a verified identity.
 * The RPC reads all entities in one SQL statement, avoiding a torn multi-request snapshot. */
export function createSupabaseRepositories(client: SupabaseClient): FinancialRepositories {
  const backup = async (): Promise<Backup> => {
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser()
    if (authError || !user) throw new Error('Autenticação remota necessária.')
    const { data, error } = await client.rpc('ms_snapshot')
    if (error)
      throw new Error('Não foi possível ler o snapshot remoto. Confira as migrações e a sessão.')
    const {
      data: { user: currentUser },
      error: currentError,
    } = await client.auth.getUser()
    if (currentError || currentUser?.id !== user.id)
      throw new Error('A sessão mudou durante a leitura remota.')
    return decodeRemoteBackup(data, user.id)
  }
  const snapshot = async (): Promise<CreditSnapshot> => (await backup()).data
  const read = <T extends Entity>(select: (snapshot: CreditSnapshot) => T[]): ReadRepository<T> => {
    const list = async () => select(await snapshot())
    return { list, get: async (id) => (await list()).find((r) => r.id === id) }
  }
  const blocked = remoteWritesUnavailable
  return {
    snapshot,
    accounts: { ...read((s) => s.accounts), create: blocked, update: blocked, remove: blocked },
    categories: {
      ...read((s) => s.categories),
      create: blocked,
      update: blocked,
      archive: blocked,
    },
    cards: read((s) => s.cards),
    transactions: read((s) => s.transactions),
    purchases: read((s) => s.purchases),
    installments: read((s) => s.installments),
    invoices: read((s) => s.invoices),
    payments: read((s) => s.payments),
    recurring: read((s) => s.recurring ?? []),
    transfers: read((s) => s.transfers),
    adjustments: read((s) => s.adjustments),
    settings: { ...read((s) => s.settings), setCreditRegime: blocked },
    movements: {
      list: async () => bankMovementsFrom(await snapshot()),
      create: blocked,
      update: blocked,
      remove: blocked,
      settle: blocked,
    },
    planning: {
      saveRecurring: blocked,
      status: blocked,
      realize: blocked,
      saveBudget: blocked,
      removeBudget: blocked,
    },
    credit: {
      createCard: blocked,
      updateCard: blocked,
      archiveCard: blocked,
      createPurchase: blocked,
      updatePurchase: blocked,
      cancelPurchase: blocked,
      refundPurchase: blocked,
      pay: blocked,
      correctPayment: blocked,
      reversePayment: blocked,
      addCharge: blocked,
      applyCredit: blocked,
      reverseCharge: blocked,
    },
    backup: { export: backup, preview: validateBackup, restore: blocked },
  }
}
