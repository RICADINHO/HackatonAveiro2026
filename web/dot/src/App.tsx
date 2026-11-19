import { useState, useEffect } from 'react'
import Header from './components/Header.tsx'
import MapSection from './components/MapSection.tsx'
import FiltersSection from './components/FiltersSection.tsx'
import UploadSection from './components/UploadSection.tsx'
import Footer from './components/Footer.tsx'
import ScrollTop from './components/ScrollTop.tsx'

export function App() {
  const [activeSection, setActiveSection] = useState<'mapa' | 'filtros' | 'carregar'>('mapa')

  useEffect(() => {
    function handleScrollSpy() {
      const sections: Array<'mapa' | 'filtros' | 'carregar'> = ['mapa', 'filtros', 'carregar']
      const position = window.scrollY + 220

      for (const sectionId of sections) {
        const el = document.getElementById(sectionId)
        if (el) {
          const top = el.offsetTop
          const height = el.offsetHeight
          if (position >= top && position <= top + height) {
            setActiveSection(sectionId)
            break
          }
        }
      }
    }

    window.addEventListener('scroll', handleScrollSpy, { passive: true })
    handleScrollSpy()

    return () => {
      window.removeEventListener('scroll', handleScrollSpy)
    }
  }, [])

  return (
    <>
      <Header activeSection={activeSection} />
      <main className="main">
        <MapSection />
        <FiltersSection />
        <UploadSection />
      </main>
      <Footer />
      <ScrollTop />
    </>
  )
}

export default App
