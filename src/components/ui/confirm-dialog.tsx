import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { useState, type ReactNode } from 'react'
import { Button } from './button'
export function ConfirmDialog({
  open,
  onClose,
  title,
  children,
  confirmLabel = 'Confirmar',
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  confirmLabel?: string
  onConfirm: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  async function confirm() {
    setError('')
    setBusy(true)
    try {
      await onConfirm()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível concluir a operação.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value && !busy) {
          setError('')
          onClose()
        }
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="dialog-overlay" />
        <AlertDialog.Content className="dialog-content">
          <AlertDialog.Title className="dialog-title">{title}</AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className="dialog-description">{children}</div>
          </AlertDialog.Description>
          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <AlertDialog.Cancel asChild>
              <Button variant="outline" disabled={busy}>
                Cancelar
              </Button>
            </AlertDialog.Cancel>
            <Button variant="destructive" disabled={busy} onClick={confirm}>
              {busy ? 'Salvando…' : confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
