/** Standalone lab entry, served ONLY by the local integration harness; never imported by App. */
import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import {
  SyncClient,
  SyncLabDatabase,
  localWorkerTransport,
  type SessionIdentity,
} from '@/infrastructure/sync/outbox'
import { entities } from '@/infrastructure/sync/protocol'
import { fixture } from '@/infrastructure/sync/fixtures.test-data'
import { balancesAt } from '@/domain/finance'
import { formatMoney } from '@/domain/money'
import { Button } from '@/components/ui/button'
import { SyncSettingsContext } from './sync-settings-context'
import { SyncSettings } from './SyncSettings'
import type { CivilDate } from '@/domain/models'
import '@/styles.css'

interface LabSession extends SessionIdentity {
  runId: string
  projectUrl: string
  device: string
  scenario: 'replica' | 'import'
  asOf: CivilDate
}
if (!import.meta.env.DEV || location.hostname !== '127.0.0.1')
  throw new Error('Laboratório disponível somente em desenvolvimento local.')

export function Lab({ session }: { session: LabSession }) {
  const [offline, setOffline] = useState(false),
    [error, setError] = useState(''),
    [summary, setSummary] = useState(''),
    [stopped, setStopped] = useState(false)
  const [runtime] = useState(() => {
    let identity: SessionIdentity | null = session
    let disconnected = false
    const transport = localWorkerTransport(location.origin + '/sync-api')
    const gate = <T,>(action: () => Promise<T>) =>
      disconnected ? Promise.reject(new TypeError('Conexão de homologação interrompida')) : action()
    const db = new SyncLabDatabase(
      `money-saver-sync-lab:${session.userId}:${session.runId}:${session.device}`,
    )
    return {
      client: new SyncClient(
        db,
        session.userId,
        {
          send: (...args) => gate(() => transport.send(...args)),
          view: (...args) => gate(() => transport.view(...args)),
          page: (...args) => gate(() => transport.page(...args)),
        },
        () => identity,
        session.asOf,
      ),
      offline(value: boolean) {
        disconnected = value
      },
      logout() {
        identity = null
      },
    }
  })
  const client = runtime.client
  useEffect(() => {
    let mounted = true
    if (session.scenario === 'replica')
      void client.bootstrap().catch((e) => {
        if (mounted) setError(e instanceof Error ? e.message : 'Falha ao abrir réplica.')
      })
    const timer = setInterval(() => {
      void client.repositories
        .snapshot()
        .then((data) => {
          if (mounted)
            setSummary(
              `${data.transactions.length} lançamentos · ${data.payments.length} pagamentos · ${Object.values(balancesAt(data, session.asOf)).map(formatMoney).join(' / ')}`,
            )
        })
        .catch(() => {
          /* Migration requires explicit preview before a head exists. */
        })
    }, 1000)
    return () => {
      mounted = false
      clearInterval(timer)
      client.stop()
      client.db.close()
    }
  }, [client, session])
  async function action(work: () => Promise<void>) {
    setError('')
    try {
      await work()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível concluir.')
    }
  }
  return (
    <main className="sync-lab" style={{ maxWidth: 1050, padding: 24, margin: '0 auto' }}>
      <h1>Money Saver · Configurações de homologação</h1>
      <p>
        Usuário fictício · dispositivo {session.device}. PostgreSQL e Worker locais. Nenhum dado
        pessoal é utilizado.
      </p>
      <nav aria-label="Clientes de homologação">
        <a href="/?device=pc">PC</a> · <a href="/?device=phone">Celular</a> ·{' '}
        <a href="/?device=migration">Importação de outro usuário fictício</a>
      </nav>
      <section className="panel settings-panel" aria-label="Ações sobre dados fictícios">
        <h2>Teste de sincronização entre clientes</h2>
        <p role="status">{summary || 'Espaço local de homologação.'}</p>
        {error && <p role="alert">{error}</p>}
        <div className="form-actions">
          {session.scenario === 'import' && (
            <Button
              disabled={stopped}
              onClick={() =>
                void action(async () => {
                  await client.db.transaction('rw', client.db.tables, async () => {
                    if (
                      (await client.db.syncHead.count()) ||
                      (await client.db.outbox.count()) ||
                      (
                        await Promise.all(
                          entities
                            .filter((e) => e !== 'categories')
                            .map((e) => client.db.table(e).count()),
                        )
                      ).some(Boolean)
                    )
                      throw new Error('Espaço já contém dados. Nenhum registro foi substituído.')
                    const data = fixture().data
                    for (const entity of entities)
                      await client.db.table(entity).bulkAdd(data[entity])
                  })
                  setSummary(
                    'Conjunto fictício carregado. Gere a prévia e baixe o backup antes de confirmar.',
                  )
                })
              }
            >
              Carregar dados fictícios para prévia
            </Button>
          )}
          {session.scenario === 'replica' && (
            <Button
              disabled={stopped}
              onClick={() =>
                void action(async () => {
                  const data = await client.repositories.snapshot()
                  const account = data.accounts[0],
                    category = data.categories.find((c) => c.direction === 'expense' && !c.archived)
                  if (!account || !category)
                    throw new Error('Aguarde a leitura inicial da réplica.')
                  await client.repositories.movements.create({
                    kind: 'transaction',
                    accountId: account.id,
                    categoryId: category.id,
                    description: `Despesa fictícia ${session.device}`,
                    amountCents: 100,
                    direction: 'expense',
                    method: 'pix',
                    date: session.asOf,
                    status: 'settled',
                    settledDate: session.asOf,
                  })
                })
              }
            >
              Registrar despesa Pix fictícia de R$ 1,00
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => {
              runtime.offline(!offline)
              setOffline(!offline)
            }}
          >
            {offline ? 'Restaurar conexão local' : 'Interromper conexão local'}
          </Button>
          <Button
            variant="outline"
            disabled={stopped}
            onClick={() => {
              runtime.logout()
              client.stop()
              setStopped(true)
              setSummary('Sessão fictícia encerrada. Dados e fila preservados.')
            }}
          >
            Encerrar sessão fictícia
          </Button>
        </div>
      </section>
      <SyncSettingsContext.Provider value={client}>
        <SyncSettings />
      </SyncSettingsContext.Provider>
    </main>
  )
}
async function mount() {
  const response = await fetch('/__sync/session' + location.search, { cache: 'no-store' })
  if (!response.ok) throw new Error('Inicie o harness de homologação local para abrir esta página.')
  const session = (await response.json()) as LabSession
  if (session.projectUrl !== 'http://127.0.0.1:54321')
    throw new Error('Destino de homologação inválido.')
  const element = document.getElementById('root')
  if (element) createRoot(element).render(<Lab session={session} />)
}
void mount().catch(() => {
  document.body.textContent = 'Laboratório local indisponível. Nenhuma sincronização foi iniciada.'
})
