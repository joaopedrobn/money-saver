import { createContext, useContext } from 'react'
import { FinancialDatabase } from './database'
import { createLocalRepositories, repositories } from './repositories'

import { financialDatabaseName, type FinancialScope } from './financial-scope'
export { financialDatabaseName, type FinancialScope } from './financial-scope'
const anonymous = { repositories, kind: 'anonymous' as const }
export const FinancialWorkspaceContext = createContext<{
  repositories: typeof repositories
  kind: 'anonymous' | 'account'
}>(anonymous)
const workspaces = new Map<string, ReturnType<typeof createLocalRepositories>>()
export function getFinancialWorkspace(scope: FinancialScope | null) {
  if (!scope) return anonymous
  const name = financialDatabaseName(scope)
  let local = workspaces.get(name)
  if (!local) {
    local = createLocalRepositories(new FinancialDatabase(name))
    workspaces.set(name, local)
  }
  // Retain open instances: pending operations keep their original repository and dataset.
  return { repositories: local, kind: 'account' as const }
}
export const useFinancialStorage = () => useContext(FinancialWorkspaceContext)
export const useRepositories = () => useFinancialStorage().repositories
