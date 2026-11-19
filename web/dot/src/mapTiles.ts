import { config } from '../../src/config.ts'

const CARTO_LIGHT = 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'
const CARTO_DARK = 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
const OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

function withKey(url: string): string {
  if (!config.cartoApiKey) return url
  return `${url}?key=${encodeURIComponent(config.cartoApiKey)}`
}

/**
 * CARTO now requires an API key for its basemaps. The key is public by design
 * (it ships in the browser bundle and only grants tile reads). If it is missing
 * we fall back to the keyless OpenStreetMap tiles so the map still works.
 */
export const MAP_TILES = {
  light: config.cartoApiKey ? withKey(CARTO_LIGHT) : OSM,
  dark: config.cartoApiKey ? withKey(CARTO_DARK) : OSM,
}

export const MAP_ATTRIBUTION = config.cartoApiKey
  ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
  : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
