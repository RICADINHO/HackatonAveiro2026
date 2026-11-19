import { useEffect, useState, type FormEvent } from 'react'
import { errorMessage } from '../api.ts'
import { supabase } from '../supabase.ts'
import { Modal } from './Modal.tsx'

export function AuthDialog({ open, onClose, onDone, reason }: {
  open: boolean
  onClose: () => void
  onDone: () => void
  reason?: string
}) {
  const [register, setRegister] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)

  useEffect(() => {
    if (!open) return
    setMessage('')
    setSent(false)
    setBusy(false)
  }, [open])

  useEffect(() => {
    if (!open) return
    setRegister(false)
  }, [open, reason])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email'))
    const password = String(form.get('password'))
    const name = String(form.get('name') ?? '').trim()
    setBusy(true)
    setMessage('')
    try {
      const { data, error } = register
        ? await supabase.auth.signUp({
          email,
          password,
          options: {
            data: name ? { public_name: name } : undefined,
            emailRedirectTo: new URL(import.meta.env.BASE_URL, window.location.origin).href,
          },
        })
        : await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      if (register && !data.session) {
        setSent(true)
      } else {
        onDone()
      }
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={register ? 'Criar conta' : 'Entrar'}
      subtitle={reason ?? 'Guarda as tuas imagens, comunica problemas e ajuda a manter o inventário atualizado.'}
      icon={register ? 'bi-person-plus' : 'bi-person-lock'}
      size="sm"
    >
      {!supabase && (
        <div className="empty-state empty-state--error">
          <i className="bi bi-plug" aria-hidden="true" />
          <p>A autenticação não está configurada. Define as chaves do Supabase em web/src/config.ts.</p>
        </div>
      )}

      {supabase && sent ? (
        <div className="empty-state empty-state--success">
          <i className="bi bi-envelope-check" aria-hidden="true" />
          <p>Conta criada. Confirma o teu email para poderes entrar.</p>
          <button type="button" className="btn btn-soft" onClick={onClose}>Fechar</button>
        </div>
      ) : supabase && (
        <>
          <div className="segmented" role="tablist" aria-label="Entrar ou criar conta">
            <button
              type="button"
              role="tab"
              aria-selected={!register}
              className={!register ? 'is-active' : ''}
              onClick={() => { setRegister(false); setMessage('') }}
            >
              Entrar
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={register}
              className={register ? 'is-active' : ''}
              onClick={() => { setRegister(true); setMessage('') }}
            >
              Criar conta
            </button>
          </div>

          <form className="auth-form" onSubmit={submit}>
            <label className="field">
              <span>Email</span>
              <input className="input" name="email" type="email" autoComplete="email" required placeholder="nome@exemplo.pt" />
            </label>
            <label className="field">
              <span>Palavra-passe</span>
              <input
                className="input"
                name="password"
                type="password"
                autoComplete={register ? 'new-password' : 'current-password'}
                minLength={register ? 6 : undefined}
                required
                placeholder={register ? 'Pelo menos 6 caracteres' : '••••••••'}
              />
            </label>
            {register && (
              <label className="field">
                <span>Nome público <small>(opcional)</small></span>
                <input className="input" name="name" maxLength={120} placeholder="Como queres aparecer nas imagens" />
              </label>
            )}
            {message && <div className="form-message form-message--error" role="alert">{message}</div>}
            <button className="btn btn-primary btn-block" disabled={busy}>
              {busy ? 'A processar…' : register ? 'Criar conta' : 'Entrar'}
            </button>
          </form>

          <p className="auth-foot">
            <i className="bi bi-info-circle" aria-hidden="true" />
            {register
              ? 'As contas de técnico são atribuídas por um administrador.'
              : 'Ainda não tens conta? Usa “Criar conta” acima.'}
          </p>
        </>
      )}
    </Modal>
  )
}

export default AuthDialog
