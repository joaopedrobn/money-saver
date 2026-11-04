export interface SyncState {
  enabled: boolean
  phase:
    | 'disabled'
    | 'local'
    | 'offline'
    | 'prepared'
    | 'sending'
    | 'outcome-unknown'
    | 'awaiting-verification'
    | 'verified'
    | 'conflict'
    | 'error'
  operationId: string | null
  lastCompletedAt: string | null
  lastServerCommittedAt?: string | null
  pending: number | null
  message: string
}
export const disabledSyncState: SyncState = {
  enabled: false,
  phase: 'disabled',
  operationId: null,
  lastCompletedAt: null,
  pending: null,
  message: '',
}
export type SyncEvent =
  | { type: 'prepared'; operationId: string; pending: number }
  | { type: 'sending' }
  | { type: 'connection-lost'; operationId: string }
  | { type: 'committed'; operationId: string }
  | { type: 'reconciled'; operationId: string; at: string }
  | { type: 'conflict'; message: string }
/** Contract for a future durable outbox. No queue, timer or automatic retry is activated. */
export function reduceSync(state: SyncState, event: SyncEvent): SyncState {
  if (!state.enabled) return disabledSyncState
  if (
    event.type !== 'prepared' &&
    'operationId' in event &&
    event.operationId !== state.operationId
  )
    return state
  if (
    event.type === 'prepared' &&
    state.phase === 'prepared' &&
    event.operationId === state.operationId
  )
    return state
  if (event.type === 'prepared' && ['disabled', 'verified'].includes(state.phase))
    return {
      ...state,
      phase: 'prepared',
      operationId: event.operationId,
      pending: event.pending,
      message: '',
    }
  if (event.type === 'sending' && ['prepared', 'outcome-unknown'].includes(state.phase))
    return { ...state, phase: 'sending' }
  if (event.type === 'connection-lost' && state.phase === 'sending')
    return {
      ...state,
      phase: 'outcome-unknown',
      message: 'Resultado desconhecido. Consultar/repetir a mesma operação antes de prosseguir.',
    }
  if (event.type === 'committed' && ['awaiting-verification', 'verified'].includes(state.phase))
    return state
  if (event.type === 'committed' && ['sending', 'outcome-unknown'].includes(state.phase))
    return { ...state, phase: 'awaiting-verification' }
  if (event.type === 'reconciled' && state.phase === 'verified') return state
  if (
    event.type === 'reconciled' &&
    state.phase === 'awaiting-verification' &&
    event.operationId === state.operationId
  )
    return { ...state, phase: 'verified', lastCompletedAt: event.at, pending: 0 }
  if (event.type === 'conflict') return { ...state, phase: 'conflict', message: event.message }
  throw new Error('Transição de sincronização inválida.')
}
