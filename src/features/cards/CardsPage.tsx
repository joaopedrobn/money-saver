import { useState } from 'react'
import {
  CreditCard as CardIcon,
  Plus,
  ArrowLeft,
  Pencil,
  Archive,
  ArchiveRestore,
} from 'lucide-react'
import type {
  CreditCard,
  CreditCardPurchase,
  CreditCardInvoice,
  InvoicePayment,
} from '@/domain/models'
import type { FinanceData } from '@/hooks/use-finances'
import { cardSummary, purchaseActive } from '@/domain/credit'
import { limitHistory, purchaseProgress, refundableAmount } from '@/domain/credit-views'
import { today } from '@/domain/financial-validation'
import { sumCents } from '@/domain/money'
import { repositories } from '@/infrastructure/repositories'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { CardForm } from './CardForm'
import { PurchaseForm } from './PurchaseForm'
import { PaymentForm } from './PaymentForm'
import { PaymentHistory } from './PaymentHistory'
import { InvoicePanel } from './InvoicePanel'
import { invoiceStateLabels } from './constants'
import { CreditActionForm, type CreditAction } from './CreditActionForm'
export function CardsPage({
  data,
  money,
  notify,
}: {
  data: FinanceData
  money: (cents: number) => string
  notify: (message: string) => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null),
    [invoiceId, setInvoiceId] = useState<string | null>(null),
    [tab, setTab] = useState('invoices'),
    [showArchived, setShowArchived] = useState(false),
    [showCompleted, setShowCompleted] = useState(false),
    [cardForm, setCardForm] = useState<{ card?: CreditCard } | null>(null),
    [purchaseForm, setPurchaseForm] = useState<{ purchase?: CreditCardPurchase } | null>(null),
    [paymentForm, setPaymentForm] = useState<{
      invoice: CreditCardInvoice
      payment?: InvoicePayment
    } | null>(null),
    [action, setAction] = useState<CreditAction | null>(null),
    [archive, setArchive] = useState<CreditCard | null>(null),
    [receipt, setReceipt] = useState<InvoicePayment | null>(null),
    [search, setSearch] = useState('')
  const selected = data.cards.find((c) => c.id === selectedId),
    summary = selected ? cardSummary(data, selected, today()) : null,
    invoice = data.invoices.find((i) => i.id === invoiceId && i.cardId === selectedId)
  const visible = data.cards.filter((c) => showArchived || !c.archived),
    totals = data.cards.map((c) => ({ card: c, ...cardSummary(data, c, today()) })),
    contracted = sumCents(data.cards.filter((c) => !c.archived).map((c) => c.limitCents)),
    used = sumCents(totals.map((c) => c.used)),
    available = sumCents(totals.filter((c) => !c.card.archived).map((c) => c.available))
  const purchases = data.purchases
    .filter(
      (p) =>
        (!selected || p.cardId === selected.id) &&
        `${p.description} ${p.notes ?? ''}`
          .toLocaleLowerCase('pt-BR')
          .includes(search.toLocaleLowerCase('pt-BR')),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
  const payments = data.payments.filter(
    (p) => !selected || data.invoices.some((i) => i.id === p.invoiceId && i.cardId === selected.id),
  )
  const installmentPurchases = purchases.filter(
    (p) =>
      p.installmentCount > 1 &&
      purchaseActive(p) &&
      (showCompleted || purchaseProgress(data, p, today()).some((part) => part.remaining > 0)),
  )
  function correct(p: InvoicePayment) {
    setPaymentForm({ invoice: data.invoices.find((i) => i.id === p.invoiceId)!, payment: p })
  }
  const metrics =
    selected && summary
      ? [
          ['Limite contratado', selected.limitCents],
          ['Limite utilizado', summary.used],
          ['Disponível', summary.available],
          ['Crédito em faturas', summary.credit],
        ]
      : [
          ['Limites ativos', contracted],
          ['Comprometido (todos)', used],
          ['Disponível nos ativos', available],
          ['Faturas pendentes', sumCents(totals.map((c) => c.debt))],
        ]
  return (
    <>
      <div className="section-heading">
        <div>
          {selected ? (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  setSelectedId(null)
                  setInvoiceId(null)
                }}
              >
                <ArrowLeft size={15} />
                Todos os cartões
              </Button>
              <h2 className="credit-card-title">
                {selected.name}{' '}
                {selected.archived && <span className="phase-badge">Arquivado</span>}
              </h2>
              <p className="form-hint">
                {selected.institution} {selected.nickname && `· ${selected.nickname}`}{' '}
                {selected.brand && `· ${selected.brand}`}{' '}
                {selected.lastFour && `· final ${selected.lastFour}`}
                <br />
                Conta sugerida: {data.accounts.find((a) => a.id === selected.accountId)?.name} ·
                nenhum pagamento automático
              </p>
            </>
          ) : (
            <>
              <h2>Seus cartões, com clareza.</h2>
              <p className="form-hint">
                Compras comprometem crédito. Somente pagamentos movimentam sua conta.
              </p>
            </>
          )}
        </div>
        <div className="credit-toolbar">
          {selected ? (
            <>
              <Button variant="outline" onClick={() => setCardForm({ card: selected })}>
                <Pencil size={15} />
                Editar cartão
              </Button>
              <Button onClick={() => setPurchaseForm({})} disabled={selected.archived}>
                <Plus size={16} />
                Nova compra
              </Button>
            </>
          ) : (
            <Button
              onClick={() => setCardForm({})}
              disabled={!data.accounts.length || !!data.error}
            >
              <Plus size={16} />
              Novo cartão
            </Button>
          )}
        </div>
      </div>
      {!data.accounts.length && (
        <p className="info-banner">Cadastre uma conta bancária antes de adicionar um cartão.</p>
      )}
      <div className="credit-metrics">
        {metrics.map(([label, value]) => (
          <section className="metric" key={label as string}>
            <div className="metric-top">{label}</div>
            <strong className={`metric-value ${(value as number) < 0 ? 'expense-text' : ''}`}>
              {money(value as number)}
            </strong>
          </section>
        ))}
      </div>
      {(summary ? summary.available < 0 : totals.some((c) => c.available < 0)) && (
        <p className="warning-banner">
          Há compras acima do limite cadastrado. O registro é permitido; acompanhe o comprometimento
          e ajuste o limite contratado se necessário.
        </p>
      )}
      {!selected ? (
        <>
          <label className="checkbox-label credit-section">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Mostrar cartões arquivados (suas dívidas continuam nos totais)
          </label>
          {visible.length ? (
            <div className="card-grid">
              {visible.map((card) => {
                const value = cardSummary(data, card, today())
                return (
                  <article className="panel credit-card" key={card.id}>
                    <div className="account-card-top">
                      <span className={`account-symbol ${card.color ?? 'sage'}`}>
                        <CardIcon size={24} />
                      </span>
                      <span className="phase-badge">
                        {card.archived ? 'Arquivado' : card.brand || 'Crédito'}
                      </span>
                    </div>
                    <h2>{card.name}</h2>
                    <p>
                      {card.institution}
                      {card.lastFour ? ` · •••• ${card.lastFour}` : ''}
                    </p>
                    <dl className="detail-list">
                      <div>
                        <dt>Limite utilizado</dt>
                        <dd>{money(value.used)}</dd>
                      </div>
                      <div>
                        <dt>Disponível</dt>
                        <dd>{money(value.available)}</dd>
                      </div>
                      <div>
                        <dt>Fatura atual / aberta</dt>
                        <dd>{money(value.current?.remaining ?? 0)}</dd>
                      </div>
                      <div>
                        <dt>Próxima fatura</dt>
                        <dd>{money(value.next?.remaining ?? 0)}</dd>
                      </div>
                      <div>
                        <dt>Próximo vencimento</dt>
                        <dd>{value.nextDue?.split('-').reverse().join('/') ?? 'Sem pendências'}</dd>
                      </div>
                    </dl>
                    <Button
                      variant="outline"
                      className="full-width"
                      onClick={() => {
                        setSelectedId(card.id)
                        setInvoiceId(null)
                        setTab('invoices')
                      }}
                    >
                      Ver cartão e faturas
                    </Button>
                    <div className="account-card-actions">
                      <Button variant="ghost" size="sm" onClick={() => setCardForm({ card })}>
                        <Pencil size={14} />
                        Editar
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setArchive(card)}>
                        {card.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}{' '}
                        {card.archived ? 'Reativar' : 'Arquivar'}
                      </Button>
                    </div>
                  </article>
                )
              })}
            </div>
          ) : (
            <section className="panel large-empty">
              <span className="empty-icon large">
                <CardIcon size={30} />
              </span>
              <h2>Do primeiro crédito à última parcela.</h2>
              <p>
                Adicione seus cartões para organizar compras, limites e faturas.
                <br />
                Nenhum dado bancário de autenticação é necessário.
              </p>
              <Button onClick={() => setCardForm({})} disabled={!data.accounts.length}>
                Cadastrar primeiro cartão
              </Button>
            </section>
          )}
          {data.purchases.length > 0 && (
            <section className="panel credit-section">
              <div className="panel-header">
                <div>
                  <h2>Compras recentes</h2>
                  <p>Os últimos registros no crédito, em todos os cartões.</p>
                </div>
              </div>
              <div className="summary-list">
                {[...data.purchases]
                  .sort(
                    (a, b) =>
                      b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
                  )
                  .slice(0, 5)
                  .map((p) => (
                    <div className="dashboard-movement" key={p.id}>
                      <div>
                        <strong>{p.description}</strong>
                        <small>
                          {data.cards.find((c) => c.id === p.cardId)?.name} · {p.installmentCount}x
                          ·{' '}
                          {p.status === 'cancelled'
                            ? 'Cancelada'
                            : p.date.split('-').reverse().join('/')}
                        </small>
                      </div>
                      <strong>{money(p.amountCents + (p.feeCents ?? 0))}</strong>
                    </div>
                  ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <>
          <div className="credit-tabs" role="navigation" aria-label="Áreas do cartão">
            {[
              ['invoices', 'Faturas'],
              ['purchases', 'Compras'],
              ['installments', 'Parcelamentos'],
              ['payments', 'Pagamentos'],
              ['limit', 'Evolução do limite'],
            ].map(([id, label]) => (
              <Button
                key={id}
                variant={tab === id ? 'default' : 'ghost'}
                onClick={() => {
                  setTab(id)
                  setInvoiceId(null)
                }}
                aria-pressed={tab === id}
              >
                {label}
              </Button>
            ))}
            <Button variant="ghost" onClick={() => setArchive(selected)}>
              {selected.archived ? 'Reativar cartão' : 'Arquivar cartão'}
            </Button>
          </div>
          {tab === 'invoices' &&
            (invoice ? (
              <InvoicePanel
                data={data}
                invoice={invoice}
                money={money}
                onPay={() => setPaymentForm({ invoice })}
                onAction={setAction}
                onReceipt={setReceipt}
                onCorrect={correct}
                onReverse={(payment) => setAction({ kind: 'reverse', payment })}
                onBack={() => setInvoiceId(null)}
              />
            ) : (
              <section className="panel">
                {summary?.invoices.length ? (
                  <div className="table-scroll">
                    <table className="movement-table">
                      <thead>
                        <tr>
                          <th>Competência</th>
                          <th>Fechamento / vencimento</th>
                          <th>Ciclo / pagamento</th>
                          <th>Total devido</th>
                          <th>Pago</th>
                          <th>Pendente / crédito</th>
                          <th>Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.invoices.map((v) => (
                          <tr key={v.invoice.id}>
                            <td>{v.invoice.period}</td>
                            <td>
                              {v.invoice.closingDate.split('-').reverse().join('/')}
                              <small>
                                Vence {v.invoice.dueDate.split('-').reverse().join('/')}
                              </small>
                            </td>
                            <td>
                              {v.closed ? 'Fechada' : 'Aberta'}
                              <small>{invoiceStateLabels[v.state]}</small>
                            </td>
                            <td>{money(v.totalDue)}</td>
                            <td>{money(v.paid)}</td>
                            <td>
                              {money(v.remaining)}
                              {v.credit > 0 && <small>Crédito {money(v.credit)}</small>}
                            </td>
                            <td>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setInvoiceId(v.invoice.id)}
                              >
                                Detalhar fatura
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="credit-empty">
                    As faturas serão criadas ao registrar a primeira compra, incluindo todas as
                    parcelas futuras.
                  </p>
                )}
              </section>
            ))}
          {tab === 'purchases' && (
            <section className="panel">
              <div className="movement-filters">
                <label className="search-filter">
                  Pesquisar compras
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Descrição ou observações"
                  />
                </label>
              </div>
              {purchases.length ? (
                <div className="table-scroll">
                  <table className="movement-table">
                    <thead>
                      <tr>
                        <th>Compra</th>
                        <th>Data / categoria</th>
                        <th>Total / acréscimo</th>
                        <th>Parcelas</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {purchases.map((p) => {
                        const locked =
                          data.payments.some((pay) =>
                            data.installments.some(
                              (i) => i.purchaseId === p.id && i.invoiceId === pay.invoiceId,
                            ),
                          ) || data.invoiceEntries.some((e) => e.purchaseId === p.id)
                        return (
                          <tr key={p.id}>
                            <td>
                              {p.description}
                              <small className="notes">{p.notes}</small>
                              {p.status === 'cancelled' && (
                                <span className="status-badge status-cancelled">Cancelada</span>
                              )}
                            </td>
                            <td>
                              {p.date.split('-').reverse().join('/')}
                              <small>
                                {data.categories.find((c) => c.id === p.categoryId)?.name}
                              </small>
                            </td>
                            <td>
                              {money(p.amountCents + (p.feeCents ?? 0))}
                              <small>Acréscimo {money(p.feeCents ?? 0)}</small>
                            </td>
                            <td>{p.installmentCount}x</td>
                            <td>
                              <div className="credit-row-actions">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={!purchaseActive(p)}
                                  onClick={() => setPurchaseForm({ purchase: p })}
                                >
                                  {locked ? 'Descrição / observações' : 'Editar'}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={!purchaseActive(p) || refundableAmount(data, p) <= 0}
                                  onClick={() => setAction({ kind: 'refund', purchase: p })}
                                >
                                  Estornar compra
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={locked || !purchaseActive(p)}
                                  title={
                                    locked
                                      ? 'Há histórico de liquidação ou estorno; use Estornar compra.'
                                      : undefined
                                  }
                                  onClick={() => setAction({ kind: 'cancel', purchase: p })}
                                >
                                  Cancelar registro
                                </Button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="credit-empty">Nenhuma compra encontrada.</p>
              )}
            </section>
          )}
          {tab === 'installments' && (
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Parcelamentos e parcelas futuras</h2>
                  <p>Valores originais e situação das faturas, sem recriar parcelas liquidadas.</p>
                </div>
              </div>
              <label className="checkbox-label credit-checkbox">
                <input
                  type="checkbox"
                  checked={showCompleted}
                  onChange={(e) => setShowCompleted(e.target.checked)}
                />
                Mostrar parcelamentos concluídos ou estornados
              </label>
              {installmentPurchases.length ? (
                installmentPurchases.map((p) => (
                  <div className="installment-group" key={p.id}>
                    <h3>
                      {p.description} · {p.installmentCount}x
                    </h3>
                    <div className="table-scroll">
                      <table className="movement-table">
                        <thead>
                          <tr>
                            <th>Parcela</th>
                            <th>Competência / vencimento</th>
                            <th>Valor original</th>
                            <th>Situação</th>
                            <th>Fatura</th>
                          </tr>
                        </thead>
                        <tbody>
                          {purchaseProgress(data, p, today()).map((r) => (
                            <tr key={r.part.id}>
                              <td>
                                {r.part.number}/{p.installmentCount}
                              </td>
                              <td>
                                {r.invoice.period}
                                <small>{r.invoice.dueDate.split('-').reverse().join('/')}</small>
                              </td>
                              <td>{money(r.part.amountCents)}</td>
                              <td>{r.state}</td>
                              <td>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setTab('invoices')
                                    setInvoiceId(r.invoice.id)
                                  }}
                                >
                                  Consultar fatura
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))
              ) : (
                <p className="credit-empty">Nenhum parcelamento ativo neste cartão.</p>
              )}
            </section>
          )}
          {tab === 'payments' && (
            <section className="panel">
              <PaymentHistory
                data={data}
                payments={payments}
                money={money}
                onReceipt={setReceipt}
                onCorrect={correct}
                onReverse={(payment) => setAction({ kind: 'reverse', payment })}
              />
            </section>
          )}
          {tab === 'limit' && (
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Comprometimento do limite ao longo do tempo</h2>
                  <p>
                    Saldos ao final de cada dia com eventos. Disponível usa o limite contratado
                    atual como referência.
                  </p>
                </div>
              </div>
              {limitHistory(data, selected, today()).length ? (
                <div className="table-scroll">
                  <table className="movement-table">
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Utilizado</th>
                        <th>Disponível (referência atual)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {limitHistory(data, selected, today()).map((row) => (
                        <tr key={row.date}>
                          <td>{row.date.split('-').reverse().join('/')}</td>
                          <td>{money(row.used)}</td>
                          <td>{money(row.available)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="credit-empty">
                  A evolução aparecerá após registrar compras ou pagamentos.
                </p>
              )}
            </section>
          )}
        </>
      )}
      <Dialog
        open={!!cardForm}
        onOpenChange={(open) => {
          if (!open) setCardForm(null)
        }}
        title={cardForm?.card ? 'Editar cartão' : 'Novo cartão'}
        description="Configure o crédito sem compartilhar dados bancários sensíveis."
      >
        {cardForm && (
          <CardForm
            data={data}
            card={cardForm.card}
            onDone={() => {
              setCardForm(null)
              notify('Cartão salvo. Faturas anteriores mantiveram suas datas.')
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={!!purchaseForm}
        onOpenChange={(open) => {
          if (!open) setPurchaseForm(null)
        }}
        title={purchaseForm?.purchase ? 'Editar compra' : 'Nova compra no crédito'}
        description="Revise as parcelas antes de confirmar."
      >
        {purchaseForm && (
          <PurchaseForm
            data={data}
            purchase={purchaseForm.purchase}
            cardId={selected?.id}
            onDone={(message) => {
              setPurchaseForm(null)
              notify(message)
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={!!paymentForm}
        onOpenChange={(open) => {
          if (!open) setPaymentForm(null)
        }}
        title={paymentForm?.payment ? 'Corrigir pagamento' : 'Pagamento de fatura'}
        description="Escolha a conta, informe a data e confirme o registro manual."
      >
        {paymentForm && (
          <PaymentForm
            data={data}
            invoice={paymentForm.invoice}
            payment={paymentForm.payment}
            onDone={() => {
              setPaymentForm(null)
              notify('Pagamento registrado. Conta bancária e limite atualizados.')
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={!!action}
        onOpenChange={(open) => {
          if (!open) setAction(null)
        }}
        title={
          action?.kind === 'refund'
            ? 'Estornar compra'
            : action?.kind === 'cancel'
              ? 'Cancelar registro de compra'
              : action?.kind === 'reverse'
                ? 'Estornar pagamento'
                : action?.kind === 'credit'
                  ? 'Aplicar crédito de fatura'
                  : action?.kind === 'reverse-charge'
                    ? 'Estornar encargo'
                    : 'Registrar encargo'
        }
        description="Confira os dados e confirme a operação para preservar o histórico financeiro."
      >
        {action && (
          <CreditActionForm
            data={data}
            action={action}
            onDone={() => {
              setAction(null)
              notify('Operação registrada. Saldos e compromissos recalculados.')
            }}
          />
        )}
      </Dialog>
      <ConfirmDialog
        open={!!archive}
        onClose={() => setArchive(null)}
        title={archive?.archived ? 'Reativar cartão?' : 'Arquivar cartão?'}
        onConfirm={async () => {
          if (archive) {
            await repositories.credit.archiveCard(archive.id, !archive.archived)
            notify(
              archive.archived
                ? 'Cartão reativado.'
                : 'Cartão arquivado. Dívidas e histórico preservados.',
            )
          }
        }}
      >
        {archive?.name}:{' '}
        {archive?.archived
          ? 'novas compras voltarão a ser permitidas.'
          : 'novas compras serão bloqueadas. Faturas, pagamentos e compras permanecerão consultáveis e poderão ser liquidados.'}
      </ConfirmDialog>
      <Dialog
        open={!!receipt}
        onOpenChange={(open) => {
          if (!open) setReceipt(null)
        }}
        title="Comprovante interno"
        description="Registro do Money Saver. Não é um comprovante emitido por um banco."
      >
        {receipt && (
          <dl className="detail-list">
            <div>
              <dt>Operação</dt>
              <dd className="record-id">{receipt.id}</dd>
            </div>
            <div>
              <dt>Fatura</dt>
              <dd>{data.invoices.find((i) => i.id === receipt.invoiceId)?.period}</dd>
            </div>
            <div>
              <dt>Conta</dt>
              <dd>{data.accounts.find((a) => a.id === receipt.accountId)?.name}</dd>
            </div>
            <div>
              <dt>Valor</dt>
              <dd>{money(receipt.amountCents)}</dd>
            </div>
            <div>
              <dt>Data efetiva</dt>
              <dd>{receipt.date.split('-').reverse().join('/')}</dd>
            </div>
            <div>
              <dt>Registrado em</dt>
              <dd>{new Date(receipt.createdAt).toLocaleString('pt-BR')}</dd>
            </div>
            <div>
              <dt>Situação</dt>
              <dd>
                {receipt.reversalDate
                  ? `Estornado em ${receipt.reversalDate.split('-').reverse().join('/')} · ${receipt.reversalReason}`
                  : 'Efetivado'}
              </dd>
            </div>
            <div>
              <dt>Observações</dt>
              <dd className="notes">{receipt.notes || 'Sem observações'}</dd>
            </div>
          </dl>
        )}
      </Dialog>
    </>
  )
}
