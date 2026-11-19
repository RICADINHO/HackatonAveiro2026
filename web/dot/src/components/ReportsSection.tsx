import { useEffect, useState, type FormEvent } from 'react'
import { api, errorMessage } from '../api.ts'
import type { InventoryItem, Report } from '../types.ts'

export function ReportsSection({ token, technician, items, selectedItem, onSelect, revision }: {
  token: string
  technician: boolean
  items: InventoryItem[]
  selectedItem: string
  onSelect: (id: string) => void
  revision: number
}) {
  const [reports, setReports] = useState<Report[]>([])
  const [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [listError, setListError] = useState('')

  useEffect(() => {
    if (!technician) return
    const controller = new AbortController()
    api<Report[]>('/reports', { signal: controller.signal }, token).then((data) => {
      if (controller.signal.aborted) return
      setReports(data)
      setListError('')
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setReports([])
        setListError(errorMessage(error))
      }
    })
    return () => controller.abort()
  }, [token, technician, refresh, revision])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    setBusy(true)
    setMessage('')
    try {
      await api('/reports', { method: 'POST', body: JSON.stringify({
        description: data.get('description'), item_id: data.get('item_id') || null,
      }) }, token)
      form.reset()
      onSelect('')
      setMessage('Problema comunicado.')
      setRefresh((value) => value + 1)
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function resolve(id: string) {
    setBusy(true)
    setMessage('')
    try {
      await api(`/reports/${id}/resolve`, { method: 'PATCH' }, token)
      setMessage('Problema marcado como resolvido.')
      setRefresh((value) => value + 1)
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="problemas" className="section">
      <div className="container">
        <div className="section-title"><h2>Comunicar problema</h2></div>
        <form onSubmit={submit} className="card p-3 d-grid gap-3">
          <label>Descrição<textarea name="description" className="form-control" rows={3} required maxLength={4000} /></label>
          <label>Elemento associado (opcional)
            <select className="form-select" name="item_id" value={items.some(({ id }) => id === selectedItem) ? selectedItem : ''}
              onChange={(event) => onSelect(event.target.value)}>
              <option value="">Sem elemento associado</option>
              {items.map((item) => <option key={item.id} value={item.id}>{item.label} ({item.latitude.toFixed(5)}, {item.longitude.toFixed(5)})</option>)}
            </select>
          </label>
          <div><button className="btn btn-primary" disabled={busy}>Submeter problema</button></div>
        </form>
        {message && <p role="status" className="mt-3">{message}</p>}
        {technician && (
          <div className="mt-4">
            <h3 className="h5">Problemas submetidos</h3>
            {listError && <p role="alert">{listError}</p>}
            {!listError && reports.length === 0 && <p>Sem problemas submetidos.</p>}
            {reports.map((report) => (
              <article key={report.id} className="card mb-2 p-3">
                <p className="report-description">{report.description}</p>
                <p className="text-body-secondary">{report.item_label && `${report.item_label} · `}{report.status === 'open' ? 'Em aberto' : 'Resolvido'} · {new Date(report.submitted_at).toLocaleString('pt-PT')}</p>
                <p className="text-body-secondary small">Autor: {report.author_id}{report.resolved_by && ` · Resolvido por ${report.resolved_by} em ${new Date(report.resolved_at!).toLocaleString('pt-PT')}`}</p>
                {report.status === 'open' && <div><button className="btn btn-outline-primary" type="button" disabled={busy}
                  onClick={() => void resolve(report.id)}>Marcar como resolvido</button></div>}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
