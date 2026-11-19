import { useEffect, useState, type FormEvent } from 'react'
import { api, errorMessage, imageUrl } from '../api.ts'
import { CATEGORY_META, classLabel, formatCoordinates, formatHeading } from '../constants.ts'
import type { CameraPoint, ItemDetail, PublishedImage } from '../types.ts'
import { DetectionImage } from './DetectionImage.tsx'
import { LocationPicker } from './LocationPicker.tsx'
import { ConfirmDialog, Modal } from './Modal.tsx'

function formatDate(value: string): string {
  return new Date(value).toLocaleString('pt-PT', { dateStyle: 'medium', timeStyle: 'short' })
}

function uploaderLabel(image: PublishedImage): string {
  return image.uploader_name ? image.uploader_name : 'Conta sem nome público'
}

export function ImageCard({ image, token, onChange, onExpand }: {
  image: PublishedImage
  token?: string
  onChange: () => void
  onExpand: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [camera, setCamera] = useState<CameraPoint>({
    latitude: image.latitude,
    longitude: image.longitude,
    heading: image.heading,
  })

  useEffect(() => {
    setCamera({ latitude: image.latitude, longitude: image.longitude, heading: image.heading })
  }, [image.id, image.latitude, image.longitude, image.heading])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token) return
    if (camera.latitude === null || camera.longitude === null || camera.heading === null) {
      setMessage('Define a posição e a direção da câmara no mapa.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      await api(`/images/${image.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          latitude: camera.latitude,
          longitude: camera.longitude,
          heading: camera.heading,
        }),
      }, token)
      setMessage('Posição da câmara atualizada.')
      setEditing(false)
      onChange()
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!token) return
    setBusy(true)
    try {
      await api(`/images/${image.id}`, { method: 'DELETE' }, token)
      setConfirming(false)
      onChange()
    } catch (error) {
      setMessage(errorMessage(error))
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="image-card">
      <button type="button" className="image-card__media" onClick={onExpand} aria-label="Ampliar imagem">
        <DetectionImage src={imageUrl(image.url)} detections={image.detections ?? []} compact />
        <span className="image-card__zoom"><i className="bi bi-arrows-fullscreen" aria-hidden="true" /></span>
      </button>
      <div className="image-card__body">
        <div className="image-card__meta">
          <span><i className="bi bi-geo-alt" aria-hidden="true" /> {formatCoordinates(image.latitude, image.longitude)}</span>
          <span><i className="bi bi-compass" aria-hidden="true" /> {formatHeading(image.heading)}</span>
        </div>
        <div className="image-card__meta image-card__meta--muted">
          <span><i className="bi bi-calendar3" aria-hidden="true" /> {formatDate(image.submitted_at)}</span>
          <span><i className="bi bi-person" aria-hidden="true" /> {uploaderLabel(image)}</span>
        </div>

        {token && (
          <div className="image-card__actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing((value) => !value)} disabled={busy}>
              <i className="bi bi-pencil" aria-hidden="true" /> {editing ? 'Fechar' : 'Corrigir posição'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm btn-ghost--danger" onClick={() => setConfirming(true)} disabled={busy}>
              <i className="bi bi-trash3" aria-hidden="true" /> Apagar
            </button>
          </div>
        )}

        {editing && token && (
          <form className="image-card__editor" onSubmit={save}>
            <LocationPicker
              value={camera}
              onChange={setCamera}
              height={200}
              className="location-picker--compact"
            />
            <div className="image-card__editor-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)} disabled={busy}>Cancelar</button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'A guardar…' : 'Guardar'}</button>
            </div>
          </form>
        )}
        {message && <p className="field-hint" role="status">{message}</p>}
      </div>

      <ConfirmDialog
        open={confirming}
        title="Apagar imagem"
        message="A imagem e as deteções associadas serão removidas. Os elementos do inventário são recalculados."
        confirmLabel="Apagar imagem"
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirming(false)}
      />
    </article>
  )
}

