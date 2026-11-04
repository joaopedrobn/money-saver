import { spawn } from 'node:child_process'
import process from 'node:process'
import console from 'node:console'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createServer } from 'vite'

// This runner has no database URL argument and never loads .env.local.
// All PostgreSQL connections are Unix sockets INSIDE a verified local Docker container.
const root = resolve(import.meta.dirname, '..')
const evidenceDir = join(root, '.local', 'local-sync-validation')
mkdirSync(evidenceDir, { recursive: true })
const project = /^project_id\s*=\s*"([A-Za-z0-9_-]+)"/m.exec(
  readFileSync(join(root, 'supabase/config.toml'), 'utf8'),
)?.[1]
if (project !== 'money-saver')
  throw new Error('Unexpected local Supabase project; refusing test execution.')
if (!process.version.startsWith('v26.7.0')) throw new Error('Use the existing Node.js 26.7.0.')
const container = `supabase_db_${project}`
const candidates = [
  join(process.env.LOCALAPPDATA ?? '', 'Programs/DockerDesktop/resources/bin/docker.exe'),
  'C:/Program Files/Docker/Docker/resources/bin/docker.exe',
]
const docker = candidates.find(existsSync) ?? 'docker'
const env = { ...process.env }
for (const key of Object.keys(env))
  if (/^(PG|SUPABASE_|VITE_SUPABASE_|MONEY_SAVER_TEST|DOCKER_)/.test(key)) delete env[key]
const dockerArgs = ['--context', 'desktop-linux']
const marker = 'localmoneysavertests' // 20-char synthetic marker, NOT a hosted project ref.
const a = '11111111-1111-4111-8111-111111111111'
const b = '22222222-2222-4222-8222-222222222222'
const op1 = '99999999-9999-4999-8999-999999999999'
const op2 = '99999999-9999-4999-8999-999999999998'
const runId = randomUUID().replaceAll('-', '')
const stage = `/tmp/money-saver-validation-${runId}`
const results = []
const evidence = {
  node: process.version,
  project,
  container,
  startedAt: new Date().toISOString(),
  results,
}

function processRun(command, args, { input, readyMarker } = {}) {
  let stdout = '',
    stderr = '',
    readyResolve
  const ready = new Promise((resolve) => {
    readyResolve = resolve
  })
  const child = spawn(command, args, {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (data) => {
    stdout += data
    if (readyMarker && stdout.includes(readyMarker)) readyResolve()
  })
  child.stderr.on('data', (data) => {
    stderr += data
  })
  child.stdin.on('error', () => {})
  if (input !== undefined) child.stdin.end(input)
  else child.stdin.end()
  const done = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) readyResolve()
      resolve({ code, stdout, stderr })
    })
  })
  return { done, ready, child }
}
async function dockerRun(args, input) {
  const result = await processRun(docker, [...dockerArgs, ...args], { input }).done
  if (result.code !== 0)
    throw new Error(result.stderr || result.stdout || `Docker exit ${result.code}`)
  return result.stdout.trim()
}
function psqlProcess(sql, { app = 'money-saver-local-validation', readyMarker } = {}) {
  return processRun(
    docker,
    [
      ...dockerArgs,
      'exec',
      '-i',
      '-e',
      `PGAPPNAME=${app}`,
      container,
      'psql',
      '--no-psqlrc',
      '--no-password',
      '--quiet',
      '--tuples-only',
      '--no-align',
      '--host',
      '/var/run/postgresql',
      '--username',
      'postgres',
      '--dbname',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-v',
      'VERBOSITY=verbose',
      '-v',
      `money_saver_disposable_project_ref=${marker}`,
      '-f',
      '-',
    ],
    { input: sql, readyMarker },
  )
}
async function sql(text) {
  const result = await psqlProcess(text).done
  if (result.code !== 0)
    throw new Error(result.stderr || result.stdout || `psql exit ${result.code}`)
  return result.stdout.trim()
}
function passed(name, detail) {
  results.push({ name, passed: true, detail })
  console.log(`PASS ${name}${detail ? `: ${detail}` : ''}`)
}
function assert(condition, message) {
  if (!condition) throw new Error(message)
}
const fixtureLoad = `\\ir ${stage}/tests/fixtures/initial-import.sql\n`
function authenticated(owner) {
  return `select set_config('request.jwt.claim.sub','${owner}',true); set local role authenticated;\n`
}
function payload(owner) {
  return owner === a
    ? `current_setting('money_saver.test_payload')`
    : `replace(current_setting('money_saver.test_payload'),'${a}','${b}')`
}
function importCall(owner, id) {
  return `public.ms_import_initial('${id}',0,${payload(owner)})`
}
function importTransaction(owner, id) {
  return `begin;\n${fixtureLoad}${authenticated(owner)}select ${importCall(owner, id)};commit;`
}
function jsonReceipt(output) {
  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line))
    .find((value) => value.operationId)
}
const entities = [
  'audit',
  'budgets',
  'occurrences',
  'invoice_entries',
  'payments',
  'installments',
  'invoices',
  'purchases',
  'adjustments',
  'transfers',
  'transactions',
  'recurring',
  'settings',
  'cards',
  'categories',
  'accounts',
]
let setupCommitted = false
const running = []

