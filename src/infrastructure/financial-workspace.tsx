import { useMemo, type ReactNode } from 'react'
import {
  FinancialWorkspaceContext,
  getFinancialWorkspace,
  type FinancialScope,
} from './financial-context'

/** Separate browser datasets. Never copies, assigns or deletes the anonymous database. */
export function LocalFinanceProvider({
  scope,
  children,
}: {
  scope: FinancialScope | null
  children: ReactNode
}) {
  const projectUrl = scope?.projectUrl
  const userId = scope?.userId
  const value = useMemo(() => {
    return getFinancialWorkspace(projectUrl && userId ? { projectUrl, userId } : null)
  }, [projectUrl, userId])
  return (
    <FinancialWorkspaceContext.Provider value={value}>
      {children}
    </FinancialWorkspaceContext.Provider>
  )
}
