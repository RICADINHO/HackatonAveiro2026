import { useCallback, useRef, useState } from 'react'

export type ToastKind = 'success' | 'error' | 'info'

export interface ToastMessage {
  id: number
  kind: ToastKind
  text: string
}

const ICONS: Record<ToastKind, string> = {
  success: 'bi-check-circle-fill',
  error: 'bi-exclamation-triangle-fill',
  info: 'bi-info-circle-fill',
}

export function useToasts() {
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const notify = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = nextId.current++
    setToasts((current) => [...current.slice(-2), { id, kind, text }])
    window.setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 4500)
  }, [dismiss])

  return { toasts, notify, dismiss }
}

export function ToastStack({ toasts, onDismiss }: { toasts: ToastMessage[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toast-stack" role="region" aria-label="Notificações" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
          <i className={`bi ${ICONS[toast.kind]}`} aria-hidden="true" />
          <span>{toast.text}</span>
          <button type="button" className="toast__close" aria-label="Fechar notificação" onClick={() => onDismiss(toast.id)}>
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  )
}
