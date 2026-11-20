import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useTheme } from '../theme.tsx'
import { classIcon } from '../constants.ts'
import { MAP_ATTRIBUTION, MAP_TILES } from '../mapTiles.ts'
import type { InventoryItem } from '../types.ts'

const AVEIRO: [number, number] = [40.6405, -8.6538]

function itemIcon(item: InventoryItem, selected: boolean) {
  return L.divIcon({
    className: `map-pin map-pin--${item.category}${selected ? ' is-selected' : ''}`,
    html: `<span class="map-pin__dot"><i class="bi ${classIcon(item.class_name, item.category)}" aria-hidden="true"></i></span>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    tooltipAnchor: [0, -18],
  })
}

export function MapView({ items, selectedId, onSelect }: {
  items: InventoryItem[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  const { theme } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const tileRef = useRef<L.TileLayer | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const didFit = useRef(false)
  const onSelectRef = useRef(onSelect)

  onSelectRef.current = onSelect

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const map = L.map(container, {
      center: AVEIRO,
      zoom: 13,
      zoomControl: false,
      attributionControl: true,
      minZoom: 3,
      maxZoom: 20,
    })
    mapRef.current = map

    L.control.zoom({ position: 'bottomright' }).addTo(map)

    const tiles = L.tileLayer(MAP_TILES[theme], {
      maxZoom: 20,
      attribution: MAP_ATTRIBUTION,
    }).addTo(map)
    tileRef.current = tiles

    layerRef.current = L.layerGroup().addTo(map)

    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(container)
    const timer = window.setTimeout(() => map.invalidateSize(), 200)

    return () => {
      window.clearTimeout(timer)
      observer.disconnect()
      map.remove()
      mapRef.current = null
      tileRef.current = null
      layerRef.current = null
    }
    // The map instance is intentionally created once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    tileRef.current?.setUrl(MAP_TILES[theme])
  }, [theme])

  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    layer.clearLayers()

    for (const item of items) {
      const marker = L.marker([item.latitude, item.longitude], {
        icon: itemIcon(item, item.id === selectedId),
        title: item.label,
        alt: item.label,
        riseOnHover: true,
        keyboard: true,
      })
      const tooltip = document.createElement('span')
      tooltip.textContent = item.label
      marker.bindTooltip(tooltip, { direction: 'top', offset: [0, -16], opacity: 0.95 })
      marker.on('click', () => onSelectRef.current(item.id))
      marker.addTo(layer)
    }
  }, [items, selectedId])

  useEffect(() => {
    if (didFit.current || items.length === 0) return
    const map = mapRef.current
    if (!map) return
    const bounds = L.latLngBounds(items.map((item) => [item.latitude, item.longitude]))
    map.fitBounds(bounds, { padding: [90, 90], maxZoom: 16 })
    didFit.current = true
  }, [items])

  useEffect(() => {
    if (!selectedId) return
    const map = mapRef.current
    const item = items.find(({ id }) => id === selectedId)
    if (!map || !item) return
    map.flyTo([item.latitude, item.longitude], Math.max(map.getZoom(), 16), { duration: 0.6 })
  }, [selectedId, items])

  return <div className="map-canvas" ref={containerRef} aria-label="Mapa do mobiliário urbano de Aveiro" />
}

export default MapView
