import { Component, useEffect, useState, type ReactNode } from 'react'
import {
  LayoutDashboard,
  Landmark,
  CreditCard,
  ArrowLeftRight,
  CalendarDays,
  ChartNoAxesCombined,
  Settings2,
  ChevronRight,
  Plus,
  ArrowUpRight,
  ShieldCheck,
  Eye,
  EyeOff,
  Menu,
  X,
  Leaf,
  CircleHelp,
  Pencil,
  Trash2,
  Check,
  LoaderCircle,
} from 'lucide-react'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { AccountForm } from '@/features/accounts/AccountForm'
import { accountTypes } from '@/features/accounts/constants'
import { useFinances } from '@/hooks/use-finances'
import { formatMoney } from '@/domain/money'
import type { BankAccount } from '@/domain/models'
import { repositories } from '@/infrastructure/repositories'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { MovementsPage } from '@/features/movements/MovementsPage'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { AccountStatement } from '@/features/accounts/AccountStatement'
import { NewMovementForm as MovementForm } from '@/features/movements/NewMovementForm'
import { CardsPage } from '@/features/cards/CardsPage'
import { PlanningPage } from '@/features/planning/PlanningPage'
import { ReportsPage } from '@/features/reports/ReportsPage'
import { RemoteAccess } from '@/features/auth/RemoteAccess'

