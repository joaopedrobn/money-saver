import { build, loadEnv } from 'vite'
import { buildSyncWorker } from './build-sync-worker.mjs'
import { fileURLToPath, URL } from 'node:url'
import process from 'node:process'

if (process.version !== 'v26.7.0') throw new Error('Use Node.js 26.7.0')
const root = fileURLToPath(new URL('../', import.meta.url))
const env = loadEnv('production', root, 'VITE_')
const controlled = process.argv.includes('--controlled-sync')
if (controlled && !/^[0-9a-f-]{36}(,[0-9a-f-]{36})*$/.test(env.VITE_SYNC_ALLOWED_USER_IDS ?? ''))
  throw new Error('Controlled build requires an explicit UUID allowlist')
if (
  env.VITE_SUPABASE_URL !== 'https://iwzmsbkbuerleocismhj.supabase.co' ||
  !/^sb_publishable_[A-Za-z0-9_-]+$/.test(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '')
)
  throw new Error('Configure only the project URL and publishable key in .env.local')
// Explicit public allowlist: never bundle environment objects or the lab entry point.
const publicEnv = {
  VITE_SUPABASE_AUTH_ENABLED: 'true',
  VITE_SUPABASE_URL: env.VITE_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: env.VITE_SUPABASE_PUBLISHABLE_KEY,
  VITE_SUPABASE_AUTH_REDIRECT_URL: 'https://money-saver.quem-votar-jp.workers.dev/',
  VITE_REMOTE_SYNC_ENABLED: controlled ? 'true' : 'false',
  VITE_SYNC_ALLOWED_USER_IDS: controlled ? env.VITE_SYNC_ALLOWED_USER_IDS : '',
  VITE_SYNC_API_URL: '/sync-api',
}
await build({
  root,
  envFile: false,
  define: Object.fromEntries(
    Object.entries(publicEnv).map(([k, v]) => [`import.meta.env.${k}`, JSON.stringify(v)]),
  ),
})
await buildSyncWorker(
  fileURLToPath(new URL('../.local/cloudflare-worker', import.meta.url)),
  'cloudflare.ts',
)
