import { useEffect, useRef, useState, type DragEvent } from 'react'
import { api, errorMessage, previewImage } from '../api.ts'
import { CATEGORY_META, categoryForClass, classLabel } from '../constants.ts'
import type { CameraPoint, Detection, InventoryCategory, Preview } from '../types.ts'
import { DetectionImage } from './DetectionImage.tsx'
import { LocationPicker } from './LocationPicker.tsx'
import { Modal } from './Modal.tsx'

const MAX_BYTES = 12 * 1024 * 1024
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']

interface Staged {
  preview: Preview
  image: Blob
  fileName: string
}

function missingFields(point: CameraPoint): string[] {
  const missing: string[] = []
  if (point.latitude === null || point.longitude === null) missing.push('posição')
  if (point.heading === null) missing.push('direção')
  return missing
}

function detectionSummary(detections: Detection[]) {
  const groups = new Map<string, { label: string; category?: InventoryCategory; count: number; confidence: number }>()
  for (const detection of detections) {
    const className = detection.class_name ?? detection.predicted_class
    const key = className ?? detection.label ?? 'deteção'
    const current = groups.get(key)
    const confidence = detection.confidence
    if (current) {
      current.count += 1
      current.confidence = Math.max(current.confidence, confidence)
    } else {
      groups.set(key, {
        label: detection.label ?? (className ? classLabel(className) : 'Deteção'),
        category: categoryForClass(className),
        count: 1,
        confidence,
      })
    }
  }
  return [...groups.values()]
}

