import type { CreditCardInvoice, InvoicePayment } from '@/domain/models'
import type { FinanceData } from '@/hooks/use-finances'
import { invoiceSummary } from '@/domain/credit'
import { today } from '@/domain/financial-validation'
import { Button } from '@/components/ui/button'
import { PaymentHistory } from './PaymentHistory'
import type { CreditAction } from './CreditActionForm'
import { invoiceStateLabels } from './constants'
export function InvoicePanel({
  data,
  invoice,
  money,
  onPay,
  onAction,
  onReceipt,
  onCorrect,
  onReverse,
  onBack,
}: {
  data: FinanceData
  invoice: CreditCardInvoice
  money: (cents: number) => string
  onPay: () => void
  onAction: (action: CreditAction) => void
  onReceipt: (p: InvoicePayment) => void
  onCorrect: (p: InvoicePayment) => void
  onReverse: (p: InvoicePayment) => void
  onBack: () => void
}) {
  const value = invoiceSummary(data, invoice, today()),
    card = data.cards.find((c) => c.id === invoice.cardId)!
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>
            {card.name} · Fatura {invoice.period}
          </h2>
          <p className="form-hint">
            Período {invoice.startDate?.split('-').reverse().join('/') ?? 'anterior ao fechamento'}{' '}
            até {invoice.closingDate.split('-').reverse().join('/')} (exclusivo). Vence em{' '}
            {invoice.dueDate.split('-').reverse().join('/')}.
          </p>
        </div>
        <Button variant="outline" onClick={onBack}>
          Todas as faturas
        </Button>
      </div>
      <div className="invoice-status-line">
        <span className="phase-badge">Ciclo {value.closed ? 'fechado' : 'aberto'}</span>
        <span
          className={`status-badge ${value.state === 'overdue' ? 'status-pending' : value.remaining === 0 ? 'status-settled' : 'status-planned'}`}
        >
          {invoiceStateLabels[value.state]}
        </span>
        {value.remaining === 0 && value.original === 0 && (
          <span className="muted">Sem valores de compra neste ciclo</span>
        )}
      </div>
      <div className="credit-metrics">
        {[
          ['Total original', value.original],
          ['Juros financiados + encargos', value.financedFees + value.charges],
          ['Ajustes / créditos', value.adjustments],
          ['Total devido', value.totalDue],
          ['Total pago', value.paid],
          ['Saldo pendente', value.remaining],
          ['Crédito de fatura', value.credit],
        ].map(([label, amount]) => (
          <section className="metric" key={label as string}>
            <div className="metric-top">{label}</div>
            <strong className="metric-value">{money(amount as number)}</strong>
          </section>
        ))}
      </div>
      <div className="credit-toolbar">
        <Button onClick={onPay} disabled={value.remaining <= 0}>
          Registrar pagamento
        </Button>
        <Button variant="outline" onClick={() => onAction({ kind: 'charge', invoice })}>
          Registrar encargo
        </Button>
        {value.credit > 0 && (
          <Button variant="outline" onClick={() => onAction({ kind: 'credit', invoice })}>
            Aplicar crédito em outra fatura
          </Button>
        )}
      </div>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Compras e parcelas</h2>
            <p>Valores originais preservados, com estornos registrados separadamente.</p>
          </div>
        </div>
        {value.installments.length ? (
          <div className="table-scroll">
            <table className="movement-table">
              <thead>
                <tr>
                  <th>Compra</th>
                  <th>Data</th>
                  <th>Parcela</th>
                  <th>Principal</th>
                  <th>Acréscimo</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {value.installments.map((i) => {
                  const p = data.purchases.find((p) => p.id === i.purchaseId)!
                  return (
                    <tr key={i.id}>
                      <td>
                        {p.description}
                        <small>{data.categories.find((c) => c.id === p.categoryId)?.name}</small>
                      </td>
                      <td>{p.date.split('-').reverse().join('/')}</td>
                      <td>
                        {i.number}/{p.installmentCount}
                      </td>
                      <td>{money(i.principalCents ?? i.amountCents)}</td>
                      <td>{money(i.amountCents - (i.principalCents ?? i.amountCents))}</td>
                      <td>{money(i.amountCents)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="credit-empty">Sem parcelas ativas nesta fatura.</p>
        )}
      </section>
      <section className="panel credit-section">
        <div className="panel-header">
          <div>
            <h2>Ajustes e créditos</h2>
            <p>Juros e multas só existem quando registrados explicitamente.</p>
          </div>
        </div>
        {value.entries.length ? (
          <div className="table-scroll">
            <table className="movement-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Descrição</th>
                  <th>Tipo</th>
                  <th>Valor</th>
                </tr>
              </thead>
              <tbody>
                {value.entries.map((e) => (
                  <tr key={e.id}>
                    <td>{e.date.split('-').reverse().join('/')}</td>
                    <td>
                      {e.description}
                      {e.kind === 'charge' &&
                        !data.invoiceEntries.some((row) => row.originalEntryId === e.id) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onAction({ kind: 'reverse-charge', entry: e })}
                          >
                            Estornar encargo
                          </Button>
                        )}
                    </td>
                    <td>
                      {
                        {
                          charge: 'Encargo',
                          refund: 'Estorno de compra',
                          'credit-in': 'Crédito aplicado',
                          'credit-out': 'Crédito transferido',
                          'charge-reversal': 'Estorno de encargo',
                        }[e.kind]
                      }
                    </td>
                    <td>
                      {e.kind === 'refund' || e.kind === 'credit-in' || e.kind === 'charge-reversal'
                        ? '− '
                        : '+ '}
                      {money(e.amountCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="credit-empty">Nenhum encargo ou ajuste registrado.</p>
        )}
      </section>
      <section className="panel credit-section">
        <div className="panel-header">
          <div>
            <h2>Histórico de pagamentos</h2>
            <p>Saídas bancárias vinculadas a esta fatura.</p>
          </div>
        </div>
        <PaymentHistory
          data={data}
          payments={data.payments.filter((p) => p.invoiceId === invoice.id)}
          money={money}
          onReceipt={onReceipt}
          onCorrect={onCorrect}
          onReverse={onReverse}
        />
      </section>
    </>
  )
}
