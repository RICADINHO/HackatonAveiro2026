import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import L from 'leaflet'
import { useTheme } from '../theme.tsx'
import { compassPoint, formatHeading } from '../constants.ts'
import { MAP_ATTRIBUTION, MAP_TILES } from '../mapTiles.ts'
import type { CameraPoint } from '../types.ts'

const AVEIRO: L.LatLngExpression = [40.6405, -8.6538]
const HANDLE_PX = 92
const WEDGE_PX = 74
const FOV = 65

function normalizeHeading(value: number): number {
  return ((value % 360) + 360) % 360
}

function bearingBetween(from: L.LatLng, to: L.LatLng): number {
  const lat1 = (from.lat * Math.PI) / 180
  const lat2 = (to.lat * Math.PI) / 180
  const dLng = ((to.lng - from.lng) * Math.PI) / 180
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return normalizeHeading((Math.atan2(y, x) * 180) / Math.PI)
}

function pixelOffset(map: L.Map, center: L.LatLng, heading: number, distance: number): L.LatLng {
  const radians = (heading * Math.PI) / 180
  const point = map.project(center, map.getZoom()).add([Math.sin(radians) * distance, -Math.cos(radians) * distance])
  return map.unproject(point, map.getZoom())
}

function cameraIcon() {
  return L.divIcon({
    className: 'picker-marker picker-marker--camera',
    html: '<span class="picker-camera"><i class="bi bi-camera-fill"></i></span>',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  })
}

