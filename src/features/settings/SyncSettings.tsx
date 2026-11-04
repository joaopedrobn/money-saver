import { useContext, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Button } from '@/components/ui/button'
import { formatMoney } from '@/domain/money'
import type { SyncClient } from '@/infrastructure/sync/outbox'
import { SyncSettingsContext } from './sync-settings-context'
import { SyncStatus } from './SyncStatus'
import './sync-settings.css'

type Migration = Awaited<ReturnType<SyncClient['prepareMigration']>>
const names: Record<string, string> = {
  accounts: 'Contas',
  categories: 'Categorias',
  cards: 'Cartões',
  recurring: 'Recorrências',
  transactions: 'Receitas e despesas',
  transfers: 'Transferências',
  adjustments: 'Ajustes',
  purchases: 'Compras',
  invoices: 'Faturas',
  installments: 'Parcelas',
  payments: 'Pagamentos',
  invoiceEntries: 'Lançamentos de fatura',
  occurrences: 'Ocorrências',
  budgets: 'Orçamentos',
  settings: 'Preferências',
  audit: 'Auditoria',
}
function download(migration: Migration) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(migration.backup, null, 2)], { type: 'application/json' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = `money-saver-homologacao-${migration.plan.operationId}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function SyncSettings() {
  const client = useContext(SyncSettingsContext)
  return client ? <ConnectedSyncSettings key={client.db.name} client={client} /> : <SyncStatus />
}
function ConnectedSyncSettings({ client }: { client: SyncClient }) {
  const [version, setVersion] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [migration, setMigration] = useState<Migration | null>(null)
  const [downloaded, setDownloaded] = useState(false),
    [saved, setSaved] = useState(false)
  const [confirmation, setConfirmation] = useState(''),
    [resolution, setResolution] = useState(''),
    [retry, setRetry] = useState('')
  const view = useLiveQuery(
    async () => ({ state: await client.status(), pending: await client.pending() }),
    [client, version],
  )
  async function act(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Não foi possível concluir. Os dados foram preservados.',
      )
    } finally {
      setBusy(false)
      setVersion((v) => v + 1)
    }
  }
  const first = view?.pending[0]
  return (
    <div>
      <SyncStatus
        state={view ? { ...view.state, ...(busy ? { phase: 'sending' as const } : {}) } : undefined}
      />
      <section
        className="panel settings-panel sync-controls"
        aria-label="Controles de sincronização local"
        aria-busy={busy}
      >
        <h2>Sincronização em homologação local</h2>
        <p>
          Somente dados fictícios e PostgreSQL local. A sincronização de produção permanece
          desativada.
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="form-actions">
          <Button
            disabled={busy || !view || view.state.phase === 'local'}
            onClick={() =>
              void act(async () => {
                await client.drain()
                if (!(await client.pending()).length) await client.pull()
              })
            }
          >
            Sincronizar agora
          </Button>
          <Button
            variant="outline"
            disabled={busy || !!view?.pending.length}
            onClick={() =>
              void act(async () => {
                setMigration(null)
                setDownloaded(false)
                setSaved(false)
                setConfirmation('')
                setMigration(await client.prepareMigration())
              })
            }
          >
            Gerar prévia de importação
          </Button>
        </div>
        {!!view?.pending.length && (
          <details>
            <summary>Operações aguardando confirmação ({view.pending.length})</summary>
            <ul>
              {view.pending.map((op) => (
                <li key={op.id}>
                  <code>{op.id}</code> · {op.type} · revisão {op.expectedRevision} · tentativas{' '}
                  {op.attempts} · {op.state}
                </li>
              ))}
            </ul>
          </details>
        )}
        {first?.state === 'conflict' && (
          <fieldset disabled={busy}>
            <legend>Resolução explícita de conflito</legend>
            <p>
              A fila dependente está bloqueada. Usar a versão do servidor preserva um backup e as
              operações locais arquivadas, sem repetir pagamentos ou transferências. A resolução
              será auditada.
            </p>
            <label htmlFor="sync-resolution">Digite USAR VERSÃO DO SERVIDOR</label>
            <input
              id="sync-resolution"
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              autoComplete="off"
            />
            <Button
              disabled={resolution !== 'USAR VERSÃO DO SERVIDOR'}
              onClick={() =>
                void act(async () => {
                  await client.resolveUsingServer(resolution)
                  setResolution('')
                  await client.drain()
                })
              }
            >
              Preservar cópia e usar servidor
            </Button>
          </fieldset>
        )}
        {first?.state === 'error' && (
          <fieldset disabled={busy}>
            <legend>Operação rejeitada ou verificação divergente</legend>
            <p>Revise a causa antes de repetir. O identificador e o conteúdo serão preservados.</p>
            <label htmlFor="sync-retry">Digite REPETIR OPERAÇÃO VALIDADA</label>
            <input
              id="sync-retry"
              value={retry}
              onChange={(e) => setRetry(e.target.value)}
              autoComplete="off"
            />
            <Button
              disabled={retry !== 'REPETIR OPERAÇÃO VALIDADA'}
              onClick={() =>
                void act(async () => {
                  await client.retryRejected(first.id, retry)
                  setRetry('')
                  await client.drain()
                })
              }
            >
              Repetir a mesma operação
            </Button>
          </fieldset>
        )}
        {migration && (
          <fieldset disabled={busy}>
            <legend>Prévia de migração inicial</legend>
            <p>
              Destino consultado: PostgreSQL local vazio, revisão zero. Proprietário fictício:{' '}
              <code>{migration.plan.userId}</code>.
            </p>
            <p>
              Backup e dados locais serão preservados após a importação. Alterações após esta prévia
              exigem nova conferência.
            </p>
            <details>
              <summary>Registros e UUIDs incluídos</summary>
              <ul>
                {Object.entries(migration.plan.manifest.counts).map(([entity, count]) => (
                  <li key={entity}>
                    {names[entity]}: {count}
                    <p style={{ overflowWrap: 'anywhere' }}>
                      {(migration.plan.manifest.ids[entity] as string[]).join(', ')}
                    </p>
                  </li>
                ))}
              </ul>
            </details>
            <dl>
              {Object.entries(migration.plan.manifest.balances.at(-1)?.values ?? {}).map(
                ([id, value]) => (
                  <div key={id}>
                    <dt>Saldo da conta {id}</dt>
                    <dd>{formatMoney(value)}</dd>
                  </div>
                ),
              )}
            </dl>
            <details>
              <summary>Faturas e compromissos</summary>
              <ul>
                {migration.plan.manifest.invoices.map((invoice) => (
                  <li key={invoice.id}>
                    Fatura {invoice.id}: saldo {formatMoney(invoice.remaining)} · pago{' '}
                    {formatMoney(invoice.paid)}
                  </li>
                ))}
              </ul>
              <ul>
                {migration.plan.manifest.cards.map((card) => (
                  <li key={card.id}>
                    Cartão {card.id}: dívida {formatMoney(card.debt)} · comprometido{' '}
                    {formatMoney(card.committed)} · disponível {formatMoney(card.available)}
                  </li>
                ))}
              </ul>
            </details>
            <Button
              variant="outline"
              onClick={() => {
                download(migration)
                setDownloaded(true)
              }}
            >
              Baixar backup antes de importar
            </Button>
            <label>
              <input
                type="checkbox"
                checked={saved}
                disabled={!downloaded}
                onChange={(e) => setSaved(e.target.checked)}
              />
              Salvei o arquivo de backup
            </label>
            <label htmlFor="sync-import-confirmation">Digite IMPORTAR PARA A NUVEM</label>
            <input
              id="sync-import-confirmation"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="off"
            />
            <p>
              Nesta homologação, a expressão confirma envio exclusivamente ao banco local, sem
              acesso à produção.
            </p>
            <Button
              disabled={
                !downloaded ||
                !saved ||
                confirmation !== 'IMPORTAR PARA A NUVEM' ||
                !!view?.pending.length
              }
              onClick={() =>
                void act(async () => {
                  await client.importInitial(
                    migration.plan,
                    confirmation,
                    migration.plan.backupHash,
                  )
                  await client.drain()
                  setMigration(null)
                  setConfirmation('')
                })
              }
            >
              Confirmar importação no banco local
            </Button>
          </fieldset>
        )}
      </section>
    </div>
  )
}
