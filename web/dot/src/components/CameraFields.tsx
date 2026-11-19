import type { Preview } from '../types.ts'

const FIELDS = [
  { key: 'latitude', label: 'Latitude', min: -90, max: 90 },
  { key: 'longitude', label: 'Longitude', min: -180, max: 180 },
  { key: 'heading', label: 'Direção (° a partir do norte verdadeiro)', min: 0, max: 359.999999 },
] as const

export function CameraFields({ camera, missingOnly = false, coordinatesOnly = false }: {
  camera: Preview['camera']
  missingOnly?: boolean
  coordinatesOnly?: boolean
}) {
  return (
    <div className="row g-2">
      {FIELDS.filter(({ key }) => (!coordinatesOnly || key !== 'heading') && (!missingOnly || camera[key] === null))
        .map(({ key, label, min, max }) => (
          <label className="col-sm" key={key}>{label}
            <input className="form-control" type="number" name={key} step="any" min={min} max={max}
              defaultValue={camera[key] ?? ''} required />
          </label>
        ))}
    </div>
  )
}

