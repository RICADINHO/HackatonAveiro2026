import { useEffect, useState, type FormEvent } from 'react'
import { api, errorMessage } from '../api.ts'
import type { InventoryItem, Report } from '../types.ts'
import { Modal } from './Modal.tsx'

function formatDate(value: string): string {
  return new Date(value).toLocaleString('pt-PT', { dateStyle: 'medium', timeStyle: 'short' })
}

function shortAuthor(id: string): string {
  return `Conta ${id.slice(0, 8)}`
}

export function ReportsDialog({ open, onClose, token, technician, items, initialItemId, revision, onChanged, onSelectItem, notify }: {
  open: boolean
  onClose: () => void
  token?: string
  technician: boolean
  items: InventoryItem[]
  initialItemId: string
  revision: number
  onChanged: () => void
  onSelectItem: (id: string) => void
  notify: (text: string, kind?: 'success' | 'error' | 'info') => void
}) {
  const [tab, setTab] = useState<'new' | 'list'>('new')
  const [itemId, setItemId] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [reports, setReports] = useState<Report[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState('')
  const [listRevision, setListRevision] = useState(0)
  const [statusFilter, setStatusFilter] = useState<'open' | 'resolved' | 'all'>('open')

  useEffect(() => {
    if (!open) return
    setItemId(initialItemId)
    setDescription('')
    setMessage('')
    setTab(technician && !initialItemId ? 'list' : 'new')
  }, [open, initialItemId, technician])

  useEffect(() => {
    if (!open || !technician || tab !== 'list' || !token) return
    const controller = new AbortController()
    setListLoading(true)
    api<Report[]>('/reports', { signal: controller.signal }, token).then((data) => {
      if (controller.signal.aborted) return
      setReports(data)
      setListError('')
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setReports([])
        setListError(errorMessage(error))
      }
    }).finally(() => {
      if (!controller.signal.aborted) setListLoading(false)
    })
    return () => controller.abort()
  }, [open, technician, tab, token, listRevision, revision])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token) return
    setBusy(true)
    setMessage('')
    try {
      await api('/reports', {
        method: 'POST',
        body: JSON.stringify({ description, item_id: itemId || null }),
      }, token)
      setDescription('')
      setItemId('')
      notify('Problema comunicado. Obrigado!', 'success')
      setListRevision((value) => value + 1)
      onChanged()
      if (technician) setTab('list')
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function resolve(id: string) {
    if (!token) return
    setBusy(true)
    try {
      await api(`/reports/${id}/resolve`, { method: 'PATCH' }, token)
      notify('Problema marcado como resolvido.', 'success')
      setListRevision((value) => value + 1)
      onChanged()
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const openCount = reports.filter(({ status }) => status === 'open').length
  const filtered = statusFilter === 'all' ? reports : reports.filter(({ status }) => status === statusFilter)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Problemas"
      subtitle="Comunica uma má deteção, um item em falta ou um problema no mobiliário urbano."
      icon="bi-flag"
      size="lg"
    >
      {technician && (
        <div className="segmented segmented--wide" role="tablist" aria-label="Problemas">
          <button type="button" role="tab" aria-selected={tab === 'new'} className={tab === 'new' ? 'is-active' : ''} onClick={() => setTab('new')}>
            <i className="bi bi-plus-circle" aria-hidden="true" /> Novo problema
          </button>
          <button type="button" role="tab" aria-selected={tab === 'list'} className={tab === 'list' ? 'is-active' : ''} onClick={() => setTab('list')}>
            <i className="bi bi-inbox" aria-hidden="true" /> Submetidos
            {openCount > 0 && <span className="segmented__count">{openCount}</span>}
          </button>
        </div>
      )}

      {tab === 'new' && (
        <form className="report-form" onSubmit={submit}>
          <label className="field">
            <span>Descrição do problema</span>
            <textarea
              className="textarea"
              rows={4}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              required
              maxLength={4000}
              placeholder="Ex.: o sinal de stop está associado ao local errado…"
            />
            <small className="field-hint">{description.length}/4000</small>
          </label>
          <label className="field">
            <span>Elemento associado <small>(opcional)</small></span>
            <select className="select" value={itemId} onChange={(event) => setItemId(event.target.value)}>
              <option value="">Sem elemento associado</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label} ({item.latitude.toFixed(5)}, {item.longitude.toFixed(5)})
                </option>
              ))}
            </select>
          </label>
          {message && <div className="form-message form-message--error" role="alert">{message}</div>}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
            <button className="btn btn-primary" disabled={busy || !token}>
              <i className="bi bi-send" aria-hidden="true" /> {busy ? 'A enviar…' : 'Submeter problema'}
            </button>
          </div>
        </form>
      )}

      {tab === 'list' && technician && (
        <div className="report-list">
          <div className="report-list__toolbar">
            <div className="segmented segmented--sm">
              {(['open', 'resolved', 'all'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={statusFilter === value ? 'is-active' : ''}
                  onClick={() => setStatusFilter(value)}
                >
                  {value === 'open' ? 'Em aberto' : value === 'resolved' ? 'Resolvidos' : 'Todos'}
                </button>
              ))}
            </div>
            <span className="field-hint">{reports.length} no total</span>
          </div>

          {listError && <div className="form-message form-message--error" role="alert">{listError}</div>}
          {listLoading && <p className="field-hint">A carregar problemas…</p>}
          {!listLoading && !listError && filtered.length === 0 && (
            <div className="empty-state">
              <i className="bi bi-inbox" aria-hidden="true" />
              <p>Sem problemas nesta vista.</p>
            </div>
          )}

          {filtered.map((report) => (
            <article key={report.id} className={`report-card report-card--${report.status}`}>
              <div className="report-card__head">
                <span className={`status-chip status-chip--${report.status}`}>
                  <i className={`bi ${report.status === 'open' ? 'bi-exclamation-circle' : 'bi-check-circle'}`} aria-hidden="true" />
                  {report.status === 'open' ? 'Em aberto' : 'Resolvido'}
                </span>
                <span className="field-hint">{formatDate(report.submitted_at)}</span>
              </div>
              <p className="report-card__description">{report.description}</p>
              <div className="report-card__meta">
                <span><i className="bi bi-person" aria-hidden="true" /> {shortAuthor(report.author_id)}</span>
                {report.item_label && <span><i className="bi bi-geo-alt" aria-hidden="true" /> {report.item_label}</span>}
              </div>
              {report.status === 'resolved' && report.resolved_at && (
                <p className="field-hint">Resolvido em {formatDate(report.resolved_at)}</p>
              )}
              <div className="report-card__actions">
                {report.item_id && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { onSelectItem(report.item_id!); onClose() }}>
                    <i className="bi bi-map" aria-hidden="true" /> Ver no mapa
                  </button>
                )}
                {report.status === 'open' && (
                  <button type="button" className="btn btn-soft btn-sm" disabled={busy} onClick={() => void resolve(report.id)}>
                    <i className="bi bi-check2-circle" aria-hidden="true" /> Marcar como resolvido
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </Modal>
  )
}

export default ReportsDialog
