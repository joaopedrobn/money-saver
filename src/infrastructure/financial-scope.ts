export interface FinancialScope {
  projectUrl: string
  userId: string
}
export function financialDatabaseName(scope: FinancialScope | null) {
  return scope
    ? `money-saver-account:${encodeURIComponent(scope.projectUrl)}:${encodeURIComponent(scope.userId)}`
    : 'money-saver'
}
