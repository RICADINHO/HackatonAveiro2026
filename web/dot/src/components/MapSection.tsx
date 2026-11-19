import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { InventoryItem } from '../types.ts'

const MARKER_COLORS = { sinalizacao: '#ca463f', iluminacao: '#9a6312', residuos: '#117854' }

export function MapSection({ items, loading, error, onSelect }: {
  items: InventoryItem[]
  loading: boolean
  error: string
  onSelect: (id: string) => void
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<L.Map | null>(null)
  const markersRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!mapContainerRef.current) return
    if (mapInstanceRef.current) return

    // Inicializa o mapa com centro em Aveiro
    const mapa = L.map(mapContainerRef.current).setView([40.6405, -8.6538], 12)

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(mapa)

    mapInstanceRef.current = mapa
    markersRef.current = L.layerGroup().addTo(mapa)

    // Invalida o tamanho após a renderização inicial para evitar problemas com mosaicos
    const timer = setTimeout(() => {
      mapa.invalidateSize()
    }, 200)

    return () => {
      clearTimeout(timer)
      mapa.remove()
      mapInstanceRef.current = null
      markersRef.current = null
    }
  }, [])

  useEffect(() => {
    const markers = markersRef.current
    if (!markers) return
    markers.clearLayers()
    for (const item of items) {
      const color = MARKER_COLORS[item.category]
      const marker = L.marker([item.latitude, item.longitude], {
        title: item.label,
        alt: item.label,
        icon: L.divIcon({ className: 'inventory-marker', iconSize: [20, 20], html: `<span style="background:${color}"></span>` }),
      })
      const label = document.createElement('span')
      label.textContent = item.label
      marker.bindTooltip(label).on('click', () => onSelect(item.id)).addTo(markers)
    }
  }, [items, onSelect])

  return (
    <section id="mapa" className="section">
      <div className="container">
        <div className="section-title">
          <h2>Mobiliário urbano</h2>
          <p>Consulta os elementos identificados no mapa de Aveiro.</p>
        </div>

        <div
          id="mapa-aveiro"
          ref={mapContainerRef}
          style={{
            height: '70vh',
            minHeight: '400px',
            width: '100%',
            borderRadius: '16px',
            overflow: 'hidden',
          }}
        />
        {error ? <p role="alert" className="alert alert-danger mt-3">{error}</p> : (
          <p className="mt-3" role="status">{loading ? 'A carregar mapa…' : `${items.length} ${items.length === 1 ? 'elemento' : 'elementos'} no mapa`}</p>
        )}
      </div>
    </section>
  )
}

export default MapSection

