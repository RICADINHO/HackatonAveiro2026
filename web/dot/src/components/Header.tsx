import { useEffect, useRef, useState } from 'react'
import { useTheme } from '../theme.tsx'
import type { Account } from '../types.ts'

function initials(name: string | null, email: string | null): string {
  const source = (name || email || '?').trim()
  const words = source.split(/[\s.@_-]+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return source.slice(0, 2).toUpperCase()
}

export function Header({ account, email, openReports, onOpenAuth, onSignOut, onOpenUpload, onOpenReports, onOpenImages }: {
  account: Account | null
  email: string | null
  openReports: number
  onOpenAuth: () => void
  onSignOut: () => void
  onOpenUpload: () => void
  onOpenReports: () => void
  onOpenImages: () => void
}) {
  const { dark, toggle } = useTheme()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const technician = account?.role === 'technician'
  const displayName = account?.public_name || email?.split('@')[0] || 'A minha conta'
  const avatar = initials(account?.public_name ?? null, email)

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  useEffect(() => { setMenuOpen(false) }, [account?.id])

  return (
    <header className="appbar">
      <div className="appbar__brand">
        <span className="brand-mark" aria-hidden="true">
          <i className="bi bi-geo-alt-fill" />
          <span className="brand-mark__lens" />
        </span>
        <span className="brand-text">
          <strong>Ctrl+F Aveiro</strong>
          <small>Mobiliário urbano</small>
        </span>
      </div>

      <div className="appbar__actions">
        <button
          type="button"
          className="icon-btn"
          onClick={toggle}
          aria-label={dark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
          title={dark ? 'Tema claro' : 'Tema escuro'}
        >
          <i className={`bi ${dark ? 'bi-sun-fill' : 'bi-moon-stars-fill'}`} aria-hidden="true" />
        </button>

        {!account && (
          <button type="button" className="btn btn-ghost appbar__login" onClick={onOpenAuth}>
            <i className="bi bi-person-circle" aria-hidden="true" />
            <span>Entrar</span>
          </button>
        )}

        {account && (
          <div className="account" ref={menuRef}>
            <button
              type="button"
              className={`account__trigger${menuOpen ? ' is-open' : ''}`}
              onClick={() => setMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <span className="avatar" aria-hidden="true">{avatar}</span>
              <span className="account__text">
                <strong>{displayName}</strong>
                <small>{technician ? 'Técnico' : 'Utilizador'}</small>
              </span>
              <i className={`bi bi-chevron-down account__chevron${menuOpen ? ' is-open' : ''}`} aria-hidden="true" />
            </button>

            {menuOpen && (
              <div className="account__menu" role="menu">
                <div className="account__head">
                  <span className="avatar avatar--lg" aria-hidden="true">{avatar}</span>
                  <div>
                    <strong>{displayName}</strong>
                    {email && <small>{email}</small>}
                    <span className={`role-badge ${technician ? 'role-badge--tech' : ''}`}>
                      <i className={`bi ${technician ? 'bi-tools' : 'bi-person'}`} aria-hidden="true" />
                      {technician ? 'Conta de técnico' : 'Conta de utilizador'}
                    </span>
                  </div>
                </div>
                <div className="account__items">
                  <button type="button" role="menuitem" className="menu-item" onClick={() => { setMenuOpen(false); onOpenUpload() }}>
                    <i className="bi bi-cloud-arrow-up" aria-hidden="true" /> Carregar foto ou vídeo
                  </button>
                  <button type="button" role="menuitem" className="menu-item" onClick={() => { setMenuOpen(false); onOpenReports() }}>
                    <i className="bi bi-flag" aria-hidden="true" /> Problemas
                    {technician && openReports > 0 && <span className="menu-count">{openReports}</span>}
                  </button>
                  {technician && (
                    <button type="button" role="menuitem" className="menu-item" onClick={() => { setMenuOpen(false); onOpenImages() }}>
                      <i className="bi bi-images" aria-hidden="true" /> Gerir imagens
                    </button>
                  )}
                  <div className="menu-divider" />
                  <button type="button" role="menuitem" className="menu-item menu-item--danger" onClick={() => { setMenuOpen(false); onSignOut() }}>
                    <i className="bi bi-box-arrow-right" aria-hidden="true" /> Terminar sessão
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <button type="button" className="btn btn-primary appbar__upload" onClick={onOpenUpload}>
          <i className="bi bi-cloud-arrow-up-fill" aria-hidden="true" />
          <span>Carregar</span>
        </button>
      </div>
    </header>
  )
}

export default Header
