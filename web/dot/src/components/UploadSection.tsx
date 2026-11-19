import { useState, type FormEvent, type ChangeEvent } from 'react'

export function UploadSection() {
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null)
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'info' | 'error' } | null>(null)

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    setSelectedFiles(e.target.files)
    if (e.target.files && e.target.files.length > 0) {
      setStatusMessage({
        text: `${e.target.files.length} ficheiro(s) selecionado(s).`,
        type: 'info',
      })
    } else {
      setStatusMessage(null)
    }
  }

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!selectedFiles || selectedFiles.length === 0) {
      setStatusMessage({ text: 'Por favor seleciona pelo menos um ficheiro.', type: 'error' })
      return
    }

    // Preparado para ligar com endpoint de upload do backend
    setStatusMessage({
      text: `${selectedFiles.length} ficheiro(s) enviado(s) para análise com sucesso!`,
      type: 'success',
    })
  }

  return (
    <section id="carregar" className="section">
      <div className="container">
        <div className="section-title">
          <h2>Carregar ficheiros</h2>
          <p>Seleciona imagens ou vídeos para identificacão.</p>
        </div>

        <div className="carregar-ficheiros card shadow-sm">
          <div className="card-body p-4">
            <form id="form-upload" onSubmit={handleSubmit}>
              <label htmlFor="ficheiros" className="form-label">
                Imagens ou vídeos
              </label>

              <input
                type="file"
                id="ficheiros"
                name="ficheiros"
                className="form-control"
                accept="image/*,video/*"
                multiple
                required
                onChange={handleFileChange}
              />

              <p className="text-muted small mt-2">Podes selecionar vários ficheiros.</p>

              {statusMessage && (
                <div
                  className={`alert mt-3 ${
                    statusMessage.type === 'success'
                      ? 'alert-success'
                      : statusMessage.type === 'error'
                        ? 'alert-danger'
                        : 'alert-info'
                  }`}
                  role="alert"
                >
                  {statusMessage.text}
                </div>
              )}

              <button type="submit" className="btn btn-primary mt-2">
                <i className="bi bi-upload me-2"></i>
                Enviar para análise
              </button>
            </form>
          </div>
        </div>
      </div>
    </section>
  )
}

export default UploadSection

