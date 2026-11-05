import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import process from 'node:process'
import console from 'node:console'

// No remote URL arguments, env files, Supabase CLI or remote credentials.
if (process.version !== 'v26.7.0' || process.argv.length !== 2)
  throw new Error('Use Node 26.7.0 without arguments')
const root = resolve(import.meta.dirname, '..')
const docker = join(
  process.env.LOCALAPPDATA ?? '',
  'Programs/DockerDesktop/resources/bin/docker.exe',
)
if (!existsSync(docker)) throw new Error('Local Docker Desktop CLI not found')
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) => !/^(PG|SUPABASE_|VITE_|CF_|CLOUDFLARE_|DOCKER_)/.test(k),
  ),
)
const run = (args, input) =>
  execFileSync(docker, ['--context', 'desktop-linux', ...args], {
    env,
    input,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60000,
    maxBuffer: 4 * 1024 * 1024,
  }).trim()
const context = JSON.parse(run(['context', 'inspect', 'desktop-linux']))[0]
if (
  !/^npipe:\/{2,}\.\/pipe\/dockerDesktopLinuxEngine$/i.test(context.Endpoints?.docker?.Host ?? '')
)
  throw new Error('Nonlocal Docker context refused')
const container = 'supabase_db_money-saver'
const instance = JSON.parse(run(['inspect', container]))[0]
if (
  !instance.State.Running ||
  instance.Config.Labels?.['com.supabase.cli.project'] !== 'money-saver' ||
  !/supabase\/postgres/.test(instance.Config.Image)
)
  throw new Error('Unexpected local PostgreSQL container')
const sql = (input) =>
  run(
    [
      'exec',
      '-i',
      container,
      'psql',
      '-X',
      '-qAt',
      '-v',
      'ON_ERROR_STOP=1',
      '-h',
      '/var/run/postgresql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-f',
      '-',
    ],
    input,
  )
const financialCount =
  'select sum(n) from (select count(*) n from public.ms_accounts union all select count(*) from public.ms_categories union all select count(*) from public.ms_cards union all select count(*) from public.ms_recurring union all select count(*) from public.ms_transactions union all select count(*) from public.ms_transfers union all select count(*) from public.ms_adjustments union all select count(*) from public.ms_purchases union all select count(*) from public.ms_invoices union all select count(*) from public.ms_installments union all select count(*) from public.ms_payments union all select count(*) from public.ms_invoice_entries union all select count(*) from public.ms_occurrences union all select count(*) from public.ms_budgets union all select count(*) from public.ms_settings union all select count(*) from public.ms_audit) t;'
if (
  sql('select inet_server_addr() is null;') !== 't' ||
  sql(financialCount) !== '0' ||
  sql("select count(*) from pg_namespace where nspname='ms_sync_private';") !== '0'
)
  throw new Error('Expected empty isolated baseline; refusing reset/overwrite')
const migration = readFileSync(
  join(root, 'supabase/remote-migrations/202611040001_controlled_financial_sync.sql'),
  'utf8',
)
const suite = readFileSync(join(root, 'supabase/tests/remote-migration-closed.sql'), 'utf8')
const output = sql(
  suite.replace(
    '\\ir ../remote-migrations/202611040001_controlled_financial_sync.sql',
    () => migration,
  ),
)
const results = output.split(/\r?\n/).filter((s) => s.startsWith('PASS '))
if (results.length !== 6) throw new Error('Incomplete SQL checks')
if (
  sql(financialCount) !== '0' ||
  sql("select count(*) from pg_namespace where nspname='ms_sync_private';") !== '0' ||
  sql(
    "select count(*) from pg_roles where rolname in ('money_saver_sync_executor','money_saver_sync_validator');",
  ) !== '0'
)
  throw new Error('Migration/fixture rollback incomplete')
const evidenceDir = join(root, '.local/remote-migration-validation')
mkdirSync(evidenceDir, { recursive: true })
writeFileSync(join(evidenceDir, 'sql.log'), output)
const evidence = {
  at: new Date().toISOString(),
  node: process.version,
  postgres: sql('show server_version;'),
  container,
  migrationSha256: createHash('sha256').update(migration).digest('hex'),
  results,
  synchronizationEnabled: false,
  allowedUsers: 0,
  baselineRestored: true,
  remoteAccess: false,
}
writeFileSync(join(evidenceDir, 'report.json'), JSON.stringify(evidence, null, 2))
results.forEach((s) => console.log(s))
console.log('PASS local socket target and complete baseline rollback; no remote access')
