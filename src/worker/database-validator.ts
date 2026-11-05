import postgres from 'postgres'

export function validatorDatabaseOptions(value: string, local: boolean) {
  const url = new URL(value)
  const remote =
    !local &&
    url.hostname === 'aws-0-us-east-2.pooler.supabase.com' &&
    url.port === '5432' &&
    decodeURIComponent(url.username) === 'money_saver_worker_validator.iwzmsbkbuerleocismhj'
  const lab =
    local &&
    url.hostname === '127.0.0.1' &&
    url.port === '54322' &&
    url.username === 'money_saver_worker_validator'
  if (
    url.protocol !== 'postgresql:' ||
    url.pathname !== '/postgres' ||
    !url.password ||
    url.search ||
    url.hash ||
    (!remote && !lab)
  )
    throw new Error('Restricted validator database configuration required')
  return { ssl: remote ? ('require' as const) : (false as const) }
}
/** Only the pre-existing approval RPC; no arbitrary SQL/table interface is exposed. */
export async function approveThroughDatabase(
  value: string,
  local: boolean,
  input: {
    p_user: string
    p_operation: string
    p_revision: number
    p_hash: string
    p_manifest: string
    p_version: string
  },
) {
  const options = validatorDatabaseOptions(value, local)
  const sql = postgres(value, {
    ...options,
    max: 1,
    prepare: false,
    fetch_types: false,
    connect_timeout: 8,
    idle_timeout: 5,
    connection: { application_name: 'money-saver-validator' },
  })
  try {
    await sql`select public.ms_approve(${input.p_user}::uuid,${input.p_operation}::uuid,${input.p_revision}::bigint,${input.p_hash},${input.p_manifest},${input.p_version})`
  } finally {
    await sql.end({ timeout: 1 })
  }
}

export async function approveThroughHyperdrive(
  connectionString: string,
  input: Parameters<typeof approveThroughDatabase>[2],
) {
  const sql = postgres(connectionString, {
    max: 1,
    fetch_types: false,
    prepare: true,
    connect_timeout: 8,
  })
  try {
    await sql.begin(async (transaction) => {
      const [identity] = await transaction`select current_user as role`
      if (identity.role !== 'money_saver_worker_validator')
        throw new Error('Restricted approval role required')
      await transaction`select public.ms_approve(${input.p_user}::uuid,${input.p_operation}::uuid,${input.p_revision}::bigint,${input.p_hash},${input.p_manifest},${input.p_version})`
    })
  } finally {
    await sql.end({ timeout: 1 })
  }
}
