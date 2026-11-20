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
const MAX_VIDEO_SECONDS = 20
const VIDEO_INTERVAL_MS = 4000
const EMPTY_POINT: CameraPoint = { latitude: null, longitude: null, heading: null }
const ACCEPTED = [...IMAGE_TYPES, ...VIDEO_TYPES, ...VIDEO_EXTENSIONS]

interface Staged {
  preview: Preview
  image: Blob
  fileName: string
  timestampMs?: number
}

function hasPosition(point?: CameraPoint): boolean {
  return point != null && point.latitude !== null && point.longitude !== null
}

function missingFields(point: CameraPoint): string[] {
  const missing: string[] = []
  if (!hasPosition(point)) missing.push('posição')
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
  const [video, setVideo] = useState<{ file: File; url: string } | null>(null)
  const [readingLocations, setReadingLocations] = useState(false)
  const [videoTimes, setVideoTimes] = useState<number[]>([])
  const [selectedVideoTime, setSelectedVideoTime] = useState<number | null>(null)
  const [videoPoints, setVideoPoints] = useState<Record<number, CameraPoint>>({})
  const videoRef = useRef<HTMLVideoElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  const staged = previews.find(({ preview }) => preview.id === selectedId) ?? previews[0]
  const point = staged ? points[staged.preview.id] ?? staged.preview.camera : null
  const isFrame = staged?.timestampMs !== undefined
  const isPublished = staged ? publishedIds.includes(staged.preview.id) : false

  const firstUnplacedTime = videoTimes.find((time) => !hasPosition(videoPoints[time]))
  const firstIncompleteTime = videoTimes.find((time) => missingFields(videoPoints[time] ?? EMPTY_POINT).length > 0)
  const videoTime = selectedVideoTime ?? firstUnplacedTime ?? firstIncompleteTime ?? videoTimes[0] ?? 0
  const currentVideoPoint = videoPoints[videoTime] ?? EMPTY_POINT
  const previousVideoTime = videoTimes[videoTimes.indexOf(videoTime) - 1]
  const previousVideoPoint = videoPoints[previousVideoTime]
  const nextVideoTime = videoTimes.find((time) => time > videoTime && (
    time === firstUnplacedTime || hasPosition(videoPoints[time])
      && missingFields(videoPoints[time]).length > 0
  )) ?? firstIncompleteTime

  useEffect(() => {
    const player = videoRef.current
    if (!player || readingLocations || !videoTimes.length) return
    player.pause()
    player.currentTime = videoTime / 1000
  }, [readingLocations, videoTime, videoTimes])

  useEffect(() => {
    if (video) return () => URL.revokeObjectURL(video.url)
  }, [video])

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
    setVideo(null)
    setReadingLocations(false)
    setVideoTimes([])
    setSelectedVideoTime(null)
    setVideoPoints({})
  }, [open])

  async function analyze(file: File, locations?: Record<number, CameraPoint>) {
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
    if (isVideo && !locations) {
      setMessage('')
      setVideo({ file, url: URL.createObjectURL(file) })
      setReadingLocations(true)
      try {
        const form = new FormData()
        form.append('video', file)
        const result = await api<{ locations: Record<number, CameraPoint> }>('/video-locations', {
          method: 'POST', body: form, signal,
        }, token)
        if (!signal.aborted) setVideoPoints(result.locations)
      } catch {
        if (!signal.aborted) setMessage('Não foi possível ler a localização do vídeo. Podes indicá-la no mapa.')
      } finally {
        if (requestRef.current === controller) {
          requestRef.current = null
          if (!signal.aborted) setReadingLocations(false)
        }
      }
      return
    }
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
        setSelectedId(results[0]?.preview.id ?? '')
        if (locations) {
          setPoints(Object.fromEntries(results.flatMap(({ preview, timestampMs }) => {
            const location = timestampMs === undefined ? undefined : locations[timestampMs]
            return location ? [[preview.id, location]] : []
          })))
          setVideo(null)
        }
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

  function loadVideo(duration: number) {
    if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_VIDEO_SECONDS) {
      setMessage('Escolhe um vídeo com uma duração até 20 segundos.')
      return
    }
    const times = []
    for (let time = 0; time < duration * 1000; time += VIDEO_INTERVAL_MS) times.push(time)
    setVideoTimes(times)
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    void analyzeFiles(Array.from(event.dataTransfer.files))
  }

  const unpublishedFrames = previews.filter(({ preview, timestampMs }) =>
    timestampMs !== undefined && !publishedIds.includes(preview.id))
  const canPublishFrames = unpublishedFrames.every(({ preview }) =>
    missingFields(points[preview.id] ?? preview.camera).length === 0)

  async function publish(entries: Staged[]) {
    if (!token || busy || requestRef.current || !entries.length) return
    const payloads = entries.map(({ preview }) => ({ id: preview.id, point: points[preview.id] ?? preview.camera }))
    if (payloads.some(({ point }) => missingFields(point).length > 0)) {
      setMessage('Indica a posição e a direção da câmara antes de publicar.')
      return
    }
    const controller = new AbortController()
    requestRef.current = controller
    const { signal } = controller
    setBusy(true)
    setMessage('')
    let published = 0
    try {
      for (const { id, point } of payloads) {
        await api(`/previews/${id}/publish`, {
          method: 'POST', signal, body: JSON.stringify(point),
        }, token)
        if (signal.aborted) return
        published += 1
        if (isFrame) setPublishedIds((current) => [...current, id])
      }
      const confirmation = isFrame
        ? published === 1 ? 'Fotograma publicado.' : `${published} fotogramas publicados.`
        : 'Imagem publicada.'
      notify(`${confirmation} O mapa foi atualizado.`, 'success')
      if (batchMode) {
        const remaining = previews.filter(({ preview }) => preview.id !== entries[0].preview.id)
        setPreviews(remaining)
        setSelectedId(remaining[0]?.preview.id ?? '')
      } else if (!isFrame) {
        onClose()
      }
    } catch (error) {
      if (!signal.aborted) setMessage(errorMessage(error))
    } finally {
      if (published) onPublished()
      if (requestRef.current === controller) {
        requestRef.current = null
        if (!signal.aborted) setBusy(false)
      }
    }
  }

  function reset() {
    requestRef.current?.abort()
    requestRef.current = null
    setPreviews([])
    setSelectedId('')
    setPoints({})
    setPublishedIds([])
    setMessage('')
    setBatch(null)
    setBatchMode(false)
    setVideo(null)
    setReadingLocations(false)
    setVideoTimes([])
    setSelectedVideoTime(null)
    setVideoPoints({})
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

      {token && !staged && !batch && !video && (
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
              <p>Vídeos MP4, MOV ou WebM até 50 MiB e 20 segundos. Analisamos um fotograma a cada quatro segundos.</p>
            </>
          )}
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => inputRef.current?.click()}>
            <i className="bi bi-folder2-open" aria-hidden="true" /> Escolher ficheiros
          </button>
        </div>
      )}

      {token && video && (
        <div className="upload-review">
          <div className="upload-review__media">
            <div className="upload-review__image">
              <video ref={videoRef} src={video.url} controls playsInline preload="metadata"
                onLoadedMetadata={(event) => loadVideo(event.currentTarget.duration)}
                onError={() => {
                  setVideoTimes([])
                  setMessage('Não foi possível reproduzir o vídeo neste navegador. Experimenta um MP4 com H.264.')
                }} />
            </div>
            {videoTimes.length > 0 && (
              <div className="video-steps" role="group" aria-label="Posições ao longo do vídeo">
                {videoTimes.map((time) => {
                  const placed = hasPosition(videoPoints[time])
                  const locked = firstUnplacedTime !== undefined && time > firstUnplacedTime
                  const status = locked ? 'A aguardar a posição anterior' : placed ? (
                    videoPoints[time].heading === null ? 'Falta a direção' : 'Definida'
                  ) : 'Por marcar'
                  return (
                    <button key={time} type="button"
                      className={`video-step${placed ? ' is-placed' : ''}`}
                      aria-current={time === videoTime ? 'step' : undefined}
                      disabled={locked || busy || readingLocations}
                      onClick={() => setSelectedVideoTime(time)}>
                      <strong>{time / 1000} s</strong>
                      <small>{status}</small>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          <div className="upload-review__side">
            <div className="upload-review__heading">
              <h3>Onde estava a câmara aos {videoTime / 1000} s?</h3>
              <p>Marca a posição no mapa e ajusta a direção da câmara antes de avançar.</p>
            </div>
            {readingLocations && <p role="status">A procurar dados de localização no vídeo…</p>}
            {videoTimes.length > 0 && !busy && !readingLocations && (
              <LocationPicker key={videoTime} value={currentVideoPoint} previousPoint={previousVideoPoint}
                onChange={(next) => {
                  setSelectedVideoTime(videoTime)
                  setVideoPoints((current) => ({ ...current, [videoTime]: next }))
                }} height={270} />
            )}
            <div className="upload-review__actions">
              <button type="button" className="btn btn-ghost" onClick={reset} disabled={busy}>Trocar vídeo</button>
              {nextVideoTime !== undefined && nextVideoTime !== videoTime ? (
                <button type="button" className="btn btn-primary" disabled={busy || readingLocations || missingFields(currentVideoPoint).length > 0}
                  onClick={() => setSelectedVideoTime(nextVideoTime)}>
                  {nextVideoTime > videoTime ? 'Avançar' : 'Rever instante anterior'} · {nextVideoTime / 1000} s
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={() => void analyze(video.file, videoPoints)}
                  disabled={busy || readingLocations || !videoTimes.length || firstIncompleteTime !== undefined}>
                  Analisar fotogramas ({videoTimes.length})
                </button>
              )}
            </div>
          </div>
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
              <button type="button" className="btn btn-primary" onClick={() => void publish([staged])}
                disabled={busy || isPublished || missing.length > 0}>
                <i className="bi bi-cloud-arrow-up-fill" aria-hidden="true" />
                {isPublished ? 'Publicado' : busy ? 'A publicar…' : isFrame ? 'Publicar fotograma' : 'Publicar no mapa'}
              </button>
            </div>
            {isFrame && unpublishedFrames.length > 1 && (
              <button type="button" className="btn btn-primary" onClick={() => void publish(unpublishedFrames)}
                disabled={busy || !canPublishFrames}>
                Publicar todos os fotogramas ({unpublishedFrames.length})
              </button>
            )}
          </div>
        </div>
      )}

      {token && video && busy && (
        <div className="upload-batch" role="status">
          <label>
            A analisar os fotogramas…
            <progress />
          </label>
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
