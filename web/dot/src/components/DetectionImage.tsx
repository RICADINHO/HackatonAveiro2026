import { useEffect, useRef } from 'react'
import type { Detection } from '../types.ts'

export function DetectionImage({ src, detections }: { src: Blob | string; detections: Detection[] }) {
  const imageRef = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const image = imageRef.current
    if (!image || typeof src === 'string') return
    const localUrl = URL.createObjectURL(src)
    image.src = localUrl
    return () => URL.revokeObjectURL(localUrl)
  }, [src])

  return (
    <div className="detection-image">
      <img ref={imageRef} src={typeof src === 'string' ? src : undefined} alt="Imagem processada" />
      {detections.map(({ bbox: [x, y, width, height], label, predicted_class, confidence }, index) => (
        <span className="detection-box" key={index} style={{
          left: `${x * 100}%`, top: `${y * 100}%`, width: `${width * 100}%`, height: `${height * 100}%`,
        }}>
          <span>{label ?? predicted_class} {Math.round(confidence * 100)}%</span>
        </span>
      ))}
    </div>
  )
}
