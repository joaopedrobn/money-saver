import type { FinanceData } from '@/hooks/use-finances'
import type { InvoicePayment } from '@/domain/models'
import { Button } from '@/components/ui/button'
export function PaymentHistory({
  data,
  payments,
  money,
  onReceipt,
  onCorrect,
  onReverse,
}: {
  data: FinanceData
  payments: InvoicePayment[]
  money: (cents: number) => string
  onReceipt: (p: InvoicePayment) => void
  onCorrect: (p: InvoicePayment) => void
  onReverse: (p: InvoicePayment) => void
}) {
  if (!payments.length)
    return (
      <p className="credit-empty">
        Nenhum pagamento registrado. Vincular uma conta não realiza pagamentos.
      </p>
    )
  return (
    <div className="table-scroll">
      <table className="movement-table">
        <thead>
          <tr>
            <th>Data efetiva</th>
            <th>Fatura / conta</th>
            <th>Valor</th>
            <th>Situação</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {[...payments]
            .sort(
              (a, b) =>
                b.date.localeCompare(a.date) ||
                b.createdAt.localeCompare(a.createdAt) ||
                a.id.localeCompare(b.id),
            )
            .map((p) => (
              <tr key={p.id}>
                <td>{p.date.split('-').reverse().join('/')}</td>
                <td>
                  {data.invoices.find((i) => i.id === p.invoiceId)?.period}
                  <small>{data.accounts.find((a) => a.id === p.accountId)?.name}</small>
                </td>
                <td>{money(p.amountCents)}</td>
                <td>
                  {p.reversalDate
                    ? `Estornado em ${p.reversalDate.split('-').reverse().join('/')}`
                    : 'Efetivado'}
                </td>
                <td>
                  <div className="credit-row-actions">
                    <Button variant="ghost" size="sm" onClick={() => onReceipt(p)}>
                      Comprovante interno
                    </Button>
                    {!p.reversalDate && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => onCorrect(p)}>
                          Corrigir
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => onReverse(p)}>
                          Estornar
                        </Button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  )
}