export function ItemDrawer({ open, item, loading, error, token, account, onClose, onReport, onChanged, notify }: {
  open: boolean
  item: ItemDetail | null
  loading: boolean
  error: string
  token?: string
  account: { role: 'technician' | 'authenticated' } | null
  onClose: () => void
  onReport: (id: string) => void
  onChanged: () => void
  notify: (text: string, kind?: 'success' | 'error' | 'info') => void
}) {
  const technician = account?.role === 'technician'
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState('')
  const [position, setPosition] = useState<CameraPoint>({ latitude: null, longitude: null, heading: null })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [lightbox, setLightbox] = useState<PublishedImage | null>(null)

  useEffect(() => {
    setEditing(false)
    setMessage('')
    setConfirming(false)
    setLightbox(null)
    if (item) {
      setLabel(item.label)
      setPosition({ latitude: item.latitude, longitude: item.longitude, heading: null })
    }
  }, [item?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !lightbox && !confirming) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose, lightbox, confirming])

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!item || !token) return
    if (!label.trim()) {
      setMessage('A etiqueta não pode ficar vazia.')
      return
    }
    if (position.latitude === null || position.longitude === null) {
      setMessage('Marca a posição do elemento no mapa.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      await api(`/items/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          label: label.trim(),
          latitude: position.latitude,
          longitude: position.longitude,
        }),
      }, token)
      setEditing(false)
      notify('Elemento atualizado.', 'success')
      onChanged()
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function removeItem() {
    if (!item || !token) return
    setBusy(true)
    try {
      await api(`/items/${item.id}`, { method: 'DELETE' }, token)
      setConfirming(false)
      onClose()
      notify('Elemento removido do inventário.', 'success')
      onChanged()
    } catch (error) {
      setMessage(errorMessage(error))
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const meta = item ? CATEGORY_META[item.category] : null

  return (
    <>
      <div className="drawer-backdrop" onMouseDown={onClose} />
      <aside className="drawer" aria-label={item ? item.label : 'Detalhes do elemento'}>
        <div className="drawer__top">
          {meta
            ? <span className={`category-pill category-pill--${meta.id}`}><i className={`bi ${meta.icon}`} aria-hidden="true" /> {meta.nome}</span>
            : <span className="category-pill"><i className="bi bi-geo-alt" aria-hidden="true" /> Elemento</span>}
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar detalhes">
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
        </div>

        <div className="drawer__scroll">
          {loading && !item && (
            <div className="skeleton-block" aria-label="A carregar elemento">
              <span className="skeleton skeleton--title" />
              <span className="skeleton skeleton--line" />
              <span className="skeleton skeleton--media" />
            </div>
          )}

          {error && !item && (
            <div className="empty-state empty-state--error" role="alert">
              <i className="bi bi-exclamation-triangle" aria-hidden="true" />
              <p>{error}</p>
            </div>
          )}

          {item && (
            <>
              <div className="drawer__title">
                <h2>{item.label}</h2>
                <p>{classLabel(item.class_name)}</p>
                <div className="drawer__badges">
                  <span className="badge"><i className="bi bi-geo-alt" aria-hidden="true" /> {formatCoordinates(item.latitude, item.longitude)}</span>
                  <span className={`badge ${item.position_manually_corrected ? 'badge--accent' : ''}`}>
                    <i className={`bi ${item.position_manually_corrected ? 'bi-patch-check' : 'bi-bullseye'}`} aria-hidden="true" />
                    {item.position_manually_corrected ? 'Posição corrigida' : 'Posição estimada'}
                  </span>
                </div>
              </div>

              <div className="drawer__actions">
                {account && (
                  <button type="button" className="btn btn-soft" onClick={() => onReport(item.id)}>
                    <i className="bi bi-flag" aria-hidden="true" /> Comunicar problema
                  </button>
                )}
                {technician && (
                  <button type="button" className={`btn btn-ghost${editing ? ' is-active' : ''}`} onClick={() => {
                    setEditing((value) => !value)
                    setMessage('')
                    setLabel(item.label)
                    setPosition({ latitude: item.latitude, longitude: item.longitude, heading: null })
                  }}>
                    <i className="bi bi-pencil-square" aria-hidden="true" /> {editing ? 'Cancelar edição' : 'Editar'}
                  </button>
                )}
              </div>

              {editing && technician && (
                <form className="drawer-form" onSubmit={saveItem}>
                  <label className="field">
                    <span>Etiqueta</span>
                    <input className="input" value={label} onChange={(event) => setLabel(event.target.value)} maxLength={160} required />
                  </label>
                  <div className="field">
                    <span className="field__label">Posição no mapa</span>
                    <LocationPicker
                      value={position}
                      onChange={setPosition}
                      showHeading={false}
                      height={220}
                      className="location-picker--compact"
                    />
                  </div>
                  <div className="drawer-form__actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)} disabled={busy}>Cancelar</button>
                    <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'A guardar…' : 'Guardar elemento'}</button>
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm btn-ghost--danger" onClick={() => setConfirming(true)} disabled={busy}>
                    <i className="bi bi-trash3" aria-hidden="true" /> Apagar elemento
                  </button>
                  {message && <p className="field-hint" role="status">{message}</p>}
                </form>
              )}

              <section className="drawer__section">
                <div className="drawer__section-head">
                  <h3>Imagens que identificaram este elemento</h3>
                  <span className="count-badge">{item.images.length}</span>
                </div>
                {item.images.length === 0 ? (
                  <div className="empty-state">
                    <i className="bi bi-image" aria-hidden="true" />
                    <p>Este elemento ainda não tem imagens associadas.</p>
                  </div>
                ) : (
                  <div className="image-list">
                    {item.images.map((image) => (
                      <ImageCard
                        key={image.id}
                        image={image}
                        token={technician ? token : undefined}
                        onChange={onChanged}
                        onExpand={() => setLightbox(image)}
                      />
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </aside>

      <ConfirmDialog
        open={confirming}
        title="Apagar elemento"
        message="O elemento sai do inventário. As imagens continuam publicadas, mas as deteções associadas são removidas."
        confirmLabel="Apagar elemento"
        danger
        busy={busy}
        onConfirm={() => void removeItem()}
        onCancel={() => setConfirming(false)}
      />

      <Modal
        open={!!lightbox}
        onClose={() => setLightbox(null)}
        title={lightbox ? `Imagem · ${formatDate(lightbox.submitted_at)}` : 'Imagem'}
        subtitle={lightbox ? `${formatCoordinates(lightbox.latitude, lightbox.longitude)} · ${formatHeading(lightbox.heading)} · ${uploaderLabel(lightbox)}` : undefined}
        size="xl"
      >
        {lightbox && (
          <div className="lightbox">
            <DetectionImage src={imageUrl(lightbox.url)} detections={lightbox.detections ?? []} />
          </div>
        )}
      </Modal>
    </>
  )
}

export default ItemDrawer
