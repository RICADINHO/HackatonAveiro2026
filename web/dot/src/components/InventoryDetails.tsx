import { useState, type FormEvent } from 'react'
import { api, errorMessage, imageUrl } from '../api.ts'
import { CATEGORIAS } from '../constants.ts'
import type { ItemDetail, PublishedImage } from '../types.ts'
import { CameraFields } from './CameraFields.tsx'
import { cameraValues } from '../forms.ts'
import { DetectionImage } from './DetectionImage.tsx'

export function ImageDetails({ image, token, onChange }: { image: PublishedImage; token?: string; onChange: () => void }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await change('PATCH', JSON.stringify(cameraValues(new FormData(event.currentTarget))))
  }

  async function change(method: 'PATCH' | 'DELETE', body?: string) {
    if (!token) return
    setBusy(true)
    setMessage('')
    try {
      await api(`/images/${image.id}`, { method, body }, token)
      if (method === 'PATCH') setMessage('Coordenadas da imagem atualizadas.')
      onChange()
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="card p-3 mb-3">
      <DetectionImage src={imageUrl(image.url)} detections={image.detections ?? []} />
      <p className="mt-2 mb-1">
        Câmara em {image.latitude.toFixed(6)}, {image.longitude.toFixed(6)} · {image.heading.toFixed(1)}°
      </p>
      <p className="text-body-secondary mb-2">{new Date(image.submitted_at).toLocaleString('pt-PT')}{image.uploader_name && ` · ${image.uploader_name}`}</p>
      {token && (
        <form onSubmit={save} className="d-grid gap-2">
          <fieldset disabled={busy}>
            <legend className="h6">Corrigir a posição da câmara</legend>
            <CameraFields key={`${image.id}-${image.latitude}-${image.longitude}-${image.heading}`} camera={image} />
          </fieldset>
          <div className="d-flex flex-wrap gap-2">
            <button className="btn btn-outline-primary" disabled={busy}>Guardar posição</button>
            <button type="button" className="btn btn-outline-danger" disabled={busy}
              onClick={() => { if (window.confirm('Apagar esta imagem e as respetivas deteções?')) void change('DELETE') }}>Apagar imagem</button>
          </div>
          {message && <p className="mb-0" role="status">{message}</p>}
        </form>
      )}
    </article>
  )
}

export function InventoryDetails({ item, canReport, technicianToken, onChange, onClose, onReport }: {
  item: ItemDetail
  canReport: boolean
  technicianToken?: string
  onChange: () => void
  onClose: () => void
  onReport: (id: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const coordinates = cameraValues(values)
    const changed = coordinates.latitude !== item.latitude || coordinates.longitude !== item.longitude
    await change('PATCH', JSON.stringify({ label: values.get('label'), ...(changed ? coordinates : {}) }))
  }

  async function change(method: 'PATCH' | 'DELETE', body?: string) {
    if (!technicianToken) return
    setBusy(true)
    setMessage('')
    try {
      await api(`/items/${item.id}`, { method, body }, technicianToken)
      if (method === 'DELETE') onClose()
      else setMessage('Elemento atualizado.')
      onChange()
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="container mb-4" aria-labelledby="inventory-item-title" id="detalhes">
      <div className="d-flex justify-content-between gap-3 align-items-start">
        <h2 id="inventory-item-title" className="h4">{item.label}</h2>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClose}>Fechar detalhes</button>
      </div>
      <p className="text-body-secondary">{CATEGORIAS.find(({ id }) => id === item.category)?.nome} · {item.class_name} · {item.latitude.toFixed(6)}, {item.longitude.toFixed(6)} · {item.position_manually_corrected ? 'Posição corrigida' : 'Posição estimada'}</p>
      {canReport && <a className="btn btn-outline-primary mb-3" href="#problemas" onClick={() => onReport(item.id)}>Comunicar problema neste elemento</a>}
      {technicianToken && (
        <form onSubmit={save} className="card p-3 mb-3 d-grid gap-2">
          <fieldset disabled={busy} key={`${item.id}-${item.label}-${item.latitude}-${item.longitude}`}>
            <legend className="h6">Editar elemento</legend>
            <label className="d-block mb-2">Etiqueta<input className="form-control" name="label" defaultValue={item.label} maxLength={160} required /></label>
            <CameraFields camera={{ ...item, heading: null }} coordinatesOnly />
          </fieldset>
          <div className="d-flex flex-wrap gap-2">
            <button className="btn btn-outline-primary" disabled={busy}>Guardar elemento</button>
            <button type="button" className="btn btn-outline-danger" disabled={busy}
              onClick={() => { if (window.confirm('Apagar este elemento do inventário?')) void change('DELETE') }}>Apagar elemento</button>
          </div>
          {message && <p className="mb-0" role="status">{message}</p>}
        </form>
      )}
      <h3 className="h5">Imagens publicadas</h3>
      {item.images.length === 0 && <p>Este elemento não tem imagens associadas.</p>}
      {item.images.map((image) => <ImageDetails key={image.id} image={image} token={technicianToken} onChange={onChange} />)}
    </section>
  )
}
