import { spawn } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer as httpServer } from 'node:http'
import { createServer } from 'vite'
import { buildSyncWorker } from './build-sync-worker.mjs'
import { serveSyncLab } from './serve-sync-lab.mjs'
import { testApplicationSyncFlow } from './test-application-sync-flow.mjs'
import { checkFinancialTimezones } from './check-financial-timezones.mjs'
import 'fake-indexeddb/auto'
import process from 'node:process'
import console from 'node:console'
import { setTimeout } from 'node:timers/promises'
import { Buffer } from 'node:buffer'
/* global fetch, Request, AbortController, structuredClone */

const root = resolve(import.meta.dirname, '..')
const evidence = join(root, '.local/phase32b-validation')
mkdirSync(evidence, { recursive: true })
const results = []
const report = { node: process.version, startedAt: new Date().toISOString(), results }
const docker = join(
  process.env.LOCALAPPDATA ?? '',
  'Programs/DockerDesktop/resources/bin/docker.exe',
)
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !/^(PG|SUPABASE_|VITE_SUPABASE_|MONEY_SAVER_TEST|DOCKER_)/.test(key),
  ),
)
env.PATH = resolve(docker, '..') + ';' + env.PATH
env.DOCKER_HOST = 'npipe:////./pipe/dockerDesktopLinuxEngine'
const container = 'supabase_db_money-saver'
const stage = '/tmp/money-saver-b-' + randomUUID()
const base = 'http://127.0.0.1:54321'
const owners = [],
  databases = [],
  activeClients = []
let installed = false,
  server,
  vite,
  keys,
  workerProcess,
  labServer