export function UploadDialog({ open, onClose, token, onPublished, notify }: {
  open: boolean
  onClose: () => void
  token?: string
  onPublished: () => void
  notify: (text: string, kind?: 'success' | 'error' | 'info') => void
}) {
  const [staged, setStaged] = useState<Staged | null>(null)
  const [point, setPoint] = useState<CameraPoint>({ latitude: null, longitude: null, heading: null })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) return
    setStaged(null)
    setPoint({ latitude: null, longitude: null, heading: null })
    setBusy(false)
    setMessage('')
    setDragging(false)
  }, [open])

  async function analyze(file: File) {
    if (!token) {
      setMessage('Inicia sessão para carregar imagens.')
      return
    }
    if (!ACCEPTED.includes(file.type)) {
      setMessage('Escolhe uma imagem JPEG, PNG ou WebP.')
      return
    }
    if (file.size > MAX_BYTES) {
      setMessage('O limite por imagem é 12 MiB.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const form = new FormData()
      form.append('image', file)
      const preview = await api<Preview>('/previews', { method: 'POST', body: form }, token)
      const image = await previewImage(preview.id, token)
      setStaged({ preview, image, fileName: file.name })
      setPoint({
        latitude: preview.camera.latitude,
        longitude: preview.camera.longitude,
        heading: preview.camera.heading,
      })
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (file) void analyze(file)
  }

  async function publish() {
    if (!staged || !token) return
    if (missingFields(point).length > 0) {
      setMessage('Indica a posição e a direção da câmara antes de publicar.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      await api(`/previews/${staged.preview.id}/publish`, {
        method: 'POST',
        body: JSON.stringify({
          latitude: point.latitude,
          longitude: point.longitude,
          heading: point.heading,
        }),
      }, token)
      setStaged(null)
      notify('Imagem publicada. O mapa foi atualizado.', 'success')
      onPublished()
      onClose()
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    setStaged(null)
    setPoint({ latitude: null, longitude: null, heading: null })
    setMessage('')
    if (inputRef.current) inputRef.current.value = ''
  }

  const missing = missingFields(point)
  const summary = staged ? detectionSummary(staged.preview.detections) : []

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Carregar imagem"
      subtitle="Detetamos mobiliário urbano e desfocamos rostos e matrículas antes da publicação."
      icon="bi-cloud-arrow-up"
      size="xl"
    >
      {!token && (
        <div className="empty-state empty-state--error">
          <i className="bi bi-lock" aria-hidden="true" />
          <p>Precisas de uma conta para carregar imagens. Inicia sessão e tenta novamente.</p>
        </div>
      )}

      {token && !staged && (
        <div
          className={`dropzone${dragging ? ' is-dragging' : ''}${busy ? ' is-busy' : ''}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED.join(',')}
            className="visually-hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void analyze(file)
            }}
          />
          <span className="dropzone__icon">
            <i className={`bi ${busy ? 'bi-hourglass-split' : 'bi-image'}`} aria-hidden="true" />
          </span>
          <h3>{busy ? 'A processar a imagem…' : 'Arrasta uma fotografia para aqui'}</h3>
          <p>{busy ? 'A detetar mobiliário urbano e a desfocar rostos e matrículas.' : 'JPEG, PNG ou WebP · até 12 MiB'}</p>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => inputRef.current?.click()}>
            <i className="bi bi-folder2-open" aria-hidden="true" /> Escolher ficheiro
          </button>
        </div>
      )}

      {token && staged && (
        <div className="upload-review">
          <div className="upload-review__media">
            <div className="upload-review__image">
              <DetectionImage src={staged.image} detections={staged.preview.detections} alt="Imagem desfocada com deteções" />
            </div>
            <p className="field-hint">Confirma que os rostos e as matrículas estão desfocados antes de publicar.</p>
            <div className="upload-review__file">
              <i className="bi bi-file-earmark-image" aria-hidden="true" />
              <span>{staged.fileName}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={reset} disabled={busy}>
                <i className="bi bi-arrow-repeat" aria-hidden="true" /> Trocar
              </button>
            </div>

            <div className="detection-summary">
              <div className="detection-summary__head">
                <h3>Deteções</h3>
                <span className="count-badge">{staged.preview.detections.length}</span>
              </div>
              {summary.length === 0 && <p className="field-hint">Não foram encontrados itens nesta imagem.</p>}
              <ul>
                {summary.map((item) => (
                  <li key={item.label}>
                    <span
                      className="detection-summary__dot"
                      style={{ background: item.category ? CATEGORY_META[item.category].color : 'var(--accent)' }}
                    />
                    <span>{item.label}</span>
                    {item.count > 1 && <span className="detection-summary__count">×{item.count}</span>}
                    <span className="detection-summary__confidence">{Math.round(item.confidence * 100)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="upload-review__side">
            <div className="upload-review__heading">
              <h3>Onde foi tirada?</h3>
              <p>Marca a posição da câmara e arrasta a seta para indicar a direção.</p>
            </div>
            <LocationPicker value={point} onChange={setPoint} height={270} />
            <div className="source-tags">
              <span className={`source-tag${staged.preview.camera.latitude !== null && staged.preview.camera.longitude !== null ? ' is-on' : ''}`}>
                <i className={`bi ${staged.preview.camera.latitude !== null ? 'bi-check-circle-fill' : 'bi-dash-circle'}`} aria-hidden="true" />
                GPS da imagem
              </span>
              <span className={`source-tag${staged.preview.camera.heading !== null ? ' is-on' : ''}`}>
                <i className={`bi ${staged.preview.camera.heading !== null ? 'bi-check-circle-fill' : 'bi-dash-circle'}`} aria-hidden="true" />
                Direção da imagem
              </span>
            </div>
            {missing.length > 0 && (
              <p className="field-hint field-hint--warn">
                <i className="bi bi-exclamation-triangle" aria-hidden="true" />
                Falta indicar: {missing.join(' e ')}.
              </p>
            )}
            <div className="upload-review__actions">
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
              <button type="button" className="btn btn-primary" onClick={() => void publish()} disabled={busy || missing.length > 0}>
                <i className="bi bi-cloud-arrow-up-fill" aria-hidden="true" />
                {busy ? 'A publicar…' : 'Publicar no mapa'}
              </button>
            </div>
          </div>
        </div>
      )}

      {message && (
        <div className="form-message form-message--error" role="alert">
          <i className="bi bi-exclamation-triangle-fill" aria-hidden="true" /> {message}
        </div>
      )}
    </Modal>
  )
}

export default UploadDialog
