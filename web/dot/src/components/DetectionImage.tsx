import { useEffect, useRef, type CSSProperties } from 'react'
import { CATEGORY_META, categoryForClass, classLabel } from '../constants.ts'
import type { Detection } from '../types.ts'

function detectionColor(detection: Detection) {
  const category = categoryForClass(detection.predicted_class)
  return category ? CATEGORY_META[category].color : 'var(--accent)'
}

export function DetectionImage({ src, detections, alt = 'Imagem processada', compact = false }: {
  src: Blob | string
  detections: Detection[]
  alt?: string
  compact?: boolean
}) {
  const imageRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    const image = imageRef.current
    if (!image || typeof src === 'string') return
    const localUrl = URL.createObjectURL(src)
    image.src = localUrl
    return () => URL.revokeObjectURL(localUrl)
  }, [src])

  return (
    <div className={`detection-image${compact ? ' detection-image--compact' : ''}`}>
      <img ref={imageRef} src={typeof src === 'string' ? src : undefined} alt={alt} loading="lazy" />
      {detections.map((detection, index) => {
        const [x, y, width, height] = detection.bbox
        const label = detection.label ?? (detection.predicted_class ? classLabel(detection.predicted_class) : 'Deteção')
        return (
          <span
            key={`${index}-${x}-${y}`}
            className="detection-box"
            style={{
              left: `${x * 100}%`,
              top: `${y * 100}%`,
              width: `${width * 100}%`,
              height: `${height * 100}%`,
              '--box-color': detectionColor(detection),
            } as CSSProperties}
          >
            <span>{label} <b>{Math.round(detection.confidence * 100)}%</b></span>
          </span>
        )
      })}
    </div>
  )
}
