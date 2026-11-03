import { useRef, useState } from 'react'
import { Download, Upload, HardDrive } from 'lucide-react'
import { z } from 'zod'
import type { Backup } from '@/domain/backup'
import { formatMoney } from '@/domain/money'
import { repositories } from '@/infrastructure/repositories'
import { balancesAt } from '@/domain/finance'
import { sumCents } from '@/domain/money'
import { today } from '@/domain/financial-validation'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
async function downloadBackup() {
  const data = await repositories.backup.export()
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob),
    link = document.createElement('a')
  link.href = url
  link.download = `money-saver-v2-${today()}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function BackupPanel({
  notify,
  hidden = false,
}: {
  notify: (message: string) => void
  hidden?: boolean
}) {
  const input = useRef<HTMLInputElement>(null),
    [preview, setPreview] = useState<Backup | null>(null),
    [error, setError] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [busy, setBusy] = useState(false),
    [exported, setExported] = useState(false)
  async function exportCurrent() {
    setError('')
    setBusy(true)
    try {
      await downloadBackup()
      setExported(true)
      notify('Backup exportado. Guarde o arquivo em local seguro.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao exportar.')
    } finally {
      setBusy(false)
    }
  }
  async function inspect(file: File) {
    setError('')
    setConfirmation('')
    setExported(false)
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('O arquivo excede o limite de 10 MB.')
      const parsed = repositories.backup.preview(JSON.parse(await file.text()))
      setPreview(parsed)
    } catch (e) {
      setError(
        e instanceof z.ZodError
          ? 'O arquivo não corresponde ao esquema de backup. Verifique os campos, datas e valores.'
          : e instanceof Error
            ? e.message
            : 'Não foi possível ler o arquivo.',
      )
    }
  }
  return (
    <section className="panel settings-panel">
      <span className="empty-icon">
        <HardDrive size={23} />
      </span>
      <h2>Seus dados ficam com você.</h2>
      <p>
        Salvos neste navegador. Exporte uma cópia ou restaure um backup validado, com prévia antes
        de qualquer alteração.
      </p>
      <div className="backup-actions">
        <Button variant="outline" onClick={exportCurrent} disabled={busy}>
          <Download size={16} />
          Exportar backup JSON
        </Button>
        <Button variant="outline" onClick={() => input.current?.click()} disabled={busy}>
          <Upload size={16} />
          Importar backup
        </Button>
      </div>
      <input
        ref={input}
        className="sr-only"
        tabIndex={-1}
        type="file"
        accept=".json,application/json"
        aria-label="Arquivo de backup"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void inspect(file)
          e.target.value = ''
        }}
      />
      {error && !preview && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      <p className="form-hint">
        Até 10 MB. Formatos v1 e v2. A restauração substitui todos os dados locais; não há mesclagem
        automática. Limpar os dados do navegador também remove seus cadastros.
      </p>
      <Dialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setPreview(null)
            setError('')
          }
        }}
        title="Prévia da restauração"
        description="Confira o conteúdo antes de substituir os dados deste navegador."
      >
        {preview && (
          <>
            <dl className="detail-list">
              <div>
                <dt>Formato</dt>
                <dd>
                  Versão {preview.version}
                  {preview.schemaVersion ? ` · estrutura ${preview.schemaVersion}` : ''}
                </dd>
              </div>
              <div>
                <dt>Exportado em</dt>
                <dd>{new Date(preview.exportedAt).toLocaleString('pt-BR')}</dd>
              </div>
              <div>
                <dt>Contas</dt>
                <dd>{preview.data.accounts.length}</dd>
              </div>
              <div>
                <dt>Lançamentos</dt>
                <dd>
                  {preview.data.transactions.length +
                    preview.data.transfers.length +
                    preview.data.adjustments.length}
                </dd>
              </div>
              <div>
                <dt>Categorias</dt>
                <dd>{preview.data.categories.length}</dd>
              </div>
              <div>
                <dt>Cartões</dt>
                <dd>{preview.data.cards.length}</dd>
              </div>
              <div>
                <dt>Compras / parcelas</dt>
                <dd>
                  {preview.data.purchases.length} / {preview.data.installments.length}
                </dd>
              </div>
              <div>
                <dt>Faturas / pagamentos</dt>
                <dd>
                  {preview.data.invoices.length} / {preview.data.payments.length}
                </dd>
              </div>
              <div>
                <dt>Registros totais</dt>
                <dd>{Object.values(preview.data).reduce((n, rows) => n + rows.length, 0)}</dd>
              </div>
              <div>
                <dt>Saldo consolidado atual</dt>
                <dd>
                  {hidden
                    ? 'R$ ••••'
                    : formatMoney(sumCents(Object.values(balancesAt(preview.data, today()))))}
                </dd>
              </div>
            </dl>
            <p className="warning-banner">
              Todos os dados existentes serão substituídos, inclusive registros ausentes neste
              arquivo. Exporte os dados atuais antes de prosseguir.
            </p>
            <Button variant="outline" onClick={exportCurrent} disabled={busy}>
              <Download size={15} />
              Guardar backup dos dados atuais
            </Button>
            <form
              className="account-form"
              onSubmit={async (e) => {
                e.preventDefault()
                setError('')
                setBusy(true)
                try {
                  await repositories.backup.restore(preview, confirmation)
                  setPreview(null)
                  notify('Backup restaurado. Os saldos foram recalculados.')
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Falha na restauração.')
                } finally {
                  setBusy(false)
                }
              }}
            >
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={exported}
                  onChange={(e) => setExported(e.target.checked)}
                />
                Tenho uma cópia dos dados atuais e entendo que serão substituídos.
              </label>
              <label>
                Digite RESTAURAR para confirmar
                <input
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  autoComplete="off"
                />
              </label>
              {error && (
                <p role="alert" className="error-banner">
                  {error}
                </p>
              )}
              <div className="dialog-actions">
                <Button
                  variant="outline"
                  type="button"
                  disabled={busy}
                  onClick={() => setPreview(null)}
                >
                  Cancelar
                </Button>
                <Button
                  variant="destructive"
                  type="submit"
                  disabled={busy || !exported || confirmation !== 'RESTAURAR'}
                >
                  {busy ? 'Restaurando…' : 'Substituir dados e restaurar'}
                </Button>
              </div>
            </form>
          </>
        )}
      </Dialog>
    </section>
  )
}
