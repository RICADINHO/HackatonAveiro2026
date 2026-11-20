import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ThemeProvider } from './theme.tsx'
import { ToastStack, useToasts } from './toast.tsx'
import Header from './components/Header.tsx'
import MapView from './components/MapView.tsx'
import FilterPanel from './components/FilterPanel.tsx'
import ItemDrawer from './components/ItemDrawer.tsx'
import UploadDialog from './components/UploadDialog.tsx'
import AuthDialog from './components/AuthDialog.tsx'
import ReportsDialog from './components/ReportsDialog.tsx'
import ImagesDialog from './components/ImagesDialog.tsx'
import { api, downloadInventoryCsv, errorMessage } from './api.ts'
import { supabase } from './supabase.ts'
import { CATEGORY_ORDER } from './constants.ts'
import type { Account, InventoryCategory, InventoryItem, ItemDetail, Report } from './types.ts'

function AppShell() {
  const [session, setSession] = useState<Session | null>(null)
  const [account, setAccount] = useState<Account | null>(null)
  const [items, setItems] = useState<InventoryItem[]>([])
  const [mapLoading, setMapLoading] = useState(true)
  const [mapError, setMapError] = useState('')
  const [filters, setFilters] = useState<Set<InventoryCategory>>(() => new Set(CATEGORY_ORDER))
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [item, setItem] = useState<ItemDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [revision, setRevision] = useState(0)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [authReason, setAuthReason] = useState('')
  const [reportsOpen, setReportsOpen] = useState(false)
  const [reportItem, setReportItem] = useState('')
  const [imagesOpen, setImagesOpen] = useState(false)
  const [csvBusy, setCsvBusy] = useState(false)
  const [openReports, setOpenReports] = useState(0)
  const pendingUpload = useRef(false)
  const { toasts, notify, dismiss } = useToasts()

  const token = session?.access_token
  const email = session?.user.email ?? null
  const technician = account?.role === 'technician'
  const refresh = useCallback(() => setRevision((value) => value + 1), [])

  useEffect(() => {
    const listener = supabase?.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'SIGNED_OUT') {
        setAccount(null)
        setSelectedId('')
        setDrawerOpen(false)
        setUploadOpen(false)
        setReportsOpen(false)
        setImagesOpen(false)
      }
      setSession(nextSession)
    })
    return () => listener?.data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!token) {
      setAccount(null)
      return
    }
    const controller = new AbortController()
    api<Account>('/me', { signal: controller.signal }, token).then((data) => {
      if (!controller.signal.aborted) setAccount(data)
    }).catch(() => {
      if (!controller.signal.aborted) setAccount(null)
    })
    return () => controller.abort()
  }, [token])

  useEffect(() => {
    if (session && pendingUpload.current) {
      pendingUpload.current = false
      setUploadOpen(true)
    }
  }, [session])

  useEffect(() => {
    const controller = new AbortController()
    setMapLoading(true)
    api<InventoryItem[]>('/items', { signal: controller.signal }).then((data) => {
      if (controller.signal.aborted) return
      setItems(data)
      setMapError('')
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setMapError(errorMessage(error))
    }).finally(() => {
      if (!controller.signal.aborted) setMapLoading(false)
    })
    return () => controller.abort()
  }, [revision])

  useEffect(() => {
    setItem(null)
    setDetailError('')
    if (!selectedId) return
    const controller = new AbortController()
    setDetailLoading(true)
    api<ItemDetail>(`/items/${selectedId}`, { signal: controller.signal }).then((data) => {
      if (controller.signal.aborted) return
      setItem(data)
      setDetailError('')
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setItem(null)
        setDetailError(errorMessage(error))
      }
    }).finally(() => {
      if (!controller.signal.aborted) setDetailLoading(false)
    })
    return () => controller.abort()
  }, [selectedId, revision])

  useEffect(() => {
    if (!technician || !token) {
      setOpenReports(0)
      return
    }
    const controller = new AbortController()
    api<Report[]>('/reports', { signal: controller.signal }, token).then((data) => {
      if (!controller.signal.aborted) setOpenReports(data.filter(({ status }) => status === 'open').length)
    }).catch(() => {
      if (!controller.signal.aborted) setOpenReports(0)
    })
    return () => controller.abort()
  }, [technician, token, revision])

  const visibleItems = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt')
    return items.filter((entry) => {
      if (!filters.has(entry.category)) return false
      if (!term) return true
      return `${entry.label} ${entry.class_name}`.toLocaleLowerCase('pt').includes(term)
    })
  }, [items, filters, search])

  const selectItem = useCallback((id: string) => {
    setSelectedId(id)
    setDrawerOpen(true)
  }, [])

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    setSelectedId('')
  }, [])

  const toggleCategory = useCallback((category: InventoryCategory) => {
    setFilters((current) => {
      const next = new Set(current)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }, [])

  const showAll = useCallback(() => {
    setFilters(new Set(CATEGORY_ORDER))
    setSearch('')
  }, [])

  const requestUpload = useCallback(() => {
    if (session) {
      setUploadOpen(true)
    } else {
      pendingUpload.current = true
      setAuthReason('Inicia sessão para carregar imagens e guardar as deteções no mapa.')
      setAuthOpen(true)
    }
  }, [session])

  const requestReport = useCallback((itemId: string) => {
    if (!session) {
      setAuthReason('Inicia sessão para comunicar um problema.')
      setAuthOpen(true)
      return
    }
    setReportItem(itemId)
    setReportsOpen(true)
  }, [session])

  const requestReports = useCallback(() => {
    if (!session) {
      setAuthReason('Inicia sessão para consultar ou comunicar problemas.')
      setAuthOpen(true)
      return
    }
    setReportItem('')
    setReportsOpen(true)
  }, [session])

  async function signOut() {
    try {
      const result = await supabase?.auth.signOut()
      if (result?.error) throw result.error
      notify('Sessão terminada.', 'info')
    } catch (error) {
      notify(errorMessage(error), 'error')
    }
  }

  async function exportInventory() {
    if (!technician || !token || csvBusy) return
    setCsvBusy(true)
    try {
      await downloadInventoryCsv(token)
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setCsvBusy(false)
    }
  }

  const emptyMap = !mapLoading && !mapError && visibleItems.length === 0

  return (
    <div className="app">
      <Header
        account={account}
        email={email}
        openReports={openReports}
        onOpenAuth={() => { setAuthReason(''); setAuthOpen(true) }}
        onSignOut={() => void signOut()}
        onOpenUpload={requestUpload}
        onOpenReports={requestReports}
        onOpenImages={() => setImagesOpen(true)}
        onExportInventory={() => void exportInventory()}
        csvBusy={csvBusy}
      />

      <main className="workspace">
        <MapView items={visibleItems} selectedId={selectedId} onSelect={selectItem} />

        <FilterPanel
          items={items}
          visibleCount={visibleItems.length}
          filters={filters}
          onToggleCategory={toggleCategory}
          search={search}
          onSearch={setSearch}
          onOpenUpload={requestUpload}
          onShowAll={showAll}
        />

        {mapLoading && (
          <div className="map-status" role="status">
            <span className="spinner" aria-hidden="true" /> A carregar o inventário…
          </div>
        )}

        {mapError && (
          <div className="map-status map-status--error" role="alert">
            <i className="bi bi-exclamation-triangle-fill" aria-hidden="true" />
            <span>{mapError}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={refresh}>Tentar novamente</button>
          </div>
        )}

        {emptyMap && (
          <div className="map-empty">
            <i className="bi bi-search" aria-hidden="true" />
            <h2>Sem elementos para mostrar</h2>
            <p>Nenhum elemento corresponde aos filtros ou à procura atual.</p>
            <button type="button" className="btn btn-primary btn-sm" onClick={showAll}>
              <i className="bi bi-arrow-counterclockwise" aria-hidden="true" /> Mostrar tudo
            </button>
          </div>
        )}

        <div className="map-hint">
          <i className="bi bi-mouse2" aria-hidden="true" />
          <span>Arrasta para explorar · clica num marcador para ver detalhes</span>
        </div>

        <ItemDrawer
          open={drawerOpen}
          item={item}
          loading={detailLoading}
          error={detailError}
          token={token}
          account={account}
          onClose={closeDrawer}
          onReport={requestReport}
          onChanged={refresh}
          notify={notify}
        />
      </main>

      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        token={token}
        onPublished={refresh}
        notify={notify}
      />

      <AuthDialog
        open={authOpen}
        onClose={() => { setAuthOpen(false); pendingUpload.current = false }}
        onDone={() => setAuthOpen(false)}
        reason={authReason || undefined}
      />

      <ReportsDialog
        open={reportsOpen}
        onClose={() => setReportsOpen(false)}
        token={token}
        technician={technician}
        items={items}
        initialItemId={reportItem}
        revision={revision}
        onChanged={refresh}
        onSelectItem={selectItem}
        notify={notify}
      />

      <ImagesDialog
        open={imagesOpen}
        onClose={() => setImagesOpen(false)}
        token={technician ? token : undefined}
        revision={revision}
        onChanged={refresh}
      />

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}

export function App() {
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  )
}

export default App
