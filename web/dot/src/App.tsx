import { useState, useEffect, useCallback } from 'react'
import type { Session } from '@supabase/supabase-js'
import Header from './components/Header.tsx'
import MapSection from './components/MapSection.tsx'
import FiltersSection from './components/FiltersSection.tsx'
import UploadSection from './components/UploadSection.tsx'
import Footer from './components/Footer.tsx'
import ScrollTop from './components/ScrollTop.tsx'
import { AuthSection } from './components/AuthSection.tsx'
import { InventoryDetails, ImageDetails } from './components/InventoryDetails.tsx'
import { ReportsSection } from './components/ReportsSection.tsx'
import { api, errorMessage } from './api.ts'
import { supabase } from './supabase.ts'
import type { InventoryItem, ItemDetail, PublishedImage } from './types.ts'

export function App() {
  const [activeSection, setActiveSection] = useState('mapa')
  const [session, setSession] = useState<Session | null>(null)
  const [verifiedTechnicianToken, setVerifiedTechnicianToken] = useState<string>()
  const [items, setItems] = useState<InventoryItem[]>([])
  const [filters, setFilters] = useState<string[]>([])
  const [selected, setSelected] = useState('')
  const [item, setItem] = useState<ItemDetail | null>(null)
  const [mapError, setMapError] = useState('')
  const [mapLoading, setMapLoading] = useState(true)
  const [detailError, setDetailError] = useState('')
  const [reportItem, setReportItem] = useState('')
  const [revision, setRevision] = useState(0)
  const [imagesOpen, setImagesOpen] = useState(false)
  const [images, setImages] = useState<PublishedImage[]>([])
  const [imagesError, setImagesError] = useState('')
  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  const token = session?.access_token
  const technicianToken = token === verifiedTechnicianToken ? token : undefined
  const technician = !!technicianToken

  useEffect(() => {
    function handleScrollSpy() {
      const sections = ['conta', 'problemas', 'carregar', 'filtros', 'mapa']
      const position = window.scrollY + 220

      for (const sectionId of sections) {
        const el = document.getElementById(sectionId)
        if (el && position >= el.getBoundingClientRect().top + window.scrollY) {
          setActiveSection(sectionId)
          break
        }
      }
    }

    window.addEventListener('scroll', handleScrollSpy, { passive: true })
    handleScrollSpy()

    return () => {
      window.removeEventListener('scroll', handleScrollSpy)
    }
  }, [])

  useEffect(() => {
    const theme = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = () => { document.documentElement.dataset.bsTheme = theme.matches ? 'dark' : 'light' }
    applyTheme()
    theme.addEventListener('change', applyTheme)
    return () => theme.removeEventListener('change', applyTheme)
  }, [])

  useEffect(() => {
    const listener = supabase?.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'SIGNED_OUT') {
        setReportItem('')
        setImagesOpen(false)
        setImages([])
        setImagesError('')
        setVerifiedTechnicianToken(undefined)
      }
      setSession(nextSession)
    })
    return () => listener?.data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!token) return
    const controller = new AbortController()
    api<{ role: string }>('/me', { signal: controller.signal }, token).then(({ role }) => {
      if (!controller.signal.aborted) setVerifiedTechnicianToken(role === 'technician' ? token : undefined)
    }).catch(() => {
      if (!controller.signal.aborted) setVerifiedTechnicianToken(undefined)
    })
    return () => controller.abort()
  }, [token])

  useEffect(() => {
    const controller = new AbortController()
    api<InventoryItem[]>('/items', { signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted) {
        setItems(data)
        setMapError('')
      }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setMapError(errorMessage(error))
    }).finally(() => {
      if (!controller.signal.aborted) setMapLoading(false)
    })
    return () => controller.abort()
  }, [revision])

  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    api<ItemDetail>(`/items/${selected}`, { signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted) {
        setItem(data)
        setDetailError('')
      }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setItem(null)
        setDetailError(errorMessage(error))
      }
    })
    return () => controller.abort()
  }, [selected, revision])

  useEffect(() => {
    if (!imagesOpen || !technicianToken) return
    const controller = new AbortController()
    api<PublishedImage[]>('/images', { signal: controller.signal }, technicianToken).then((data) => {
      if (!controller.signal.aborted) {
        setImages(data)
        setImagesError('')
      }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setImages([])
        setImagesError(errorMessage(error))
      }
    })
    return () => controller.abort()
  }, [imagesOpen, technicianToken, revision])

  const visibleItems = filters.length === 0 ? items : items.filter(({ category, class_name }) => (
    filters.includes(category) || filters.includes(class_name)
  ))
  const selectItem = useCallback((id: string) => {
    setSelected(id)
    setDetailError('')
    requestAnimationFrame(() => document.getElementById('selecao-mapa')?.scrollIntoView({ block: 'start' }))
  }, [])

  return (
    <>
      <Header activeSection={activeSection} signedIn={!!session} />
      <main className="main">
        <MapSection items={visibleItems} loading={mapLoading} error={mapError} onSelect={selectItem} />
        <FiltersSection onChange={setFilters} />
        <div id="selecao-mapa">
          {selected && (selected === item?.id ? (
            <InventoryDetails key={item.id} item={item} canReport={!!token} technicianToken={technicianToken}
              onClose={() => setSelected('')} onChange={refresh} onReport={setReportItem} />
          ) : <p className="container" role={detailError ? 'alert' : 'status'}>{detailError || 'A carregar elemento…'}</p>)}
        </div>
        <UploadSection key={`upload-${session?.user.id ?? 'visitor'}`} token={token} onPublished={refresh} />
        {token && <ReportsSection key={`reports-${session?.user.id}`} token={token} technician={technician} items={items}
          selectedItem={reportItem} onSelect={setReportItem} revision={revision} />}
        {technicianToken && (
          <section className="container mb-4">
            <details onToggle={(event) => setImagesOpen(event.currentTarget.open)}>
              <summary className="h5">Gerir imagens publicadas</summary>
              {imagesOpen && <div className="mt-3">
                {imagesError && <p role="alert">{imagesError}</p>}
                {images.map((image) => <ImageDetails key={image.id} image={image} token={technicianToken} onChange={refresh} />)}
              </div>}
            </details>
          </section>
        )}
        <AuthSection session={session} technician={technician} />
      </main>
      <Footer />
      <ScrollTop />
    </>
  )
}

export default App
