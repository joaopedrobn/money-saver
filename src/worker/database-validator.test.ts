import { expect, it } from 'vitest'
import { validatorDatabaseOptions } from './database-validator'

it('requires the dedicated role and exact project pooler with TLS', () => {
  const url =
    'postgresql://money_saver_worker_validator.iwzmsbkbuerleocismhj:unit@aws-0-us-east-2.pooler.supabase.com:5432/postgres'
  expect(validatorDatabaseOptions(url, false)).toEqual({ ssl: 'require' })
  for (const invalid of [
    url.replace('money_saver_worker_validator.iwzmsbkbuerleocismhj', 'postgres'),
    url.replace('aws-0-us-east-2', 'aws-0-us-east-1'),
    url + '?sslmode=disable',
  ])
    expect(() => validatorDatabaseOptions(invalid, false)).toThrow('Restricted')
})
it('permits loopback only for local tests and never for the remote worker', () => {
  const url = 'postgresql://money_saver_worker_validator:unit@127.0.0.1:54322/postgres'
  expect(validatorDatabaseOptions(url, true)).toEqual({ ssl: false })
  expect(() => validatorDatabaseOptions(url, false)).toThrow('Restricted')
})
