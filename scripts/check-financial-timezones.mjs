import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import process from 'node:process'
import console from 'node:console'

export async function checkFinancialTimezones() {
  const zones = ['America/Sao_Paulo', 'UTC', 'America/New_York', 'Europe/Lisbon']
  const results = []
  for (const zone of zones) {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !/^(PG|SUPABASE_|VITE_SUPABASE_|MONEY_SAVER_TEST)/.test(key),
      ),
    )
    env.TZ = zone
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [import.meta.filename, '--child'], {
        cwd: process.cwd(),
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let output = '',
        errors = ''
      child.stdout.on('data', (d) => {
        output += d
      })
      child.stderr.on('data', (d) => {
        errors += d
      })
      child.on('error', reject)
      child.on('close', (code) =>
        code
          ? reject(new Error(errors || 'Timezone subprocess failed'))
          : resolve(JSON.parse(output.trim())),
      )
    })
    results.push({ zone, result })
  }
  if (!results.every((r) => JSON.stringify(r.result) === JSON.stringify(results[0].result)))
    throw new Error('Host timezone changes the financial calendar or installment plan')
  if (
    results[0].result.businessDates[0] !== '2024-02-29' ||
    results[0].result.businessDates[1] !== '2024-03-31'
  )
    throw new Error('São Paulo civil date was derived from UTC slicing')
  if (
    results[0].result.leap.dueDate !== '2024-03-05' ||
    results[0].result.nonLeap.closingDate !== '2023-02-28' ||
    results[0].result.invalidLeapAccepted
  )
    throw new Error('Leap year/calendar invariant failed')
  return { zones, cases: results[0].result }
}
if (process.argv.includes('--child')) {
  const vite = await createServer({
    envFile: false,
    logLevel: 'silent',
    server: { middlewareMode: true },
    appType: 'custom',
  })
  try {
    const clock = await vite.ssrLoadModule('/src/domain/civil-clock.ts')
    const credit = await vite.ssrLoadModule('/src/domain/credit.ts')
    const validation = await vite.ssrLoadModule('/src/domain/financial-validation.ts')
    const fixtures = await vite.ssrLoadModule('/src/infrastructure/sync/fixtures.test-data.ts')
    const card = fixtures.fixture().data.cards[0]
    const instants = [
      '2024-03-01T01:30:00Z',
      '2024-04-01T02:59:59Z',
      '2024-04-01T03:00:00Z',
      '2024-03-10T06:59:00Z',
      '2024-03-10T07:01:00Z',
      '2024-11-03T05:59:00Z',
      '2024-11-03T06:01:00Z',
      '2018-11-04T02:59:59Z',
      '2018-11-04T03:00:00Z',
    ]
    const plans = ['2024-02-04', '2024-02-05', '2024-02-29', '2024-12-31'].map((date) =>
      credit
        .installmentPlan(card, { date, amountCents: 1001, feeCents: 1, installmentCount: 3 })
        .map((p) => ({ ...p, cycle: { ...p.cycle } })),
    )
    const saved = {
      ...fixtures.fixture().data.invoices[0],
      period: '2024-02',
      startDate: '2024-01-05',
      closingDate: '2024-02-05',
      dueDate: '2024-02-15',
    }
    const savedPlan = credit.installmentPlan(
      { ...card, closingDay: 10, dueDay: 20 },
      { date: '2024-02-02', amountCents: 100, feeCents: 0, installmentCount: 1 },
      [saved],
    )[0].cycle
    if (savedPlan.closingDate !== saved.closingDate || savedPlan.dueDate !== saved.dueDate)
      throw new Error('Saved invoice dates changed during planning')
    console.log(
      JSON.stringify({
        businessDates: instants.map((s) => clock.civilToday(new Date(s))),
        newYorkDates: instants.map((s) => clock.civilToday(new Date(s), 'America/New_York')),
        leap: credit.invoiceCycle({ closingDay: 31, dueDay: 5 }, '2024-02'),
        nonLeap: credit.invoiceCycle({ closingDay: 31, dueDay: 31 }, '2023-02'),
        invalidLeapAccepted: validation.civilDateSchema.safeParse('2023-02-29').success,
        plans,
        savedPlan,
      }),
    )
  } finally {
    await vite.close()
  }
} else if (process.argv.includes('--run')) {
  const report = await checkFinancialTimezones()
  console.log(
    'PASS financial civil dates, leap years, closing/due dates, saved invoices, monthly installments and DST across ' +
      report.zones.join(', '),
  )
}
