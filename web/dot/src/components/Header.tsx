import { useState, useEffect } from 'react'

interface HeaderProps {
  activeSection?: string
  signedIn?: boolean
}

export function Header({ activeSection = 'mapa', signedIn }: HeaderProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  useEffect(() => {
    if (mobileNavOpen) {
      document.body.classList.add('mobile-nav-active')
    } else {
      document.body.classList.remove('mobile-nav-active')
    }

    return () => {
      document.body.classList.remove('mobile-nav-active')
    }
  }, [mobileNavOpen])

  useEffect(() => {
    function handleScroll() {
      if (window.scrollY > 100) {
        document.body.classList.add('scrolled')
      } else {
        document.body.classList.remove('scrolled')
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()

    return () => {
      window.removeEventListener('scroll', handleScroll)
    }
  }, [])

  const closeMobileNav = () => {
    setMobileNavOpen(false)
  }

  const toggleMobileNav = () => {
    setMobileNavOpen((prev) => !prev)
  }

  return (
    <header id="header" className="header d-flex align-items-center sticky-top">
      <div className="header-container container-fluid container-xl d-flex align-items-center justify-content-between">
        <a href="#" className="logo d-flex align-items-center" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>
          <h1 className="sitename">Ctrl+F Aveiro: Indetificacão automática do mobiliário urbano</h1>
        </a>

        <nav id="navmenu" className="navmenu">
          <ul>
            <li>
              <a
                href="#mapa"
                className={activeSection === 'mapa' ? 'active' : ''}
                onClick={closeMobileNav}
              >
                Mapa
              </a>
            </li>
            <li>
              <a
                href="#filtros"
                className={activeSection === 'filtros' ? 'active' : ''}
                onClick={closeMobileNav}
              >
                Filtros
              </a>
            </li>
            <li>
              <a
                href="#carregar"
                className={activeSection === 'carregar' ? 'active' : ''}
                onClick={closeMobileNav}
              >
                Carregar imagem
              </a>
            </li>
            {signedIn && <li><a href="#problemas" className={activeSection === 'problemas' ? 'active' : ''} onClick={closeMobileNav}>Problemas</a></li>}
            <li><a href="#conta" className={activeSection === 'conta' ? 'active' : ''} onClick={closeMobileNav}>{signedIn ? 'Conta' : 'Entrar'}</a></li>
          </ul>
          <i
            className={`mobile-nav-toggle d-xl-none bi ${mobileNavOpen ? 'bi-x' : 'bi-list'}`}
            onClick={toggleMobileNav}
            aria-label="Alternar navegação"
            role="button"
          />
        </nav>
      </div>
    </header>
  )
}
export default Header

