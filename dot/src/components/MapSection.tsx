import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export function MapSection() {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<L.Map | null>(null)

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

    // Invalida o tamanho após a renderização inicial para evitar problemas com mosaicos
    const timer = setTimeout(() => {
      mapa.invalidateSize()
    }, 200)

    return () => {
      clearTimeout(timer)
      mapa.remove()
      mapInstanceRef.current = null
    }
  }, [])

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
      </div>
    </section>
  )
}

export default MapSection

