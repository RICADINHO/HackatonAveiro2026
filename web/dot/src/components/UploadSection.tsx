import { useState, type FormEvent } from 'react'
import { api, errorMessage, previewImage } from '../api.ts'
import type { Preview } from '../types.ts'
import { CameraFields } from './CameraFields.tsx'
import { cameraValues } from '../forms.ts'
import { DetectionImage } from './DetectionImage.tsx'

export function UploadSection({ token, onPublished }: { token?: string; onPublished: () => void }) {
  const [preview, setPreview] = useState<{ data: Preview; image: Blob } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)

  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token) return
    const body = new FormData(event.currentTarget)
    setBusy(true)
    setMessage('')
    setFailed(false)
    try {
      const data = await api<Preview>('/previews', { method: 'POST', body }, token)
      setPreview({ data, image: await previewImage(data.id, token) })
    } catch (error) {
      setFailed(true)
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!preview || !token) return
    const body = JSON.stringify(cameraValues(new FormData(event.currentTarget)))
    setBusy(true)
    setMessage('')
    setFailed(false)
    try {
      await api(`/previews/${preview.data.id}/publish`, { method: 'POST', body }, token)
      discard()
      setMessage('Imagem publicada. O mapa foi atualizado.')
      onPublished()
    } catch (error) {
      setFailed(true)
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  function discard() {
    setPreview(null)
    setMessage('')
  }

  const camera = preview?.data.camera
  return (
    <section id="carregar" className="section">
      <div className="container">
        <div className="section-title"><h2>Carregar imagem</h2></div>
        {!token ? <p><a href="#conta">Inicia sessão</a> para submeter uma imagem.</p> : (
          <div className="carregar-ficheiros card shadow-sm">
            <div className="card-body p-4">
              {preview && camera ? (
                <form onSubmit={publish} className="d-grid gap-3">
                  <div><DetectionImage src={preview.image} detections={preview.data.detections} /></div>
                  {Object.values(camera).some((value) => value === null) && (
                    <fieldset disabled={busy}>
                      <legend className="h6">Indica os dados da câmara que faltam na imagem.</legend>
                      <CameraFields camera={camera} missingOnly />
                    </fieldset>
                  )}
                  <div className="d-flex gap-2">
                    <button className="btn btn-primary" disabled={busy}>Upload</button>
                    <button type="button" className="btn btn-outline-secondary" onClick={discard} disabled={busy}>Escolher outra imagem</button>
                  </div>
                </form>
              ) : (
                <form onSubmit={analyze}>
                  <p>O desfoque ainda é experimental. Usa imagens sem rostos ou matrículas visíveis.</p>
                  <label htmlFor="ficheiros" className="form-label">Imagem JPEG, PNG ou WebP até 12 MiB</label>
                  <input type="file" id="ficheiros" name="image" className="form-control" required disabled={busy}
                    accept="image/jpeg,image/png,image/webp" />
                  <button className="btn btn-primary mt-3" disabled={busy}>{busy ? 'A processar…' : 'Pré-visualizar'}</button>
                </form>
              )}
              {message && <div role={failed ? 'alert' : 'status'} className={`alert mt-3 mb-0 ${failed ? 'alert-danger' : 'alert-success'}`}>{message}</div>}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

export default UploadSection