const navigation = [
  { id: 'dashboard', label: 'Visão geral', icon: LayoutDashboard },
  { id: 'accounts', label: 'Contas', icon: Landmark },
  { id: 'cards', label: 'Cartões', icon: CreditCard },
  { id: 'transactions', label: 'Lançamentos', icon: ArrowLeftRight },
  { id: 'planning', label: 'Planejamento', icon: CalendarDays },
  { id: 'reports', label: 'Relatórios', icon: ChartNoAxesCombined },
  { id: 'settings', label: 'Configurações', icon: Settings2 },
] as const
type Page = (typeof navigation)[number]['id']
const pageFromHash = (): Page =>
  navigation.find((n) => n.id === window.location.hash.slice(1))?.id ?? 'dashboard'

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? (
      <main className="fatal">
        <h1>Não foi possível abrir o aplicativo.</h1>
        <p>Seus dados locais foram preservados. Recarregue para tentar novamente.</p>
        <Button onClick={() => window.location.reload()}>Recarregar</Button>
      </main>
    ) : (
      this.props.children
    )
  }
}
export function App() {
  return (
    <ErrorBoundary>
      <RemoteAccess>
        <Workspace />
      </RemoteAccess>
    </ErrorBoundary>
  )
}
function Workspace() {
  const [page, setPage] = useState<Page>(pageFromHash)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [form, setForm] = useState<{ account?: BankAccount } | null>(null)
  const [deleting, setDeleting] = useState<BankAccount | null>(null)
  const [deletingBusy, setDeletingBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  )
  const [help, setHelp] = useState(false)
  const [quickMovement, setQuickMovement] = useState(false)
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null)
  const data = useFinances()
  const money = (amount: number) => (hidden ? 'R$ ••••' : formatMoney(amount))
  useEffect(() => {
    const handler = () => {
      setPage(pageFromHash())
      setMobileOpen(false)
    }
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 4000)
    return () => window.clearTimeout(timer)
  }, [notice])
  function navigate(id: Page) {
    setSelectedAccount(null)
    window.location.hash = id
    setPage(id)
    setMobileOpen(false)
  }
  async function remove() {
    if (!deleting) return
    setDeletingBusy(true)
    setError('')
    try {
      await repositories.accounts.remove(deleting.id)
      setDeleting(null)
      setNotice('Conta excluída.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível excluir a conta.')
    } finally {
      setDeletingBusy(false)
    }
  }
  const selected = navigation.find((n) => n.id === page)!
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault()
          document.getElementById('main')?.focus()
        }}
      >
        Ir para o conteúdo
      </a>
      <aside className="sidebar">
        <a href="#dashboard" className="brand">
          <span className="brand-mark">
            <svg viewBox="0 0 32 32" aria-hidden="true">
              <path d="M7 23V9l9 8 9-8v14" />
            </svg>
          </span>
          <span>
            money<span className="brand-light">saver</span>
            <span className="brand-dot">.</span>
          </span>
        </a>
        <div className="workspace-label">SEU ESPAÇO FINANCEIRO</div>
        <Nav page={page} navigate={navigate} />
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="local-icon">
              <ShieldCheck size={20} />
            </span>
            <strong>Seu dinheiro. Seus dados.</strong>
            <p>
              Salvos neste navegador.
              <br />
              Privados por natureza.
            </p>
            <span className="local-status">
              <i /> Armazenamento local
            </span>
          </div>
          <button className="help-link" onClick={() => setHelp(true)}>
            <CircleHelp size={17} /> Como funciona <ArrowUpRight size={14} />
          </button>
          <div className="sidebar-footer">
            <span className="avatar">EU</span>
            <div>
              <strong>Meu espaço pessoal</strong>
              <small>Uma vida mais organizada</small>
            </div>
            <Leaf size={16} />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-toggle"
              onClick={() => setMobileOpen(true)}
              aria-label="Abrir navegação"
            >
              <Menu size={21} />
            </button>
            <span>Meu espaço</span>
            <ChevronRight size={13} />
            <strong>{selected.label}</strong>
          </div>
          <div className="topbar-right">
            <span className="private-tag">
              <i /> Ambiente local
            </span>
            <span className="topbar-divider" />
            <button
              className="icon-button"
              onClick={() => setHidden(!hidden)}
              aria-label={hidden ? 'Mostrar valores' : 'Ocultar valores'}
              title={hidden ? 'Mostrar valores' : 'Ocultar valores'}
            >
              {hidden ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
            <span className="avatar small">EU</span>
          </div>
        </header>
        <main id="main" tabIndex={-1} className="content">
          {(error || data?.error) && (
            <div className="error-banner" role="alert">
              <strong>Não foi possível concluir a operação.</strong> {error || data?.error}
              {error && (
                <button onClick={() => setError('')} aria-label="Dispensar erro">
                  <X size={16} />
                </button>
              )}
            </div>
          )}
          {data && data.accounts.some((a) => data.balances[a.id] < 0) && (
            <p className="warning-banner" role="status">
              Atenção:{' '}
              {data.accounts
                .filter((a) => data.balances[a.id] < 0)
                .map((a) => a.name)
                .join(', ')}{' '}
              possui saldo negativo. As operações continuam disponíveis.
            </p>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {page === 'dashboard'
                  ? 'MAIS CLAREZA, MELHORES ESCOLHAS'
                  : page === 'reports'
                    ? 'ANÁLISE FINANCEIRA'
                    : 'SEU CONTROLE FINANCEIRO'}
              </div>
              <h1>
                {page === 'dashboard' ? 'Suas finanças, em perspectiva' : selected.label}
                <span className="heading-dot">.</span>
              </h1>
              <p>
                {page === 'dashboard'
                  ? 'Um olhar tranquilo para o seu dinheiro. Tudo começa por aqui.'
                  : page === 'reports'
                    ? 'Receitas, consumo e saldos por período.'
                    : page === 'accounts'
                      ? 'Cada conta no seu lugar. Seu patrimônio em uma só visão.'
                      : page === 'settings'
                        ? 'Um espaço que respeita suas escolhas e seus dados.'
                        : 'Mais organização para acompanhar cada parte da sua vida financeira.'}
              </p>
            </div>
            {(page === 'dashboard' || page === 'accounts') && (
              <Button
                onClick={() =>
                  page === 'dashboard' && data?.accounts.length
                    ? setQuickMovement(true)
                    : setForm({})
                }
                disabled={!data || !!data.error}
              >
                <Plus size={17} />{' '}
                {page === 'dashboard' && data?.accounts.length ? 'Novo lançamento' : 'Nova conta'}
              </Button>
            )}
          </div>
          {!data ? (
            <div className="loading-state" role="status">
              <LoaderCircle className="spin" /> Abrindo seu espaço financeiro…
            </div>
          ) : page === 'dashboard' ? (
            <DashboardPage
              data={data}
              money={money}
              hidden={hidden}
              month={month}
              setMonth={setMonth}
              onNewAccount={() => setForm({})}
              onMovements={() => navigate('transactions')}
              onAccounts={() => navigate('accounts')}
              onPlanning={() => navigate('planning')}
            />
          ) : page === 'accounts' ? (
            selectedAccount && data.accounts.some((a) => a.id === selectedAccount) ? (
              <AccountStatement
                key={selectedAccount}
                account={data.accounts.find((a) => a.id === selectedAccount)!}
                data={data}
                money={money}
                onBack={() => setSelectedAccount(null)}
                notify={setNotice}
              />
            ) : (
              <>
                <div className="accounts-total">
                  <div>
                    <span className="tiny-label">PATRIMÔNIO EM CONTAS</span>
                    <h2>{money(data.total)}</h2>
                    <p>Saldo atual · {data.accounts.length} contas cadastradas</p>
                  </div>
                  <Landmark size={36} />
                </div>
                <div className="section-heading">
                  <h2>
                    Suas contas <span className="count-badge">{data.accounts.length}</span>
                  </h2>
                  <span>Saldos em reais (BRL)</span>
                </div>
                {data.accounts.length ? (
                  <div className="account-grid">
                    {data.accounts.map((account) => (
                      <article className="panel account-card" key={account.id}>
                        <div className="account-card-top">
                          <span className={`account-symbol ${account.color}`}>
                            <Landmark size={23} />
                          </span>
                          <span className="type-badge">{accountTypes[account.type]}</span>
                        </div>
                        <h2>{account.name}</h2>
                        <p>{account.institution}</p>
                        <div className="account-value">
                          <span>Saldo atual</span>
                          <strong>{money(data.balances[account.id])}</strong>
                        </div>
                        <div className="account-opening">
                          <span>Saldo inicial</span>
                          <span>{money(account.openingBalanceCents)}</span>
                        </div>
                        <Button
                          variant="outline"
                          className="full-width statement-button"
                          onClick={() => setSelectedAccount(account.id)}
                        >
                          Ver extrato <ArrowUpRight size={14} />
                        </Button>
                        <div className="account-card-actions">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setForm({ account })}
                            aria-label={`Editar ${account.name}`}
                          >
                            <Pencil size={14} /> Editar conta
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setError('')
                              setDeleting(account)
                            }}
                            aria-label={`Excluir ${account.name}`}
                          >
                            <Trash2 size={16} />
                          </Button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <section className="panel large-empty">
                    <span className="empty-icon large">
                      <Landmark size={30} />
                    </span>
                    <h2>Sua primeira conta muda a perspectiva.</h2>
                    <p>
                      Cadastre uma conta corrente, poupança, investimento ou carteira.
                      <br />
                      Você escolhe por onde começar.
                    </p>
                    <Button onClick={() => setForm({})} disabled={!!data.error}>
                      <Plus size={17} /> Adicionar primeira conta
                    </Button>
                    <span className="safe-caption">
                      <ShieldCheck size={14} /> Informações salvas apenas neste navegador
                    </span>
                  </section>
                )}
              </>
            )
          ) : page === 'settings' ? (
            <SettingsPage data={data} notify={setNotice} hidden={hidden} />
          ) : page === 'cards' ? (
            <CardsPage data={data} money={money} notify={setNotice} />
          ) : page === 'planning' ? (
            <PlanningPage data={data} money={money} notify={setNotice} />
          ) : page === 'transactions' ? (
            <MovementsPage key={page} data={data} money={money} notify={setNotice} />
          ) : (
            <ReportsPage data={data} money={money} hidden={hidden} />
          )}
          <footer className="content-footer">
            <span>
              money<span>saver.</span> <i /> Seu futuro começa no presente.
            </span>
            <span>
              <ShieldCheck size={13} /> Local e privado
            </span>
          </footer>
        </main>
      </div>
      <Dialog
        open={quickMovement}
        onOpenChange={setQuickMovement}
        title="Novo lançamento"
        description="Registre uma movimentação sem sair da visão geral."
      >
        {quickMovement && data && (
          <MovementForm
            data={data}
            onDone={(message) => {
              setQuickMovement(false)
              setNotice(message)
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={!!form}
        onOpenChange={(open) => {
          if (!open) setForm(null)
        }}
        title={form?.account ? 'Editar conta' : 'Um novo lugar para seu dinheiro.'}
        description={
          form?.account
            ? 'Atualize os dados da sua conta bancária.'
            : 'Adicione uma conta e dê o primeiro passo na sua organização.'
        }
      >
        {form && (
          <AccountForm
            account={form.account}
            onCancel={() => setForm(null)}
            onDone={() => {
              setForm(null)
              setNotice(
                form.account
                  ? 'Conta atualizada.'
                  : 'Conta criada. Seu espaço está ganhando forma.',
              )
            }}
          />
        )}
      </Dialog>
      <AlertDialog.Root
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !deletingBusy) setDeleting(null)
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="dialog-overlay" />
          <AlertDialog.Content className="dialog-content delete-dialog">
            <AlertDialog.Title className="dialog-title">
              Excluir {deleting?.name}?
            </AlertDialog.Title>
            <AlertDialog.Description className="dialog-description">
              A conta será removida deste navegador. Esta ação não pode ser desfeita. Contas com
              vínculos financeiros não podem ser excluídas.
            </AlertDialog.Description>
            {error && (
              <p role="alert" className="error-banner">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <AlertDialog.Cancel asChild>
                <Button variant="outline" disabled={deletingBusy}>
                  Manter conta
                </Button>
              </AlertDialog.Cancel>
              <Button variant="destructive" disabled={deletingBusy} onClick={remove}>
                {deletingBusy ? 'Excluindo…' : 'Excluir conta'}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
      <Dialog
        open={help}
        onOpenChange={setHelp}
        title="Um espaço para cuidar do seu dinheiro."
        description="Comece simples. Construa clareza aos poucos."
      >
        <div className="help-content">
          <p>
            <strong>1. Adicione suas contas.</strong> Informe o nome, a instituição e o saldo
            inicial de cada uma.
          </p>
          <p>
            <strong>2. Acompanhe seu patrimônio.</strong> Os saldos aparecem na visão geral e na
            página de contas.
          </p>
          <p>
            <strong>3. Guarde seus dados.</strong> Os cadastros persistem neste navegador. Em
            Configurações, você pode exportar uma cópia em JSON.
          </p>
          <p>
            Lançamentos, Pix, transferências, ajustes, categorias e compromissos estão disponíveis.
            Cartões, parcelas e faturas também estão disponíveis, com pagamentos manuais e histórico
            rastreável.
          </p>
        </div>
      </Dialog>
      <Dialog
        open={mobileOpen}
        onOpenChange={setMobileOpen}
        title="Seu espaço financeiro"
        description="Escolha uma área para continuar."
      >
        <Nav page={page} navigate={navigate} />
      </Dialog>
      <div className="toast-region" role="status" aria-live="polite">
        {notice && (
          <div className="toast">
            <Check size={17} />
            {notice}
          </div>
        )}
      </div>
    </div>
  )
}
function Nav({ page, navigate }: { page: Page; navigate: (id: Page) => void }) {
  return (
    <nav aria-label="Navegação principal" className="nav-list">
      {navigation.map(({ id, label, icon: Icon }, index) => (
        <button
          key={id}
          className={`${page === id ? 'active' : ''} ${index === 6 ? 'nav-settings' : ''}`}
          onClick={() => navigate(id)}
          aria-current={page === id ? 'page' : undefined}
        >
          <Icon size={18} />
          <span>{label}</span>
          {page === id && <span className="nav-active-dot" />}
        </button>
      ))}
    </nav>
  )
}
