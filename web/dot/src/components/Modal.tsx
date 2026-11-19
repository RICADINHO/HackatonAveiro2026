import { useEffect, useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl'

export function Modal({ open, onClose, title, subtitle, icon, size = 'md', children, footer, className = '' }: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  icon?: string
  size?: ModalSize
  children: ReactNode
  footer?: ReactNode
  className?: string
}) {
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div
        className={`modal-panel modal-panel--${size} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="modal-head">
          <div className="modal-head__text">
            <h2 id={titleId}>
              {icon && <i className={`bi ${icon}`} aria-hidden="true" />}
              {title}
            </h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn" aria-label="Fechar" onClick={onClose}>
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirmar', danger = false, busy = false, onConfirm, onCancel }: {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title} icon={danger ? 'bi-exclamation-triangle' : 'bi-question-circle'} size="sm">
      <p className="confirm-text">{message}</p>
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancelar</button>
        <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>
          {busy ? 'A processar…' : confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
