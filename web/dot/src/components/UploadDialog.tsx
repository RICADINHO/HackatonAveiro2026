import { useEffect, useRef, useState, type DragEvent } from 'react'
import { api, errorMessage, previewImage } from '../api.ts'
import { CATEGORY_META, categoryForClass, classLabel } from '../constants.ts'
import type { CameraPoint, Detection, InventoryCategory, Preview, VideoFramePreview } from '../types.ts'
import { DetectionImage } from './DetectionImage.tsx'
import { LocationPicker } from './LocationPicker.tsx'
import { Modal } from './Modal.tsx'

const MIB = 1024 * 1024
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm']
const ACCEPTED = [...IMAGE_TYPES, ...VIDEO_TYPES, ...VIDEO_EXTENSIONS]

interface Staged {
  preview: Preview
  image: Blob
  fileName: string
  timestampMs?: number
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
  const [previews, setPreviews] = useState<Staged[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [points, setPoints] = useState<Record<string, CameraPoint>>({})
  const [publishedIds, setPublishedIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [dragging, setDragging] = useState(false)
  const [batch, setBatch] = useState<{ done: number; total: number; current: string; errors: string[] } | null>(null)
  const [batchMode, setBatchMode] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  const staged = previews.find(({ preview }) => preview.id === selectedId) ?? previews[0]
  const point = staged ? points[staged.preview.id] ?? staged.preview.camera : null
  const isFrame = staged?.timestampMs !== undefined
  const isPublished = staged ? publishedIds.includes(staged.preview.id) : false

  useEffect(() => {
    if (open) return () => requestRef.current?.abort()
    requestRef.current = null
    setPreviews([])
    setSelectedId('')
    setPoints({})
    setPublishedIds([])
    setBusy(false)
    setMessage('')
    setDragging(false)
    setBatch(null)
    setBatchMode(false)
  }, [open])

  async function analyze(file: File) {
    if (busy || requestRef.current) return
    if (!token) {
      setMessage('Inicia sessão para carregar imagens ou vídeos.')
      return
    }
    const isVideo = VIDEO_TYPES.includes(file.type)
      || VIDEO_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension))
    if (!isVideo && !IMAGE_TYPES.includes(file.type)) {
      setMessage('Escolhe uma imagem JPEG, PNG ou WebP ou um vídeo MP4, MOV ou WebM.')
      return
    }
    if (file.size > (isVideo ? 50 : 12) * MIB) {
      setMessage(isVideo ? 'O limite por vídeo é 50 MiB.' : 'O limite por imagem é 12 MiB.')
      return
    }
    const controller = new AbortController()
    requestRef.current = controller
    const { signal } = controller
    setBusy(true)
    setMessage('')
    try {
      const form = new FormData()
      form.append(isVideo ? 'video' : 'image', file)
      const options = { method: 'POST', body: form, signal }
      const entries: (Preview & { timestamp_ms?: number })[] = isVideo
        ? (await api<{ frames: VideoFramePreview[] }>('/video-previews', options, token)).frames
        : [await api<Preview>('/previews', options, token)]
      const results = await Promise.all(entries.map(async (preview) => ({
        preview,
        image: await previewImage(preview.id, token, signal),
        fileName: file.name,
        timestampMs: preview.timestamp_ms,
      })))
      if (!signal.aborted) {
        setPreviews(results)
        setSelectedId(results[0].preview.id)
      }
    } catch (error) {
      if (!signal.aborted) setMessage(errorMessage(error))
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null
        if (!signal.aborted) setBusy(false)
      }
    }
  }

  async function analyzeFiles(files: File[]) {
    if (files.length === 1) return analyze(files[0])
    if (!files.length || busy || requestRef.current || !token) return
    if (files.some((file) => !IMAGE_TYPES.includes(file.type))) {
      setMessage('Para carregar vários ficheiros, escolhe apenas imagens JPEG, PNG ou WebP. Carrega vídeos individualmente.')
      return
    }
    const controller = new AbortController()
    requestRef.current = controller
    const { signal } = controller
    const pending: Staged[] = []
    const errors: string[] = []
    let published = 0
    setBusy(true)
    setBatchMode(true)
    setMessage('')
    setBatch({ done: 0, total: files.length, current: files[0].name, errors: [] })
    try {
      for (const [index, file] of files.entries()) {
        if (signal.aborted) break
        setBatch({ done: index, total: files.length, current: file.name, errors: [...errors] })
        try {
          if (file.size > 12 * MIB) throw new Error('O limite por imagem é 12 MiB.')
          const form = new FormData()
          form.append('image', file)
          const preview = await api<Preview>('/previews', { method: 'POST', body: form, signal }, token)
          const image = await previewImage(preview.id, token, signal)
          const result: Staged = { preview, image, fileName: file.name }
          if (signal.aborted) break
          setPreviews([result])
          setSelectedId(preview.id)
          if (missingFields(preview.camera).length) {
            pending.push(result)
          } else {
            try {
              await api(`/previews/${preview.id}/publish`, {
                method: 'POST', signal, body: JSON.stringify(preview.camera),
              }, token)
              published += 1
              onPublished()
            } catch (error) {
              if (signal.aborted) break
              pending.push(result)
              errors.push(`${file.name}: ${errorMessage(error)}`)
            }
          }
        } catch (error) {
          if (signal.aborted) break
          errors.push(`${file.name}: ${errorMessage(error)}`)
        }
        setBatch({ done: index + 1, total: files.length, current: file.name, errors: [...errors] })
      }
      if (!signal.aborted) {
        setPreviews(pending)
        setSelectedId(pending[0]?.preview.id ?? '')
        if (published) notify(`${published} ${published === 1 ? 'imagem publicada' : 'imagens publicadas'}. O mapa foi atualizado.`, 'success')
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null
        if (!signal.aborted) setBusy(false)
      }
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    void analyzeFiles(Array.from(event.dataTransfer.files))
  }

  async function publish() {
    if (!staged || !point || !token || isPublished || busy || requestRef.current) return
    if (missingFields(point).length > 0) {
      setMessage('Indica a posição e a direção da câmara antes de publicar.')
      return
    }
    const controller = new AbortController()
    requestRef.current = controller
    const { signal } = controller
    setBusy(true)
    setMessage('')
    try {
      await api(`/previews/${staged.preview.id}/publish`, {
        method: 'POST',
        signal,
        body: JSON.stringify({
          latitude: point.latitude,
          longitude: point.longitude,
          heading: point.heading,
        }),
      }, token)
      if (signal.aborted) return
      notify(isFrame ? 'Fotograma publicado. O mapa foi atualizado.' : 'Imagem publicada. O mapa foi atualizado.', 'success')
      onPublished()
      if (batchMode) {
        const remaining = previews.filter(({ preview }) => preview.id !== staged.preview.id)
        setPreviews(remaining)
        setSelectedId(remaining[0]?.preview.id ?? '')
      } else if (isFrame) {
        setPublishedIds((current) => [...current, staged.preview.id])
      } else {
        onClose()
      }
    } catch (error) {
      if (!signal.aborted) setMessage(errorMessage(error))
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null
        if (!signal.aborted) setBusy(false)
      }
    }
  }

  function reset() {
    setPreviews([])
    setSelectedId('')
    setPoints({})
    setPublishedIds([])
    setMessage('')
    setBatch(null)
    setBatchMode(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  const missing = point ? missingFields(point) : []
  const summary = staged ? detectionSummary(staged.preview.detections) : []

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Carregar foto ou vídeo"
      subtitle="Detetamos mobiliário urbano e desfocamos rostos e matrículas antes da publicação."
      icon="bi-cloud-arrow-up"
      size="xl"
    >
      {!token && (
        <div className="empty-state empty-state--error">
          <i className="bi bi-lock" aria-hidden="true" />
          <p>Inicia sessão para carregar imagens ou vídeos.</p>
        </div>
      )}

      {token && !staged && !batch && (
        <div
          className={`dropzone${dragging ? ' is-dragging' : ''}${busy ? ' is-busy' : ''}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPTED.join(',')}
            className="visually-hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              event.target.value = ''
              void analyzeFiles(files)
            }}
          />
          <span className="dropzone__icon">
            <i className={`bi ${busy ? 'bi-hourglass-split' : 'bi-image'}`} aria-hidden="true" />
          </span>
          <h3>{busy ? 'A analisar o ficheiro…' : 'Arrasta fotos ou um vídeo para aqui'}</h3>
          {busy ? <p>A detetar mobiliário urbano e a desfocar rostos e matrículas.</p> : (
            <>
              <p>Fotos JPEG, PNG ou WebP até 12 MiB</p>
              <p>Vídeos MP4, MOV ou WebM até 50 MiB e 20 segundos. Analisamos até quatro fotogramas.</p>
            </>
          )}
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => inputRef.current?.click()}>
            <i className="bi bi-folder2-open" aria-hidden="true" /> Escolher ficheiros
          </button>
        </div>
      )}

      {token && staged && busy && batchMode && (
        <div className="upload-review__image">
          <DetectionImage src={staged.image} detections={staged.preview.detections} alt="Última imagem analisada com deteções" />
          <p className="field-hint">Última imagem analisada: {staged.fileName}</p>
        </div>
      )}
      {batch && (
        <div className="upload-batch" aria-live="polite">
          <p>{busy ? `A analisar: ${batch.current}` : 'Processamento concluído'} · {batch.done}/{batch.total}</p>
          <progress value={batch.done} max={batch.total} aria-label="Progresso do carregamento" />
          {!busy && previews.length > 0 && <p>{previews.length} {previews.length === 1 ? 'imagem precisa de revisão' : 'imagens precisam de revisão'} antes da publicação.</p>}
          {batch.errors.length > 0 && <div className="form-message form-message--error" role="alert">{batch.errors.map((error, index) => <p key={index}>{error}</p>)}</div>}
          {!busy && previews.length === 0 && <button type="button" className="btn btn-ghost" onClick={reset}>Carregar mais ficheiros</button>}
        </div>
      )}
      {token && staged && point && !(busy && batchMode) && (
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
            {(isFrame || batchMode) && (
              <label className="field">
                {batchMode ? 'Imagem a rever' : 'Fotograma do vídeo'}
                <select className="select" value={selectedId} disabled={busy} onChange={(event) => {
                  setSelectedId(event.target.value)
                  setMessage('')
                }}>
                  {previews.map(({ preview, timestampMs, fileName }) => (
                    <option key={preview.id} value={preview.id}>
                      {batchMode ? fileName : `${((timestampMs ?? 0) / 1000).toLocaleString('pt-PT', { maximumFractionDigits: 1 })} s`}
                      {' · '}{preview.detections.length} {preview.detections.length === 1 ? 'deteção' : 'deteções'}
                      {publishedIds.includes(preview.id) ? ' · Publicado' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}

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
              <h3>{isFrame ? 'Onde foi gravado este fotograma?' : 'Onde foi tirada?'}</h3>
              <p>Marca a posição da câmara no mapa e arrasta a seta para indicar a direção.</p>
            </div>
            <LocationPicker key={staged.preview.id} value={point}
              onChange={(next) => setPoints((current) => ({ ...current, [staged.preview.id]: next }))} height={270} />
            {!isFrame && <div className="source-tags">
              <span className={`source-tag${staged.preview.camera.latitude !== null && staged.preview.camera.longitude !== null ? ' is-on' : ''}`}>
                <i className={`bi ${staged.preview.camera.latitude !== null ? 'bi-check-circle-fill' : 'bi-dash-circle'}`} aria-hidden="true" />
                GPS da imagem
              </span>
              <span className={`source-tag${staged.preview.camera.heading !== null ? ' is-on' : ''}`}>
                <i className={`bi ${staged.preview.camera.heading !== null ? 'bi-check-circle-fill' : 'bi-dash-circle'}`} aria-hidden="true" />
                Direção da imagem
              </span>
            </div>}
            {missing.length > 0 && (
              <p className="field-hint field-hint--warn">
                <i className="bi bi-exclamation-triangle" aria-hidden="true" />
                Falta indicar: {missing.join(' e ')}.
              </p>
            )}
            <div className="upload-review__actions">
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{isFrame ? 'Fechar' : 'Cancelar'}</button>
              <button type="button" className="btn btn-primary" onClick={() => void publish()}
                disabled={busy || isPublished || missing.length > 0}>
                <i className="bi bi-cloud-arrow-up-fill" aria-hidden="true" />
                {isPublished ? 'Publicado' : busy ? 'A publicar…' : isFrame ? 'Publicar fotograma' : 'Publicar no mapa'}
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
