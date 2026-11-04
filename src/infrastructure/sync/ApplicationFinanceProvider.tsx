import { useEffect, useRef, useState, type ReactNode } from 'react'
import { FinancialWorkspaceContext } from '../financial-context'
import { SyncSettingsContext } from '@/features/settings/sync-settings-context'
import { Button } from '@/components/ui/button'
import type { ApplicationSyncWorkspace } from './application-workspace'
import { SyncSettings } from '@/features/settings/SyncSettings'

export function ApplicationFinanceProvider({
  workspace,
  children,
}: {
  workspace: ApplicationSyncWorkspace
  children: ReactNode
}) {
  const mounted = useRef(true), active = useRef(false)
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [ended, setEnded] = useState(false),
    [migrationRequired, setMigrationRequired] = useState(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (active.current) workspace.stop() } }, [workspace])
  async function activate() {
    setBusy(true)
    setError('')
    try {
      await workspace.initialize()
      if (!mounted.current) { workspace.stop(); return }
      workspace.start()
      active.current = true
      setReady(true)
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Backend de homologação indisponível. Nenhum envio ativado.',
      )
      setMigrationRequired(e instanceof Error && e.message.includes('Importação explícita'))
    } finally {
      setBusy(false)
    }
  }
  if (!ready)
    return (
      <main className="fatal">
        <h1>Homologação local do Money Saver</h1>
        <p>
          Este modo usa somente usuários fictícios e um banco IndexedDB separado. Não importa dados
          pessoais e não acessa a produção.
        </p>
        {error && <p role="alert">{error}</p>}
        <Button disabled={busy || ended} onClick={() => void activate()}>
          {ended
            ? 'Cliente encerrado — recarregue para reabrir'
            : busy
              ? 'Verificando backend local…'
              : 'Ativar sincronização local de testes'}
        </Button>
        {migrationRequired && (
          <SyncSettingsContext.Provider value={workspace.client}>
            <SyncSettings />
          </SyncSettingsContext.Provider>
        )}
      </main>
    )
  return (
    <FinancialWorkspaceContext.Provider
      value={{ repositories: workspace.repositories, kind: 'account' }}
    >
      <SyncSettingsContext.Provider value={workspace.client}>
        <div role="status" className="warning-banner">
          Homologação local · usuário fictício {workspace.mode.userId} · dispositivo{' '}
          {workspace.mode.deviceId}.
          <Button
            variant="ghost"
            onClick={() => {
              workspace.stop()
              setReady(false)
              setEnded(true)
              setError(
                'Envio interrompido. Dados e fila preservados; reabra o espaço para uma nova sessão.',
              )
            }}
          >
            Interromper cliente de teste
          </Button>
        </div>
        {children}
      </SyncSettingsContext.Provider>
    </FinancialWorkspaceContext.Provider>
  )
}
