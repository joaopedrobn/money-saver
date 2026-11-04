import type { Backup } from '@/domain/backup'
export const owner = '11111111-1111-4111-8111-111111111111'
export const operationId = '99999999-9999-4999-8999-999999999999'
export const projectUrl = 'https://abcdefghijklmnopqrst.supabase.co'
const base = { createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z' }
const accountId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const categoryId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const cardId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const purchaseId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
export function fixture(): Backup {
  return {
    app: 'money-saver',
    version: 2,
    schemaVersion: 4,
    exportedAt: '2026-11-04T12:00:00.000Z',
    data: {
      accounts: [
        {
          ...base,
          id: accountId,
          name: 'Principal',
          institution: 'Teste',
          type: 'checking',
          openingBalanceCents: 10000,
          openingDate: '2026-01-01',
          color: 'sage',
        },
      ],
      categories: [
        {
          ...base,
          id: categoryId,
          name: 'Compras',
          direction: 'expense',
          color: 'rose',
          icon: 'coffee',
        },
      ],
      cards: [
        {
          ...base,
          id: cardId,
          accountId,
          name: 'Cartão teste',
          limitCents: 100000,
          closingDay: 5,
          dueDay: 15,
        },
      ],
      purchases: [
        {
          ...base,
          id: purchaseId,
          cardId,
          categoryId,
          description: 'Compra fictícia',
          amountCents: 1000,
          date: '2026-10-01',
          installmentCount: 2,
          feeCents: 0,
          status: 'active',
        },
      ],
      invoices: [
        {
          ...base,
          id: '44444444-4444-4444-8444-444444444444',
          cardId,
          period: '2026-10',
          closingDate: '2026-10-05',
          dueDate: '2026-10-15',
          startDate: '2026-09-05',
        },
        {
          ...base,
          id: '55555555-5555-4555-8555-555555555555',
          cardId,
          period: '2026-11',
          closingDate: '2026-11-05',
          dueDate: '2026-11-15',
          startDate: '2026-10-05',
        },
      ],
      installments: [
        {
          ...base,
          id: '66666666-6666-4666-8666-666666666666',
          purchaseId,
          invoiceId: '44444444-4444-4444-8444-444444444444',
          number: 1,
          amountCents: 500,
          principalCents: 500,
        },
        {
          ...base,
          id: '77777777-7777-4777-8777-777777777777',
          purchaseId,
          invoiceId: '55555555-5555-4555-8555-555555555555',
          number: 2,
          amountCents: 500,
          principalCents: 500,
        },
      ],
      transactions: [
        {
          ...base,
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          accountId,
          categoryId,
          description: 'Despesa teste',
          amountCents: 100,
          direction: 'expense',
          method: 'debit',
          date: '2026-10-02',
          status: 'settled',
          settledDate: '2026-10-02',
        },
      ],
      payments: [
        {
          ...base,
          id: '88888888-8888-4888-8888-888888888888',
          invoiceId: '44444444-4444-4444-8444-444444444444',
          accountId,
          amountCents: 500,
          date: '2026-10-10',
        },
      ],
      settings: [],
      transfers: [],
      adjustments: [],
      recurring: [],
      occurrences: [],
      budgets: [],
      audit: [],
      invoiceEntries: [],
    },
  }
}
