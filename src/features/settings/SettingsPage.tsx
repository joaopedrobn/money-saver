import type { FinanceData } from '@/hooks/use-finances'
import { CategoriesPanel } from '@/features/categories/CategoriesPanel'
import { BackupPanel } from '@/features/backup/BackupPanel'
import { useFinancialStorage } from '@/infrastructure/financial-context'
import { SyncSettings } from './SyncSettings'
import { useContext } from 'react'
import { SyncSettingsContext } from './sync-settings-context'
export function SettingsPage({
  data,
  notify,
  hidden,
}: {
  data: FinanceData
  notify: (message: string) => void
  hidden: boolean
}) {
  const { kind } = useFinancialStorage()
  const sync = useContext(SyncSettingsContext)
  return (
    <>
      <div className="settings-grid">
        <BackupPanel notify={notify} hidden={hidden} allowRestore={!sync} />
        <SyncSettings />
        <section className="panel settings-panel">
          <h2>Seu espaço financeiro</h2>
          <p>
            {sync
              ? 'Réplica de homologação com IndexedDB e PostgreSQL locais.'
              : 'Dados financeiros locais, sem sincronização externa.'}
          </p>
          <p>
            {sync
              ? 'Somente dados fictícios. As operações usam fila persistente e o Worker local; produção continua desativada.'
              : kind === 'account'
                ? 'Este espaço é separado por conta somente neste navegador. Os registros não foram enviados para a conta online e não aparecem em outros dispositivos.'
                : 'Este espaço sem conta é compartilhado por quem usa este perfil de navegador. Ele não pertence a uma conta conectada e não é sincronizado.'}
          </p>
          <p>Perfil, troca de conta e saída estão no menu de usuário no canto superior.</p>
          <dl>
            <div>
              <dt>Moeda</dt>
              <dd>Real brasileiro · BRL</dd>
            </div>
            <div>
              <dt>Aparência</dt>
              <dd>Escuro</dd>
            </div>
            <div>
              <dt>Contas salvas</dt>
              <dd>{data.accounts.length}</dd>
            </div>
            <div>
              <dt>Movimentações salvas</dt>
              <dd>{data.movements.length}</dd>
            </div>
            <div>
              <dt>Local dos dados</dt>
              <dd>{sync ? 'Réplica IndexedDB e PostgreSQL local' : 'Este dispositivo e navegador'}</dd>
            </div>
          </dl>
          <p>
            Contas, cartões, faturas e parcelas funcionam com registros locais e pagamentos manuais.
            Recorrências são projetadas automaticamente e efetivadas por confirmação. Open Finance
            fica para as próximas etapas.
          </p>
        </section>
      </div>
      <CategoriesPanel categories={data.categories} notify={notify} />
    </>
  )
}
