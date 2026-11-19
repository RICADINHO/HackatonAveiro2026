import { useEffect, useState, type MouseEvent } from 'react'

export function ScrollTop() {
  const [isActive, setIsActive] = useState(false)

  useEffect(() => {
    function toggleScrollTop() {
      setIsActive(window.scrollY > 100)
    }

    window.addEventListener('scroll', toggleScrollTop, { passive: true })
    toggleScrollTop()

    return () => {
      window.removeEventListener('scroll', toggleScrollTop)
    }
  }, [])

  const scrollToTop = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    })
  }

  return (
    <a
      href="#"
      id="scroll-top"
      className={`scroll-top d-flex align-items-center justify-content-center ${isActive ? 'active' : ''}`}
      onClick={scrollToTop}
      aria-label="Voltar ao topo"
    >
      <i className="bi bi-arrow-up-short" />
    </a>
  )
}

export default ScrollTop

