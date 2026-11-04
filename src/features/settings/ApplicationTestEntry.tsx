/** Harness-only entry: renders the SAME App/Workspace/forms as src/main.tsx. */
import { createRoot } from 'react-dom/client'
import { App } from '@/App'
import { createApplicationSyncWorkspace } from '@/infrastructure/sync/application-workspace'
import type { CivilDate } from '@/domain/models'
import '@/styles.css'
import '@/phase2.css'
import '@/credit.css'

if (!import.meta.env.DEV || location.hostname !== '127.0.0.1')
  throw new Error('Entrada restrita ao harness local.')
async function mount() {
  const response = await fetch('/__sync/session' + location.search, { cache: 'no-store' })
  if (!response.ok) throw new Error('Harness local indisponível.')
  const session = (await response.json()) as {
    userId: string
    accessToken: string
    runId: string
    projectUrl: string
    device: string
    asOf: CivilDate
  }
  const workspace = createApplicationSyncWorkspace(
    {
      enabled: true,
      development: import.meta.env.DEV,
      appOrigin: location.origin,
      projectUrl: session.projectUrl,
      workerUrl: location.origin + '/sync-api',
      userId: session.userId,
      runId: session.runId,
      deviceId: session.device,
      asOf: session.asOf,
    },
    () => session,
  )
  const root = document.getElementById('root')
  if (root) createRoot(root).render(<App testWorkspace={workspace} />)
  window.addEventListener('pagehide', () => workspace.close(), { once: true })
}
void mount().catch(() => {
  document.body.textContent =
    'Backend de homologação indisponível. Nenhum espaço pessoal foi aberto.'
})