function handleIcon(heading: number, disabled = false) {
  return L.divIcon({
    className: `picker-marker picker-marker--handle${disabled ? ' is-disabled' : ''}`,
    html: `<span class="picker-handle" style="--heading:${heading}deg"><i class="bi bi-caret-up-fill"></i></span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  })
}

export function LocationPicker({ value, onChange, height = 250, showHeading = true, className = '' }: {
  value: CameraPoint
  onChange: (next: CameraPoint) => void
  height?: number
  showHeading?: boolean
  className?: string
}) {
  const { theme } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const tileRef = useRef<L.TileLayer | null>(null)
  const cameraRef = useRef<L.Marker | null>(null)
  const handleRef = useRef<L.Marker | null>(null)
  const wedgeRef = useRef<L.Polygon | null>(null)
  const lineRef = useRef<L.Polyline | null>(null)
  const draggingRef = useRef(false)
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  const [geoBusy, setGeoBusy] = useState(false)
  const [geoError, setGeoError] = useState('')

  valueRef.current = value
  onChangeRef.current = onChange

  const render = useCallback(() => {
    const map = mapRef.current
    const camera = cameraRef.current
    const handle = handleRef.current
    const wedge = wedgeRef.current
    const line = lineRef.current
    if (!map || !camera || !handle || !wedge || !line) return

    const { latitude, longitude, heading } = valueRef.current
    const hasPoint = latitude !== null && longitude !== null

    camera.setOpacity(hasPoint ? 1 : 0)
    const headingActive = hasPoint && showHeading
    handle.setOpacity(headingActive ? 1 : 0)
    if (headingActive) handle.dragging?.enable()
    else handle.dragging?.disable()
    handle.setIcon(handleIcon(heading ?? 0, !headingActive))

    if (!hasPoint) {
      wedge.setLatLngs([])
      line.setLatLngs([])
      return
    }

    const center = L.latLng(latitude, longitude)
    camera.setLatLng(center)

    if (!showHeading) {
      wedge.setLatLngs([])
      line.setLatLngs([])
      return
    }

    const direction = heading ?? 0
    const handleLatLng = pixelOffset(map, center, direction, HANDLE_PX)
    if (!draggingRef.current) handle.setLatLng(handleLatLng)

    const arc: L.LatLng[] = []
    for (let step = 0; step <= 8; step += 1) {
      arc.push(pixelOffset(map, center, direction - FOV / 2 + (FOV * step) / 8, WEDGE_PX))
    }
    wedge.setLatLngs([center, ...arc])
    line.setLatLngs([center, handle.getLatLng()])
  }, [showHeading])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const hasPoint = valueRef.current.latitude !== null && valueRef.current.longitude !== null
    const center = hasPoint
      ? L.latLng(valueRef.current.latitude!, valueRef.current.longitude!)
      : L.latLng(AVEIRO)
    const map = L.map(container, {
      center,
      zoom: hasPoint ? 16 : 14,
      zoomControl: true,
      attributionControl: true,
    })
    mapRef.current = map

    const tiles = L.tileLayer(MAP_TILES[theme], {
      maxZoom: 20,
      attribution: MAP_ATTRIBUTION,
    }).addTo(map)
    tileRef.current = tiles

    const wedge = L.polygon([], {
      color: 'var(--accent)',
      weight: 1.5,
      opacity: 0.8,
      fillColor: 'var(--accent)',
      fillOpacity: 0.14,
      interactive: false,
    }).addTo(map)
    wedgeRef.current = wedge

    const line = L.polyline([], {
      color: 'var(--accent)',
      weight: 2,
      opacity: 0.7,
      dashArray: '5 6',
      interactive: false,
    }).addTo(map)
    lineRef.current = line

    const camera = L.marker(center, { icon: cameraIcon(), keyboard: false, interactive: false }).addTo(map)
    cameraRef.current = camera

    const handle = L.marker(center, { icon: handleIcon(0), draggable: true, autoPan: true, keyboard: false }).addTo(map)
    handleRef.current = handle

    handle.on('dragstart', () => { draggingRef.current = true })
    handle.on('drag', () => {
      const current = valueRef.current
      if (current.latitude === null || current.longitude === null) return
      const heading = bearingBetween(L.latLng(current.latitude, current.longitude), handle.getLatLng())
      onChangeRef.current({ ...current, heading: Math.round(heading * 10) / 10 })
    })
    handle.on('dragend', () => {
      draggingRef.current = false
      render()
    })

    map.on('click', (event: L.LeafletMouseEvent) => {
      const current = valueRef.current
      onChangeRef.current({
        ...current,
        latitude: Number(event.latlng.lat.toFixed(6)),
        longitude: Number(event.latlng.lng.toFixed(6)),
        heading: current.heading ?? 0,
      })
    })
    map.on('zoomend', render)

    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(container)
    const timer = window.setTimeout(() => map.invalidateSize(), 180)

    render()

    return () => {
      window.clearTimeout(timer)
      observer.disconnect()
      map.remove()
      mapRef.current = null
      tileRef.current = null
      cameraRef.current = null
      handleRef.current = null
      wedgeRef.current = null
      lineRef.current = null
    }
    // The map is created once; theme changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    tileRef.current?.setUrl(MAP_TILES[theme])
  }, [theme])

  useEffect(() => {
    render()
  }, [value.latitude, value.longitude, value.heading, render])

  const setHeading = (next: number) => {
    const normalized = normalizeHeading(Number.isFinite(next) ? next : 0)
    onChange({ ...value, heading: Math.round(normalized * 10) / 10 })
  }

  const centerOnPoint = () => {
    const map = mapRef.current
    if (!map) return
    const { latitude, longitude } = valueRef.current
    if (latitude !== null && longitude !== null) {
      map.flyTo([latitude, longitude], Math.max(map.getZoom(), 16), { duration: 0.5 })
    }
  }

  const useGeolocation = () => {
    if (!navigator.geolocation) {
      setGeoError('Este navegador não expõe a localização.')
      return
    }
    setGeoBusy(true)
    setGeoError('')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onChange({
          latitude: Number(position.coords.latitude.toFixed(6)),
          longitude: Number(position.coords.longitude.toFixed(6)),
          heading: position.coords.heading !== null && Number.isFinite(position.coords.heading)
            ? Math.round(position.coords.heading)
            : (valueRef.current.heading ?? 0),
        })
        setGeoBusy(false)
        const map = mapRef.current
        if (map) map.flyTo([position.coords.latitude, position.coords.longitude], 17, { duration: 0.6 })
      },
      () => {
        setGeoBusy(false)
        setGeoError('Não foi possível obter a localização.')
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const hasPoint = value.latitude !== null && value.longitude !== null
  const direction = value.heading ?? 0

  return (
    <div className={`location-picker ${className}`}>
      <div className="location-picker__map" ref={containerRef} style={{ height }} />
      {!hasPoint && (
        <div className="location-picker__empty">
          <i className="bi bi-geo-alt-fill" aria-hidden="true" />
          <span>Clica no mapa para marcar a posição</span>
        </div>
      )}
      {showHeading && hasPoint && (
        <div className="location-picker__compass" aria-hidden="true">
          <span className="compass" style={{ '--heading': `${direction}deg` } as CSSProperties}>
            <i className="bi bi-caret-up-fill" />
          </span>
          <small>{compassPoint(direction)}</small>
        </div>
      )}
      <div className="location-picker__toolbar">
        <div className="location-picker__coords">
          {hasPoint
            ? <><i className="bi bi-geo-alt-fill" aria-hidden="true" />{value.latitude!.toFixed(5)}, {value.longitude!.toFixed(5)}</>
            : <><i className="bi bi-geo-alt" aria-hidden="true" />Sem posição</>}
        </div>
        <div className="location-picker__buttons">
          <button type="button" className="btn btn-ghost btn-sm" onClick={useGeolocation} disabled={geoBusy}>
            <i className="bi bi-crosshair" aria-hidden="true" /> {geoBusy ? 'A localizar…' : 'GPS'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={centerOnPoint} disabled={!hasPoint}>
            <i className="bi bi-arrows-fullscreen" aria-hidden="true" /> Centrar
          </button>
        </div>
      </div>
      {geoError && <p className="field-hint field-hint--error">{geoError}</p>}
      {showHeading && (
        <div className="location-picker__heading">
          <div className="location-picker__heading-label">
            <span>Direção da câmara</span>
            <strong className={value.heading === null ? 'is-missing' : ''}>{formatHeading(value.heading)}</strong>
          </div>
          <div className="location-picker__heading-controls">
            <input
              type="range"
              min={0}
              max={359}
              step={1}
              value={Math.round(direction)}
              onChange={(event) => setHeading(Number(event.target.value))}
              aria-label="Direção da câmara"
              disabled={!hasPoint}
            />
            <input
              type="number"
              className="input input--tiny"
              min={0}
              max={359.9}
              step={0.1}
              value={value.heading === null ? '' : Math.round(direction * 10) / 10}
              onChange={(event) => setHeading(Number(event.target.value))}
              aria-label="Direção em graus"
              disabled={!hasPoint}
            />
            <span className="unit">°</span>
          </div>
        </div>
      )}
    </div>
  )
}
