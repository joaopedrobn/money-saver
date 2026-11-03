import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { repositories } from '@/infrastructure/repositories'
import { sumCents } from '@/domain/money'
import { balancesAt, bankMovementsFrom } from '@/domain/finance'
import { today } from '@/domain/financial-validation'
import type { CreditSnapshot } from '@/domain/models'
const empty: CreditSnapshot = {
  accounts: [],
  transactions: [],
  transfers: [],
  payments: [],
  adjustments: [],
  categories: [],
  cards: [],
  purchases: [],
  installments: [],
  invoices: [],
  invoiceEntries: [],
  settings: [],
}
export function useFinances() {
  const [date, setDate] = useState(today)
  useEffect(() => {
    const timer = window.setInterval(() => setDate(today()), 30_000)
    return () => clearInterval(timer)
  }, [])
  return useLiveQuery(async () => {
    try {
      const snapshot = await repositories.snapshot()
      const balances = balancesAt(snapshot, today())
      return {
        ...snapshot,
        balances,
        total: sumCents(Object.values(balances)),
        movements: bankMovementsFrom(snapshot),
        error: '',
      }
    } catch (e) {
      return {
        ...empty,
        movements: [],
        balances: {} as Record<string, number>,
        total: 0,
        error: e instanceof Error ? e.message : 'O armazenamento local não está disponível.',
      }
    }
  }, [date])
}
export type FinanceData = NonNullable<ReturnType<typeof useFinances>>
