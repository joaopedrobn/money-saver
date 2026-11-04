import { disabledSyncState, type SyncState } from '@/infrastructure/sync/state'

export function SyncStatus({ state = disabledSyncState }: { state?: SyncState }) {
  const phases: Record<SyncState['phase'], string> = {
    disabled: 'Desativada',
    local: 'Somente local',
    offline: 'Offline — operações preservadas neste navegador',
    prepared: 'Pendente',
    sending: 'Sincronizando',
    'outcome-unknown': 'Resultado a confirmar',
    'awaiting-verification': 'Verificação pendente',
    verified: 'Sincronizada — verificação concluída',
    conflict: 'Conflito que exige atenção',
    error: 'Erro — operação ou verificação exige revisão',
  }
  return (
    <section className="panel settings-panel" aria-label="Estado da sincronização">
      <h2>{state.enabled ? 'Estado da sincronização' : 'Sincronização desativada'}</h2>
      <p>
        {state.enabled
          ? 'Confira o estado da operação e a verificação dos dados.'
          : 'Seus dados financeiros continuam somente neste navegador.'}
      </p>
      <dl>
        <div>
          <dt>Estado</dt>
          <dd role="status">
            {state.enabled
              ? phases[
                  state.phase === 'verified' && (state.pending !== 0 || !state.lastCompletedAt)
                    ? 'prepared'
                    : state.phase
                ]
              : phases.disabled}
          </dd>
        </div>
        {state.enabled && (
          <div>
            <dt>Última confirmação do servidor</dt>
            <dd>{state.lastServerCommittedAt ?? 'Nenhum recibo confirmado'}</dd>
          </div>
        )}
        <div>
          <dt>Última sincronização concluída</dt>
          <dd>
            {state.enabled && state.lastCompletedAt ? state.lastCompletedAt : 'Nenhuma nesta fase'}
          </dd>
        </div>
        <div>
          <dt>Dados locais pendentes</dt>
          <dd>
            {state.enabled && state.pending !== null
              ? state.pending
              : 'Não monitorados enquanto a sincronização está desativada'}
          </dd>
        </div>
        {state.enabled && state.message && (
          <div>
            <dt>
              {state.phase === 'conflict'
                ? 'Conflito que exige atenção'
                : 'Conexão ou operação pendente'}
            </dt>
            <dd role="status">{state.message}</dd>
          </div>
        )}
      </dl>
    </section>
  )
}