try {
  const context = JSON.parse(await dockerRun(['context', 'inspect', 'desktop-linux']))[0]
  assert(
    /^npipe:\/{2,}\.\/pipe\/dockerDesktopLinuxEngine$/i.test(context.Endpoints?.docker?.Host ?? ''),
    'Only the local Docker Desktop Linux named pipe is permitted.',
  )
  const inspect = JSON.parse(await dockerRun(['inspect', container]))[0]
  assert(
    inspect.State.Running && inspect.Config.Labels?.['com.supabase.cli.project'] === project,
    'Container is not the running local Supabase project.',
  )
  assert(/supabase\/postgres/.test(inspect.Config.Image), 'Unexpected database image.')
  const server = JSON.parse(
    await sql(
      "select jsonb_build_object('database',current_database(),'socket',inet_server_addr() is null,'version',current_setting('server_version'),'migrations',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations));",
    ),
  )
  assert(server.socket && server.database === 'postgres', 'Local Unix socket assertion failed.')
  assert(
    server.migrations?.includes('202611030001') && server.migrations?.includes('202611030002'),
    'Existing migrations were not applied by the local stack.',
  )
  evidence.postgres = server
  passed('local-only target and migrations', server.version)
  const checks = entities.map((entity) => `(select count(*) from public.ms_${entity})`).join('+')
  assert(
    (await sql(`select ${checks};`)) === '0',
    'Local financial database is not empty. No reset or test deletion will be performed.',
  )
  assert(
    (await sql(`select count(*) from auth.users where id in ('${a}','${b}');`)) === '0',
    'Synthetic test user IDs already exist; refusing overwrite.',
  )
  assert(
    (await sql("select count(*) from pg_namespace where nspname='ms_sync_private';")) === '0',
    'Candidate schema already exists; refusing overwrite.',
  )
  await dockerRun(['exec', container, 'mkdir', '-p', stage])
  for (const folder of ['migrations', 'checks', 'phase32a', 'tests'])
    await dockerRun(['cp', join(root, 'supabase', folder), `${container}:${stage}/${folder}`])
  const suite = await sql(`\\ir ${stage}/tests/sync.sql\n`)
  writeFileSync(join(evidenceDir, 'sql-suite.log'), suite)
  passed('real PostgreSQL isolation, RPC, atomicity, idempotency, revision and rollback suite')
  assert(
    (await sql(`select ${checks};`)) === '0',
    'Suite did not roll back all financial fixtures.',
  )
  assert(
    (await sql("select count(*) from pg_namespace where nspname='ms_sync_private';")) === '0',
    'Suite did not roll back candidate objects.',
  )
  passed('suite rollback and closed baseline restored')

  // Commit ONLY synthetic local setup so independent sessions can see the candidate.
  await sql(`begin;\n\\ir ${stage}/phase32a/prepare.sql\n${fixtureLoad}
    insert into auth.users(id,email) values('${a}','local-a@example.invalid'),('${b}','local-b@example.invalid');
    grant money_saver_sync_executor,money_saver_sync_validator to postgres;
    set local role money_saver_sync_executor;
    grant execute on function public.ms_import_initial(uuid,bigint,text) to authenticated; reset role;
    select set_config('request.jwt.claim.sub','${a}',true); set local role money_saver_sync_validator;
    insert into ms_sync_private.approvals(user_id,operation_id,expected_revision,payload_hash,reconciliation_hash,validator_version,expires_at)
      select auth.uid(),op::uuid,0,encode(sha256(convert_to(${payload(a)},'UTF8')),'hex'),repeat('0',64),'money-saver-domain-v1',clock_timestamp()+interval '10 minutes' from (values('${op1}'),('${op2}')) ops(op);
    reset role;select set_config('request.jwt.claim.sub','${b}',true); set local role money_saver_sync_validator;
    insert into ms_sync_private.approvals(user_id,operation_id,expected_revision,payload_hash,reconciliation_hash,validator_version,expires_at)
      select auth.uid(),op::uuid,0,encode(sha256(convert_to(${payload(b)},'UTF8')),'hex'),repeat('0',64),'money-saver-domain-v1',clock_timestamp()+interval '10 minutes' from (values('${op1}'),('${op2}')) ops(op);
    reset role;commit;`)
  setupCommitted = true
  const holder = (owner) =>
    psqlProcess(
      `begin;\n${fixtureLoad}${authenticated(owner)}select ${importCall(owner, op1)};select 'HOLDER_READY';select pg_sleep(10);commit;`,
      {
        app: owner === a ? 'money-saver-local-holder-a' : 'money-saver-local-holder-b',
        readyMarker: 'HOLDER_READY',
      },
    )
  const ha = holder(a),
    hb = holder(b)
  running.push(ha, hb)
  await Promise.all([ha.ready, hb.ready])
  const races = [psqlProcess(importTransaction(a, op1)), psqlProcess(importTransaction(b, op2))]
  running.push(...races)
  const timed = await Promise.all(races.map((r) => r.done))
  assert(
    timed.every((r) => r.code !== 0 && /55P03|lock timeout/.test(r.stderr)),
    'Concurrent requests did not honor transaction locks/timeouts.',
  )
  passed('parallel users and overlapping operations blocked by per-owner locks')
  await sql(
    "select pg_terminate_backend(pid) from pg_stat_activity where application_name='money-saver-local-holder-b' and datname=current_database();",
  )
  const [ra, rb] = await Promise.all([ha.done, hb.done])
  assert(
    ra.code === 0 && rb.code !== 0,
    'Expected one commit and one terminated local transaction.',
  )
  assert(
    (await sql(`select count(*) from public.ms_accounts where user_id='${b}';`)) === '0',
    'Connection failure left financial data.',
  )
  assert(
    (await sql(`select count(*) from ms_sync_private.operations where user_id='${b}';`)) === '0',
    'Connection failure left an operation receipt.',
  )
  assert(
    (await sql(`select count(*) from ms_sync_private.heads where user_id='${b}';`)) === '0',
    'Connection failure left a revision.',
  )
  passed('real connection termination rolls back finance, revision and receipt')
  const repeatedA = jsonReceipt(await sql(importTransaction(a, op1)))
  assert(
    JSON.stringify(repeatedA) === JSON.stringify(jsonReceipt(ra.stdout)),
    'Retry did not return the exact committed receipt.',
  )
  await sql(importTransaction(b, op1))
  const stale = await psqlProcess(importTransaction(b, op2)).done
  assert(
    stale.code !== 0 && /40001|Revision conflict/.test(stale.stderr),
    'Stale distinct operation did not fail with a revision conflict.',
  )
  passed('exact retry after commit, retry after rollback, stale-revision conflict')
  const actual = {}
  for (const owner of [a, b]) {
    const output = await sql(`begin;${authenticated(owner)}select public.ms_snapshot();rollback;`)
    actual[owner] = JSON.parse(output.split(/\r?\n/).find((line) => line.startsWith('{')))
  }
  // Reuse the production domain but disable env-file loading; no credentials/remote URL are needed.
  const vite = await createServer({
    root,
    envFile: false,
    server: { middlewareMode: true },
    appType: 'custom',
  })
  try {
    const protocol = await vite.ssrLoadModule('/src/infrastructure/sync/protocol.ts')
    const fixtures = await vite.ssrLoadModule('/src/infrastructure/sync/fixtures.test-data.ts')
    const manifest = await protocol.reconciliationManifest(fixtures.fixture(), '2026-11-04')
    const exactPayload = readFileSync(
      join(root, 'supabase/tests/fixtures/initial-import.sql'),
      'utf8',
    ).split('$money_saver_fixture$')[1]
    assert(
      repeatedA.payloadHash === (await protocol.sha256(exactPayload)),
      'PostgreSQL and domain payload SHA256 differ.',
    )
    for (const owner of [a, b]) await protocol.assertReconciled(manifest, actual[owner], owner)
    evidence.reconciliation = {
      users: 2,
      dataHash: manifest.dataHash,
      counts: manifest.counts,
      balances: manifest.balances,
      invoices: manifest.invoices,
      cards: manifest.cards,
    }
  } finally {
    await vite.close()
  }
  writeFileSync(join(evidenceDir, 'synthetic-snapshots.json'), JSON.stringify(actual, null, 2))
  passed(
    'real PostgreSQL snapshots reconciled by existing domain: UUIDs, references, balances, invoices, cards, both regimes',
  )
} catch (error) {
  evidence.error = error.message
  writeFileSync(join(evidenceDir, 'failure.log'), error.stack ?? String(error))
  console.error(`FAIL ${error.message}`)
  process.exitCode = 1
} finally {
  // Wait for our own local sessions before cleaning ONLY the synthetic setup we committed.
  await Promise.allSettled(running.map((p) => p.done))
  if (setupCommitted) {
    try {
      await sql(`begin;
        delete from ms_sync_private.record_versions where user_id in('${a}','${b}');
        delete from ms_sync_private.operations where user_id in('${a}','${b}');
        delete from ms_sync_private.approvals where user_id in('${a}','${b}');
        delete from ms_sync_private.heads where user_id in('${a}','${b}');
        ${entities.map((entity) => `delete from public.ms_${entity} where user_id in('${a}','${b}');`).join('\n')}
        delete from auth.users where id in('${a}','${b}');
        set constraints all immediate;
        drop function public.ms_import_initial(uuid,bigint,text);
        ${entities.map((entity) => `drop policy sync_executor on public.ms_${entity};revoke all on public.ms_${entity} from money_saver_sync_executor;`).join('\n')}
        revoke execute on function public.ms_snapshot() from money_saver_sync_executor;
        drop schema ms_sync_private cascade;
        revoke all on schema public from money_saver_sync_executor,money_saver_sync_validator;
        revoke money_saver_sync_executor,money_saver_sync_validator from postgres;
        drop role money_saver_sync_executor;drop role money_saver_sync_validator;commit;`)
      passed('synthetic local setup removed; original financial grants/policies preserved')
    } catch (error) {
      evidence.cleanupError = error.message
      process.exitCode = 1
      console.error(`Cleanup requires attention: ${error.message}`)
    }
  }
  evidence.finishedAt = new Date().toISOString()
  writeFileSync(join(evidenceDir, 'report.json'), JSON.stringify(evidence, null, 2))
  writeFileSync(join(evidenceDir, `report-${runId}.json`), JSON.stringify(evidence, null, 2))
}