let workerOutput = ''
const workerSecrets = join(evidence, '.dev.vars')
function assert(value, message) {
  if (!value) throw new Error(message)
}
function pass(name) {
  results.push({ name, passed: true })
  console.log('PASS ' + name)
}
async function run(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = '',
      stderr = ''
    child.stdout.on('data', (d) => {
      stdout += d
    })
    child.stderr.on('data', (d) => {
      stderr += d
    })
    child.on('error', reject)
    child.on('close', (code) =>
      code ? reject(new Error(stderr || 'Local process failed')) : resolve(stdout.trim()),
    )
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}
const dock = (args, input) => run(docker, ['--context', 'desktop-linux', ...args], input)
const sql = (text) =>
  dock(
    [
      'exec',
      '-i',
      container,
      'psql',
      '-X',
      '-Atq',
      '-v',
      'ON_ERROR_STOP=1',
      '-v',
      'money_saver_disposable_project_ref=localmoneysavertests',
      '-h',
      '/var/run/postgresql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-f',
      '-',
    ],
    text,
  )
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
async function auth(path, body, token = keys.SERVICE_ROLE_KEY) {
  const response = await fetch(base + '/auth/v1' + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      apikey: keys.ANON_KEY,
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  assert(response.ok, 'Local Auth fixture operation failed: ' + response.status)
  return response.json()
}
try {
  assert(process.version === 'v26.7.0', 'Preserve Node.js 26.7.0')
  assert(existsSync(docker), 'Local Docker Desktop is required')
  const context = JSON.parse(await dock(['context', 'inspect', 'desktop-linux']))[0]
  assert(
    /^npipe:\/{2,}\.\/pipe\/dockerDesktopLinuxEngine$/i.test(context.Endpoints.docker.Host),
    'Only local Docker named pipe',
  )
  const db = JSON.parse(await dock(['inspect', container]))[0]
  assert(
    db.State.Running && db.Config.Labels['com.supabase.cli.project'] === 'money-saver',
    'Wrong local database container',
  )
  assert(
    /^project_id\s*=\s*"money-saver"/m.test(
      readFileSync(join(root, 'supabase/config.toml'), 'utf8'),
    ),
    'Wrong CLI project',
  )
  assert(
    (await sql(
      `select ${entities.map((e) => `(select count(*) from public.ms_${e})`).join('+')};`,
    )) === '0',
    'Refusing a nonempty financial database',
  )
  assert(
    (await sql("select count(*) from pg_namespace where nspname='ms_sync_private';")) === '0',
    'Candidate already installed; refusing overwrite',
  )
  keys = JSON.parse(
    await run('cmd.exe', ['/c', 'npx', '--yes', 'supabase@3.0.0', 'status', '-o', 'json']),
  )
  assert(keys.API_URL === base, 'CLI API must be loopback, never production')
  pass('local Docker, empty PostgreSQL, independent local credentials')
  await dock(['exec', container, 'mkdir', '-p', stage])
  for (const folder of ['checks', 'phase32a', 'phase32b'])
    await dock(['cp', join(root, 'supabase', folder), `${container}:${stage}/${folder}`])
  await sql(
    `begin;\n\\ir ${stage}/phase32a/prepare.sql\n\\ir ${stage}/phase32b/prepare.sql\ncommit;`,
  )
  installed = true
  assert(
    (await sql(
      `select count(*) from (values ${entities.map((e) => `('public.ms_${e}')`).join(',')}) t(name) where has_table_privilege('authenticated',name,'INSERT,UPDATE,DELETE');`,
    )) === '0',
    'Authenticated has generic financial writes',
  )
  assert(
    (await sql(
      "select has_function_privilege('authenticated','public.ms_approve(uuid,uuid,bigint,text,text,text)','EXECUTE') or has_function_privilege('anon','public.ms_approve(uuid,uuid,bigint,text,text,text)','EXECUTE') or has_function_privilege('service_role','public.ms_approve(uuid,uuid,bigint,text,text,text)','EXECUTE');",
    )) === 'f',
    'Approval privilege leak',
  )
  const security = JSON.parse(
    await sql(
      "select jsonb_agg(jsonb_build_object('name',proname,'definer',prosecdef,'owner',pg_get_userbyid(proowner),'config',proconfig)) from pg_proc where pronamespace='public'::regnamespace and proname in ('ms_approve','ms_sync_view','ms_changes','ms_apply_changes','ms_import_initial');",
    ),
  )
  assert(
    security.length === 5 &&
      security.every(
        (f) =>
          f.definer &&
          f.owner ===
            (f.name === 'ms_approve'
              ? 'money_saver_sync_validator'
              : 'money_saver_sync_executor') &&
          f.config.includes('search_path=""') &&
          f.config.includes('row_security=on'),
      ),
    'Unsafe privileged RPC configuration',
  )
  assert(
    (await sql(
      "select count(*) from pg_roles where rolname in ('money_saver_sync_executor','money_saver_sync_validator') and not rolcanlogin and not rolbypassrls and not rolsuper;",
    )) === '2',
    'Internal role privilege escalation',
  )
  report.rpcSecurity = security
  pass('candidate SQL installed locally; generic authenticated financial writes remain blocked')
  const sessions = []
  for (let i = 0; i < 2; i++) {
    const email = `sync-${randomUUID()}@example.invalid`,
      password = 'Local-fixture-' + randomUUID()
    const user = await auth('/admin/users', { email, password, email_confirm: true })
    owners.push(user.id)
    const session = await auth('/token?grant_type=password', { email, password }, keys.ANON_KEY)
    sessions.push({ userId: user.id, accessToken: session.access_token })
  }
  const jwtPart = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const unsigned =
    jwtPart({ alg: 'HS256', typ: 'JWT' }) +
    '.' +
    jwtPart({
      role: 'money_saver_sync_validator',
      iss: 'supabase',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
  const validatorToken =
    unsigned + '.' + createHmac('sha256', keys.JWT_SECRET).update(unsigned).digest('base64url')
  vite = await createServer({
    root,
    envFile: false,
    server: { middlewareMode: true },
    appType: 'custom',
  })
  const worker = (await vite.ssrLoadModule('/src/worker/index.ts')).default
  const protocol = await vite.ssrLoadModule('/src/infrastructure/sync/protocol.ts')
  const incremental = await vite.ssrLoadModule('/src/infrastructure/sync/incremental.ts')
  const fixtures = await vite.ssrLoadModule('/src/infrastructure/sync/fixtures.test-data.ts')
  const outbox = await vite.ssrLoadModule('/src/infrastructure/sync/outbox.ts')
  const mapping = await vite.ssrLoadModule('/src/infrastructure/supabase/mapping.ts')
  const workerEnv = {
    LAB_ONLY: 'true',
    SUPABASE_URL: base,
    SUPABASE_PUBLIC_KEY: keys.ANON_KEY,
    SYNC_VALIDATOR_TOKEN: validatorToken,
  }
  server = httpServer(async (request, response) => {
    try {
      const chunks = []
      let bytes = 0
      for await (const chunk of request) {
        bytes += chunk.length
        if (bytes > 21 * 1024 * 1024) {
          response.writeHead(413).end()
          return
        }
        chunks.push(chunk)
      }
      const req = new Request(`http://127.0.0.1${request.url}`, {
        method: request.method,
        headers: request.headers,
        body: chunks.length ? Buffer.concat(chunks) : undefined,
      })
      const result = await worker.fetch(req, workerEnv)
      response.writeHead(result.status, Object.fromEntries(result.headers))
      response.end(Buffer.from(await result.arrayBuffer()))
    } catch {
      response.writeHead(500).end()
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const workerUrl = `http://127.0.0.1:${port}`
  if (process.argv.includes('--workerd')) {
    await new Promise((resolve) => server.close(resolve))
    server = null
    await buildSyncWorker(join(evidence, 'bundle'))
    writeFileSync(
      join(evidence, 'wrangler.json'),
      JSON.stringify({
        name: 'money-saver-sync-lab',
        main: './bundle/index.js',
        compatibility_date: '2026-11-04',
        workers_dev: false,
        vars: { LAB_ONLY: 'true', SUPABASE_URL: base },
      }),
    )
    writeFileSync(
      workerSecrets,
      `SUPABASE_PUBLIC_KEY=${keys.ANON_KEY}\nSYNC_VALIDATOR_TOKEN=${validatorToken}\n`,
    )
    const workerEnv = { ...env, WRANGLER_SEND_METRICS: 'false', CI: 'true' }
    for (const key of Object.keys(workerEnv))
      if (/^(CLOUDFLARE_|CF_)/.test(key)) delete workerEnv[key]
    workerProcess = spawn(
      'cmd.exe',
      [
        '/c',
        'npx',
        '--yes',
        'wrangler@4.157.0',
        'dev',
        '--config',
        join(evidence, 'wrangler.json'),
        '--no-bundle',
        '--local',
        '--ip',
        '127.0.0.1',
        '--port',
        String(port),
        '--inspector-port',
        '0',
        '--log-level',
        'error',
      ],
      { cwd: root, env: workerEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let startup = ''
    workerProcess.stdout.on('data', (d) => {
      startup += d
      workerOutput += d
    })
    workerProcess.stderr.on('data', (d) => {
      startup += d
      workerOutput += d
    })
    let ready = false
    for (let i = 0; i < 120; i++) {
      try {
        if ((await fetch(workerUrl + '/view')).status === 401) {
          ready = true
          break
        }
      } catch {
        /* not listening yet */
      }
      if (workerProcess.exitCode !== null) break
      await setTimeout(500)
    }
    // Never print Wrangler binding output, which can contain local credentials.
    if (!ready) {
      report.workerdError = startup
        .replaceAll(keys.ANON_KEY, '[local-key]')
        .replaceAll(validatorToken, '[validator-token]')
      throw new Error('Local workerd failed to start; see private evidence')
    }
    pass('actual Cloudflare workerd runtime, loopback HTTP and local-only bindings')
  }
  const transport = outbox.localWorkerTransport(workerUrl)
  const call = (path, body, session = sessions[0]) =>
    fetch(workerUrl + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(session ? { Authorization: 'Bearer ' + session.accessToken } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  assert((await call('/view', null, null)).status === 401, 'Anonymous request accepted')
  const invalidJwt = await call('/view', null, { accessToken: 'invalid.jwt.token' })
  assert(
    invalidJwt.status === 401,
    'Invalid JWT rejection returned ' +
      invalidJwt.status +
      ': ' +
      JSON.stringify(await invalidJwt.json()),
  )
  assert(
    (
      await worker.fetch(new Request(workerUrl + '/view'), {
        ...workerEnv,
        SUPABASE_URL: 'https://iwzmsbkbuerleocismhj.supabase.co',
      })
    ).status === 503,
    'Production gate failed',
  )
  pass('real HTTP/JWT password sign-in; anonymous, invalid token and production target rejected')
  let clock = Date.now(),
    identity = sessions[0]
  const makeClient = (name, session = () => identity, customTransport = transport) => {
    const db = new outbox.SyncLabDatabase(
      `money-saver-sync-lab:${sessions[0].userId}:${name}:${randomUUID()}`,
    )
    databases.push(db)
    return new outbox.SyncClient(
      db,
      sessions[0].userId,
      customTransport,
      session,
      '2026-11-04',
      () => clock,
    )
  }
  let a = makeClient('pc'),
    b = makeClient('phone')
  const backup = fixtures.fixture()
  await a.db.transaction('rw', a.db.tables, async () => {
    for (const entity of protocol.entities) {
      await a.db.table(entity).clear()
      await a.db.table(entity).bulkAdd(backup.data[entity])
    }
  })
  const scope = { projectUrl: base, userId: sessions[0].userId }
  const savedBackupFile = join(evidence, 'initial-backup.synthetic.json')
  writeFileSync(savedBackupFile, JSON.stringify(backup, null, 2))
  const savedBackupHash = await protocol.sha256(
    protocol.canonicalJson(JSON.parse(readFileSync(savedBackupFile, 'utf8'))),
  )
  const plan = await protocol.prepareInitialImport({
    operationId: randomUUID(),
    scope,
    localDatabase: a.db.name,
    backup,
    remoteHead: { revision: 0, counts: Object.fromEntries(protocol.entities.map((e) => [e, 0])) },
    asOf: '2026-11-04',
  })
  await a.importInitial(plan, 'IMPORTAR PARA A NUVEM', savedBackupHash)
  // The approval route is inaccessible with a normal real JWT.
  const approveDenied = await fetch(base + '/rest/v1/rpc/ms_approve', {
    method: 'POST',
    headers: {
      apikey: keys.ANON_KEY,
      Authorization: 'Bearer ' + identity.accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_user: identity.userId,
      p_operation: randomUUID(),
      p_revision: 0,
      p_hash: '0'.repeat(64),
      p_manifest: '0'.repeat(64),
      p_version: 'money-saver-domain-v2',
    }),
  })
  assert(!approveDenied.ok, 'User can issue trusted approvals')
  // Fail inside PostgreSQL AFTER related rows were inserted, not just at a JS validator.
  await sql(`create function public.ms_test_fail_import() returns trigger language plpgsql set search_path='' as $$ begin if new.user_id='${identity.userId}'::uuid then raise exception 'Synthetic local failure after installment insert'; end if; return new; end $$;
    revoke all on function public.ms_test_fail_import() from public;
    create trigger ms_test_fail_import after insert on public.ms_installments for each row execute function public.ms_test_fail_import();`)
  try {
    await a.flush().then(
      () => {
        throw new Error('Injected failure accepted')
      },
      (error) => assert(error.status === 422, 'Failure was not PostgreSQL rejection'),
    )
    assert(
      (await transport.view(identity.accessToken, new AbortController().signal)).revision === 0,
      'Failed import advanced revision',
    )
    assert(
      (await sql(
        `select (select count(*) from public.ms_accounts where user_id='${identity.userId}')+(select count(*) from ms_sync_private.operations where user_id='${identity.userId}')+(select count(*) from ms_sync_private.feed where user_id='${identity.userId}');`,
      )) === '0',
      'Partial import survived rollback',
    )
  } finally {
    await sql(
      'drop trigger ms_test_fail_import on public.ms_installments; drop function public.ms_test_fail_import();',
    )
  }
  await sql(
    `update ms_sync_private.approvals set created_at=clock_timestamp()-interval '20 minutes',expires_at=clock_timestamp()-interval '10 minutes' where user_id='${identity.userId}' and operation_id='${plan.operationId}';`,
  )
  await a.retryRejected(plan.operationId, 'REPETIR OPERAÇÃO VALIDADA')
  await a.flush()
  await b.bootstrap()
  pass(
    'real PostgreSQL injected mid-import failure rolls back finance, feed, revision and receipt; expired approval renews only identical content and same-ID retry succeeds',
  )
  assert(
    (await a.status()).pending === 0 && (await b.db.payments.count()) === 1,
    'Initial import failed',
  )
  pass(
    'explicit backup/preview/confirmation import through Worker and RPC; UUIDs and totals reconciled',
  )
  const accountId = backup.data.accounts[0].id,
    categoryId = backup.data.categories[0].id,
    cardId = backup.data.cards[0].id
  const command = (label) => async (r) =>
    r.movements.create({
      kind: 'transaction',
      accountId,
      categoryId,
      description: label,
      amountCents: 123,
      direction: 'expense',
      method: 'debit',
      date: '2026-11-03',
      status: 'settled',
      settledDate: '2026-11-03',
    })
  await a.mutate('expense', command('Despesa PC'))
  await a.flush()
  await b.pull()
  assert((await b.db.transactions.count()) === 2, 'Client B did not receive incremental creation')
  // Commit succeeds but the simulated network loses its response. Reload then retry SAME ID.
  const lossy = {
    ...transport,
    send: async (...args) => {
      await transport.send(...args)
      throw new Error('Synthetic response loss after commit')
    },
  }
  const reloadDb = a.db
  a = new outbox.SyncClient(
    reloadDb,
    identity.userId,
    lossy,
    () => identity,
    '2026-11-04',
    () => clock,
  )
  await a.mutate('payment', (r) =>
    r.credit.pay({
      invoiceId: backup.data.invoices[1].id,
      accountId,
      amountCents: 100,
      date: '2026-11-03',
    }),
  )
  await a.flush().then(
    () => {
      throw new Error('Loss was not simulated')
    },
    () => {},
  )
  assert((await a.pending()).length === 1, 'Unknown result discarded')
  const dbName = a.db.name
  a.db.close()
  const reopened = new outbox.SyncLabDatabase(dbName)
  databases.push(reopened)
  clock += 31000
  a = new outbox.SyncClient(
    reopened,
    identity.userId,
    transport,
    () => identity,
    '2026-11-04',
    () => clock,
  )
  await a.flush()
  await b.pull()
  assert(
    (await b.db.payments.count()) === 2 && !(await a.pending()).length,
    'Duplicate payment after durable retry',
  )
  pass('outbox survives IDB close/reopen and lost response; exact retry confirms one payment')
  // Same authoritative base, competing offline changes: never silently overwrite.
  await a.mutate('pc-change', command('PC concorrente'))
  await b.mutate('phone-change', command('Celular offline'))
  const race = await Promise.allSettled([a.flush(), b.flush()])
  assert(
    race.filter((r) => r.status === 'fulfilled').length === 1,
    'Concurrent writes did not choose one revision winner',
  )
  const loser = race[0].status === 'rejected' ? a : b,
    winner = loser === a ? b : a
  assert((await loser.status()).phase === 'conflict', 'Conflict not durable')
  await loser.resolveUsingServer('USAR VERSÃO DO SERVIDOR')
  await loser.flush()
  await winner.pull()
  assert((await loser.db.syncResolutions.count()) === 1, 'Resolution recovery data missing')
  pass(
    'two devices conflict, preserve rejected data, explicit server choice and synchronized audit resolution',
  )
  await a.mutate('installment-purchase', (r) =>
    r.credit.createPurchase({
      cardId,
      categoryId,
      description: 'Compra parcelada fictícia',
      amountCents: 900,
      date: '2026-11-03',
      installmentCount: 3,
      feeCents: 0,
    }),
  )
  await a.flush()
  await b.pull()
  assert(
    (await b.db.purchases.count()) === 2 && (await b.db.installments.count()) === 5,
    'Compound purchase did not arrive atomically',
  )
  await a.mutate('budget', (r) => r.planning.saveBudget('2026-11', categoryId, 20000))
  await a.flush()
  await b.pull()
  const budget = (await a.db.budgets.toArray())[0]
  await a.mutate('delete-budget', (r) => r.planning.removeBudget(budget.id))
  await a.flush()
  await b.pull()
  assert((await b.db.budgets.count()) === 0, 'Tombstone not propagated')
  const deletedAtRevision = (
    await transport.view(identity.accessToken, new AbortController().signal)
  ).revision
  const reuse = await call('/operations', {
    operationId: randomUUID(),
    expectedRevision: deletedAtRevision,
    kind: 'changes',
    payloadText: protocol.canonicalJson({
      protocol: 2,
      asOf: '2026-11-04',
      changes: [
        {
          entity: 'budgets',
          id: budget.id,
          row: mapping.toRemoteRow('budgets', budget, identity.userId),
        },
      ],
    }),
  })
  assert(
    reuse.status === 422 &&
      (await transport.view(identity.accessToken, new AbortController().signal)).revision ===
        deletedAtRevision,
    'Deleted UUID was reused',
  )
  pass('compound purchases/installments/invoices and budget creation/deletion propagated')
  await a.mutate('edit-expense', (r) =>
    r.movements.update('transaction', backup.data.transactions[0].id, {
      kind: 'transaction',
      accountId,
      categoryId,
      description: 'Despesa corrigida explicitamente',
      amountCents: 150,
      direction: 'expense',
      method: 'debit',
      date: '2026-10-02',
      status: 'settled',
      settledDate: '2026-10-02',
    }),
  )
  await a.flush()
  await b.pull()
  const payment = (await a.db.payments.toArray()).find((p) => p.id !== backup.data.payments[0].id)
  await a.repositories.credit.reversePayment(payment.id, '2026-11-04', 'Estorno fictício explícito')
  await a.flush()
  await b.pull()
  assert(
    (await b.db.payments.get(payment.id)).reversalDate === '2026-11-04',
    'Payment reversal did not propagate',
  )
  await a.mutate('recurring-realization', async (r) => {
    const recurring = await r.planning.saveRecurring({
      accountId,
      categoryId,
      description: 'Recorrência fictícia',
      direction: 'expense',
      amountCents: 50,
      startDate: '2026-11-03',
      dayOfMonth: 3,
      frequency: 'monthly',
    })
    await r.planning.realize(recurring.id, '2026-11-03', 50, '2026-11-03')
  })
  await a.flush()
  await b.pull()
  assert(
    (await b.db.occurrences.count()) === 1 && (await b.db.recurring.count()) === 1,
    'Recurring bundle did not propagate',
  )
  pass(
    'existing repository adapters queue direct commands; expense edits, explicit payment reversal and recurring realization reconcile',
  )
  const multi = await a.mutate('pix-transfer-adjustment', async (r) => {
    const destination = await r.accounts.create({
      name: 'Reserva fictícia',
      institution: 'Teste local',
      type: 'savings',
      openingBalanceCents: 0,
      openingDate: '2026-01-01',
      color: 'blue',
    })
    const income = await r.categories.create({
      name: 'Receita fictícia de homologação',
      direction: 'income',
      color: 'sage',
      icon: 'wallet',
    })
    await r.movements.create({
      kind: 'transaction',
      accountId,
      categoryId: income.id,
      description: 'Receita Pix fictícia',
      amountCents: 2500,
      direction: 'income',
      method: 'pix',
      date: '2026-11-03',
      status: 'settled',
      settledDate: '2026-11-03',
    })
    await r.movements.create({
      kind: 'transaction',
      accountId,
      categoryId,
      description: 'Despesa Pix fictícia',
      amountCents: 100,
      direction: 'expense',
      method: 'pix',
      date: '2026-11-03',
      status: 'settled',
      settledDate: '2026-11-03',
    })
    const transfer = await r.movements.create({
      kind: 'transfer',
      accountId,
      destinationAccountId: destination.id,
      description: 'Transferência fictícia',
      amountCents: 1000,
      direction: 'expense',
      method: 'pix',
      date: '2026-11-03',
      status: 'settled',
      settledDate: '2026-11-03',
    })
    const adjustment = await r.movements.create({
      kind: 'adjustment',
      accountId,
      categoryId: income.id,
      description: 'Ajuste fictício',
      amountCents: 250,
      direction: 'income',
      method: 'other',
      date: '2026-11-03',
      status: 'settled',
      settledDate: '2026-11-03',
    })
    return { destination, transfer, adjustment }
  })
  await a.flush()
  await b.pull()
  assert(
    (await b.db.transfers.count()) === 1 &&
      (await b.db.adjustments.count()) === 1 &&
      (await b.db.accounts.count()) === 2,
    'Compound Pix/transfer/adjustment bundle failed',
  )
  await a.repositories.movements.update('transfer', multi.transfer.id, {
    kind: 'transfer',
    accountId,
    destinationAccountId: multi.destination.id,
    description: 'Transferência corrigida explicitamente',
    amountCents: 1200,
    direction: 'expense',
    method: 'pix',
    date: '2026-11-03',
    status: 'settled',
    settledDate: '2026-11-03',
  })
  await a.flush()
  await b.pull()
  assert(
    (await b.db.transfers.get(multi.transfer.id)).amountCents === 1200,
    'Transfer correction not propagated',
  )
  const newCard = await a.repositories.credit.createCard({
    accountId: multi.destination.id,
    name: 'Cartão secundário fictício',
    institution: 'Teste local',
    nickname: 'Homologação',
    brand: '',
    lastFour: '',
    color: 'sage',
    limitCents: 5000,
    closingDay: 8,
    dueDay: 18,
  })
  await a.flush()
  await b.pull()
  const editablePurchase = await a.repositories.credit.createPurchase({
    cardId: newCard.id,
    categoryId,
    description: 'Compra editável fictícia',
    amountCents: 600,
    installmentCount: 2,
    feeCents: 0,
    date: '2026-11-03',
  })
  await a.flush()
  await b.pull()
  const previousParts = (
    await a.db.installments.where('purchaseId').equals(editablePurchase.id).toArray()
  ).map((p) => p.id)
  await a.repositories.credit.updatePurchase(editablePurchase.id, {
    cardId: newCard.id,
    categoryId,
    description: 'Compra editada no PC',
    amountCents: 700,
    installmentCount: 2,
    feeCents: 0,
    date: '2026-11-03',
  })
  await b.repositories.credit.updatePurchase(editablePurchase.id, {
    cardId: newCard.id,
    categoryId,
    description: 'Compra editada offline no celular',
    amountCents: 700,
    installmentCount: 2,
    feeCents: 0,
    date: '2026-11-03',
  })
  const purchaseRace = await Promise.allSettled([a.flush(), b.flush()])
  assert(
    purchaseRace.filter((r) => r.status === 'fulfilled').length === 1,
    'Concurrent purchase edits did not select one revision winner',
  )
  const purchaseLoser = purchaseRace[0].status === 'rejected' ? a : b,
    purchaseWinner = purchaseLoser === a ? b : a
  assert((await purchaseLoser.status()).phase === 'conflict', 'Purchase conflict was not preserved')
  await purchaseLoser.resolveUsingServer('USAR VERSÃO DO SERVIDOR')
  await purchaseLoser.flush()
  await purchaseWinner.pull()
  const currentParts = await b.db.installments
    .where('purchaseId')
    .equals(editablePurchase.id)
    .toArray()
  assert(
    (await b.db.purchases.get(editablePurchase.id)).amountCents === 700 &&
      currentParts.length === 2 &&
      currentParts.every((p) => !previousParts.includes(p.id)),
    'Purchase/part replacements were not atomic and UUID-preserving for the purchase',
  )
  pass(
    'concurrent edits of one unsettled purchase preserve purchase UUID, replace installments atomically with tombstones, and require explicit conflict resolution',
  )
  await a.repositories.credit.archiveCard(newCard.id, true)
  await a.flush()
  await b.pull()
  assert((await b.db.cards.get(newCard.id)).archived, 'Card archive not propagated')
  const protectedView = await transport.view(identity.accessToken, new AbortController().signal)
  const paidPurchase = incremental
    .wireData(mapping.decodeRemoteBackup(protectedView.data, identity.userId), identity.userId)
    .purchases.find((p) => p.id === backup.data.purchases[0].id)
  const unsafeCancel = await call('/operations', {
    kind: 'changes',
    operationId: randomUUID(),
    expectedRevision: protectedView.revision,
    payloadText: protocol.canonicalJson({
      protocol: 2,
      asOf: '2026-11-04',
      changes: [
        {
          entity: 'purchases',
          id: paidPurchase.id,
          row: {
            ...paidPurchase,
            status: 'cancelled',
            cancellation_reason: 'Tentativa inválida de homologação',
          },
        },
      ],
    }),
  })
  assert(
    unsafeCancel.status === 422,
    'Paid purchase cancellation bypassed the existing history guard',
  )
  const charge = await a.repositories.credit.addCharge(
    backup.data.invoices[1].id,
    20,
    '2026-11-04',
    'Encargo fictício',
    categoryId,
  )
  await a.flush()
  await b.pull()
  await a.repositories.credit.reverseCharge(
    charge.id,
    '2026-11-04',
    'Estorno explícito de homologação',
  )
  await a.flush()
  await b.pull()
  assert((await b.db.invoiceEntries.count()) === 2, 'Charge and reversal not preserved as history')
  pass(
    'real Worker/RPC bundles cover accounts/categories, Pix income/expense, transfer correction, adjustments, card creation/archive, charge and reversal',
  )
  const cursorBase = (await transport.view(identity.accessToken, new AbortController().signal))
    .revision
  await a.mutate('paged-category-batch', async (r) => {
    for (let i = 0; i < 105; i++)
      await r.categories.create({
        name: 'Categoria fictícia ' + i,
        direction: 'expense',
        color: 'rose',
        icon: 'coffee',
      })
  })
  await a.flush()
  let page = await transport.page(
    { p_after: cursorBase, p_limit: 40 },
    identity.accessToken,
    new AbortController().signal,
  )
  const watermark = page.until,
    feed = [...page.events]
  await a.mutate('write-during-pagination', (r) =>
    r.categories.create({
      name: 'Criada entre páginas',
      direction: 'expense',
      color: 'rose',
      icon: 'coffee',
    }),
  )
  await a.flush()
  while (page.events.length === 40) {
    const last = page.events.at(-1)
    page = await transport.page(
      {
        p_after: cursorBase,
        p_until: watermark,
        p_revision: last.revision,
        p_entity: last.entity,
        p_id: last.id,
        p_limit: 40,
      },
      identity.accessToken,
      new AbortController().signal,
    )
    feed.push(...page.events)
  }
  assert(
    feed.length === 210 &&
      feed.every((e) => e.revision <= watermark) &&
      new Set(feed.map((e) => e.entity + ':' + e.id)).size === 210,
    'Pagination lost or duplicated events',
  )
  const later = await transport.page(
    { p_after: watermark },
    identity.accessToken,
    new AbortController().signal,
  )
  assert(
    later.events.length === 2 && later.until === watermark + 1,
    'Concurrent page write was lost',
  )
  await b.pull()
  assert((await b.db.categories.count()) === 108, 'Multi-page client staging lost categories')
  pass(
    'immutable multi-page cursor holds watermark during concurrent write; next cursor receives all later changes',
  )
  // Cross-user payload and FK attempts rejected without a revision/receipt/partial update.
  const before = await transport.view(identity.accessToken, new AbortController().signal)
  const malicious = {
    protocol: 2,
    asOf: '2026-11-04',
    changes: [{ entity: 'accounts', id: accountId, row: before.data.accounts[0] }],
  }
  assert(
    !(
      await call(
        '/operations',
        {
          operationId: randomUUID(),
          expectedRevision: 0,
          payloadText: protocol.canonicalJson(malicious),
          kind: 'changes',
        },
        sessions[1],
      )
    ).ok,
    'Cross-owner write accepted',
  )
  assert(
    (await transport.view(sessions[1].accessToken, new AbortController().signal)).data.accounts
      .length === 0,
    'Cross-owner read leaked',
  )
  const invalid = structuredClone(malicious)
  invalid.changes[0].row = {
    ...before.data.accounts[0],
    user_id: identity.userId,
    id: randomUUID(),
  }
  invalid.changes[0].id = invalid.changes[0].row.id
  // Domain validation rejects invalid references before any approval.
  invalid.changes[0] = {
    entity: 'transactions',
    id: randomUUID(),
    row: { ...before.data.transactions[0], id: randomUUID(), account_id: randomUUID() },
  }
  invalid.changes[0].row.id = invalid.changes[0].id
  assert(
    !(
      await call('/operations', {
        operationId: randomUUID(),
        expectedRevision: before.revision,
        payloadText: protocol.canonicalJson(invalid),
        kind: 'changes',
      })
    ).ok,
    'Invalid references accepted',
  )
  assert(
    (await transport.view(identity.accessToken, new AbortController().signal)).revision ===
      before.revision,
    'Failed validation advanced head',
  )
  pass('real JWT owner isolation and foreign references rejected without partial writes')
  await a.mutate('logout-pending', command('Pendente no logout'))
  const queued = await a.pending()
  identity = null
  a.stop()
  await a.flush().then(
    () => {
      throw new Error('Sent after logout')
    },
    () => {},
  )
  identity = sessions[1]
  const switched = new outbox.SyncClient(
    a.db,
    sessions[0].userId,
    transport,
    () => identity,
    '2026-11-04',
    () => clock,
  )
  await switched.flush().then(
    () => {
      throw new Error('Sent with another user')
    },
    () => {},
  )
  assert((await a.pending())[0].id === queued[0].id, 'Logout deleted pending data')
  identity = sessions[0]
  a = new outbox.SyncClient(
    a.db,
    identity.userId,
    transport,
    () => identity,
    '2026-11-04',
    () => clock,
  )
  await a.flush()
  await b.pull()
  pass('logout/account switch prevents transmission and preserves durable pending data')
  activeClients.push(a, b)
  await a.repositories.movements.create({
    kind: 'transaction',
    accountId,
    categoryId,
    description: 'Envio automático fictício',
    amountCents: 1,
    direction: 'expense',
    method: 'debit',
    date: '2026-11-03',
    status: 'settled',
    settledDate: '2026-11-03',
  })
  a.start()
  b.start()
  let arrived = false
  for (let i = 0; i < 30; i++) {
    if (
      (await b.db.transactions.toArray()).some(
        (t) => t.description === 'Envio automático fictício',
      ) &&
      !(await a.pending()).length
    ) {
      arrived = true
      break
    }
    await setTimeout(500)
  }
  a.stop()
  b.stop()
  assert(arrived, 'Opt-in scheduler did not propagate queued changes')
  pass('opt-in scheduler drains durable outbox and pulls incremental changes between clients')
  const finalA = incremental.wireData(await a.repositories.backup.export(), identity.userId)
  const finalB = incremental.wireData(await b.repositories.backup.export(), identity.userId)
  const remote = await transport.view(identity.accessToken, new AbortController().signal)
  const manifests = await Promise.all(
    [finalA, finalB, remote.data].map((data) =>
      protocol.reconciliationManifest(
        mapping.decodeRemoteBackup(data, identity.userId),
        '2026-11-04',
      ),
    ),
  )
  assert(
    manifests.every((m) => protocol.canonicalJson(m) === protocol.canonicalJson(manifests[0])),
    'Final financial reconciliation diverged',
  )
  report.reconciliation = manifests[0]
  pass('two clients and real PostgreSQL reconcile all balances, invoices, cards, UUIDs and totals')
  report.application = await testApplicationSyncFlow({
    vite,
    session: sessions[1],
    workerUrl,
    databases,
    pass,
  })
  report.timezones = await checkFinancialTimezones()
  pass(
    'financial calendar and installments are identical in São Paulo, UTC, New York and Lisbon processes across day/month/leap/DST boundaries',
  )
  if (process.argv.includes('--ui')) {
    const email = `sync-import-${randomUUID()}@example.invalid`,
      password = 'Local-fixture-' + randomUUID()
    const importUser = await auth('/admin/users', { email, password, email_confirm: true })
    owners.push(importUser.id)
    const importLogin = await auth('/token?grant_type=password', { email, password }, keys.ANON_KEY)
    labServer = await serveSyncLab({
      vite,
      workerUrl,
      sessions,
      importSession: { userId: importUser.id, accessToken: importLogin.access_token },
      runId: stage.split('/').at(-1),
      asOf: '2026-11-04',
    })
    report.interactiveLab = { url: labServer.url, syntheticOnly: true }
    writeFileSync(
      join(evidence, 'interactive-lab.json'),
      JSON.stringify(report.interactiveLab, null, 2),
    )
    console.log(`LAB PC: ${labServer.url}/?device=pc`)
    console.log(`LAB PHONE: ${labServer.url}/?device=phone`)
    console.log(`LAB IMPORT: ${labServer.url}/?device=migration`)
    console.log(`MAIN APP PC: ${labServer.url}/app?device=pc`)
    console.log(`MAIN APP PHONE: ${labServer.url}/app?device=phone`)
    console.log(
      'Only synthetic local data. Ctrl+C closes the lab and removes ONLY local fixtures/candidate SQL.',
    )
    await new Promise((resolve) => {
      const done = () => {
        process.removeListener('SIGINT', done)
        globalThis.clearTimeout(timer)
        resolve()
      }
      const seconds = Number(
        process.argv.find((a) => a.startsWith('--ui-duration='))?.split('=')[1] ?? 0,
      )
      const timer =
        seconds > 0 ? globalThis.setTimeout(done, Math.min(seconds, 600) * 1000) : undefined
      process.once('SIGINT', done)
    })
  }
} catch (error) {
  report.error = error.message
  if (workerOutput)
    report.runtimeLog = workerOutput
      .replaceAll(keys.ANON_KEY, '[local-key]')
      .replaceAll(validatorTokenForRedaction(), '[validator-token]')
  writeFileSync(join(evidence, 'failure.log'), error.stack ?? String(error))
  console.error('FAIL ' + error.message)
  process.exitCode = 1
} finally {
  if (labServer) await labServer.close()
  for (const client of activeClients) client.stop()
  if (server) await new Promise((resolve) => server.close(resolve))
  if (workerProcess)
    await run('taskkill.exe', ['/PID', String(workerProcess.pid), '/T', '/F']).catch(() => {})
  if (existsSync(workerSecrets)) unlinkSync(workerSecrets)
  if (vite) await vite.close()
  for (const db of databases) db.close()
  // Synthetic IndexedDBs are deliberately retained in the simulated process; no application DB is opened.
  if (installed) {
    try {
      const ids = owners.map((id) => `'${id}'`).join(',') || 'null'
      await sql(`begin;
        delete from ms_sync_private.feed where user_id in (${ids});
        delete from ms_sync_private.record_versions where user_id in (${ids});
        delete from ms_sync_private.operations where user_id in (${ids});
        delete from ms_sync_private.approvals where user_id in (${ids});
        delete from ms_sync_private.heads where user_id in (${ids});
        ${entities.map((e) => `delete from public.ms_${e} where user_id in (${ids});`).join('\n')}
        delete from auth.users where id in (${ids}); set constraints all immediate;
        drop function public.ms_apply_changes(uuid,bigint,text),public.ms_changes(bigint,bigint,bigint,text,uuid,integer),public.ms_sync_view(uuid),public.ms_approve(uuid,uuid,bigint,text,text,text),public.ms_import_initial(uuid,bigint,text);
        ${entities.map((e) => `drop policy sync_executor on public.ms_${e}; revoke all on public.ms_${e} from money_saver_sync_executor;`).join('\n')}
        revoke execute on function public.ms_snapshot() from money_saver_sync_executor;
        drop schema ms_sync_private cascade;
        revoke all on schema public from money_saver_sync_executor,money_saver_sync_validator;
        revoke money_saver_sync_validator from authenticator;
        drop role money_saver_sync_executor; drop role money_saver_sync_validator;
        notify pgrst,'reload schema'; commit;`)
      pass('local candidate/fixtures removed, baseline RLS and blocked financial writes restored')
    } catch (error) {
      report.cleanupError = error.message
      process.exitCode = 1
      console.error('Cleanup failed; inspect local evidence')
    }
  }
  report.finishedAt = new Date().toISOString()
  writeFileSync(join(evidence, 'report.json'), JSON.stringify(report, null, 2))
}
function validatorTokenForRedaction() {
  if (!existsSync(workerSecrets)) return 'not-present'
  return /SYNC_VALIDATOR_TOKEN=(.*)/.exec(readFileSync(workerSecrets, 'utf8'))?.[1] ?? 'not-present'
}
// Allow the local PostgREST schema cache notification to settle for subsequent runs.
await setTimeout(500)
