import { useEffect, useState } from 'react'
import { api, errorMessage, imageUrl } from '../api.ts'
import { formatCoordinates, formatHeading } from '../constants.ts'
import type { PublishedImage } from '../types.ts'
import { DetectionImage } from './DetectionImage.tsx'
import { ImageCard } from './ItemDrawer.tsx'
import { Modal } from './Modal.tsx'

export function ImagesDialog({ open, onClose, token, revision, onChanged }: {
  open: boolean
  onClose: () => void
  token?: string
  revision: number
  onChanged: () => void
}) {
  const [images, setImages] = useState<PublishedImage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [localRevision, setLocalRevision] = useState(0)
  const [lightbox, setLightbox] = useState<PublishedImage | null>(null)

  useEffect(() => {
    if (!open || !token) return
    const controller = new AbortController()
    setLoading(true)
    api<PublishedImage[]>('/images', { signal: controller.signal }, token).then((data) => {
      if (controller.signal.aborted) return
      setImages(data)
      setError('')
    }).catch((requestError: unknown) => {
      if (controller.signal.aborted) return
      setImages([])
      setError(errorMessage(requestError))
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [open, token, revision, localRevision])

  const changed = () => {
    setLocalRevision((value) => value + 1)
    onChanged()
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Gerir imagens publicadas"
        subtitle="Corrige a posição da câmara ou remove imagens. As posições dos elementos são recalculadas."
        icon="bi-images"
        size="lg"
      >
        <div className="images-toolbar">
          <span className="count-badge">{images.length}</span>
          <span className="field-hint">imagens publicadas</span>
        </div>
        {loading && <p className="field-hint">A carregar imagens…</p>}
        {error && <div className="form-message form-message--error" role="alert">{error}</div>}
        {!loading && !error && images.length === 0 && (
          <div className="empty-state">
            <i className="bi bi-images" aria-hidden="true" />
            <p>Ainda não há imagens publicadas.</p>
          </div>
        )}
        <div className="images-grid">
          {images.map((image) => (
            <ImageCard
              key={image.id}
              image={image}
              token={token}
              onChange={changed}
              onExpand={() => setLightbox(image)}
            />
          ))}
        </div>
      </Modal>

      <Modal
        open={!!lightbox}
        onClose={() => setLightbox(null)}
        title="Imagem publicada"
        subtitle={lightbox ? `${formatCoordinates(lightbox.latitude, lightbox.longitude)} · ${formatHeading(lightbox.heading)}` : undefined}
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

export default ImagesDialog
