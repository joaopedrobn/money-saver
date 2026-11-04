import type { FinanceData } from '@/hooks/use-finances'
import { CategoriesPanel } from '@/features/categories/CategoriesPanel'
import { BackupPanel } from '@/features/backup/BackupPanel'
export function SettingsPage({
  data,
  notify,
  hidden,
}: {
  data: FinanceData
  notify: (message: string) => void
  hidden: boolean
}) {
  return (
    <>
      <div className="settings-grid">
        <BackupPanel notify={notify} hidden={hidden} />
        <section className="panel settings-panel">
          <h2>Seu espaço financeiro</h2>
          <p>Dados financeiros locais, sem sincronização externa.</p>
          <p>
            <a className="text-link" href="#online">
              Conta online · autenticação opcional
            </a>
          </p>
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
              <dd>Este dispositivo e navegador</dd>
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
