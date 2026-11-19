import { useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../supabase.ts'
import { errorMessage } from '../api.ts'

export function AuthSection({ session, technician }: { session: Session | null; technician: boolean }) {
  const [register, setRegister] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    const values = new FormData(event.currentTarget)
    const email = String(values.get('email'))
    const password = String(values.get('password'))
    const name = String(values.get('name') ?? '').trim()
    setBusy(true)
    setMessage('')
    try {
      const { data, error } = register
        ? await supabase.auth.signUp({ email, password, options: {
          data: name ? { public_name: name } : undefined,
          emailRedirectTo: new URL(import.meta.env.BASE_URL, window.location.origin).href,
        } })
        : await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      if (register && !data.session) setMessage('Consulta o teu email para confirmares o registo.')
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    setBusy(true)
    try {
      const result = await supabase?.auth.signOut()
      if (result?.error) throw result.error
      setMessage('')
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="conta" className="section">
      <div className="container">
        <div className="section-title"><h2>Conta</h2></div>
        {!supabase ? <p>A autenticação ainda não está configurada.</p> : session ? (
          <div className="d-flex flex-wrap gap-3 align-items-center">
            <span>{session.user.email}{technician && ' · Técnico'}</span>
            <button type="button" className="btn btn-outline-primary" disabled={busy} onClick={() => void signOut()}>
              Terminar sessão
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="row g-3 align-items-end">
            <label className="col-md-4">Email<input name="email" className="form-control" type="email" autoComplete="email" required /></label>
            <label className="col-md-4">Palavra-passe<input name="password" className="form-control" type="password"
              autoComplete={register ? 'new-password' : 'current-password'} minLength={register ? 6 : undefined} required /></label>
            {register && <label className="col-md-4">Nome público (opcional)<input name="name" className="form-control" maxLength={120} /></label>}
            <div className="col-12 d-flex flex-wrap gap-2">
              <button className="btn btn-primary" disabled={busy}>{register ? 'Criar conta' : 'Entrar'}</button>
              <button type="button" className="btn btn-outline-primary" disabled={busy} onClick={() => {
                setRegister(!register)
                setMessage('')
              }}>{register ? 'Já tenho conta' : 'Registar'}</button>
            </div>
          </form>
        )}
        {message && <p className="mt-3" role="status">{message}</p>}
      </div>
    </section>
  )
}
