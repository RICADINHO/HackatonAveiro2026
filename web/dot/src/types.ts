export interface FilterOption {
  id: string
  nome: string
}

export interface Category {
  id: InventoryCategory
  nome: string
  opcoes?: FilterOption[]
}

export type InventoryCategory = 'sinalizacao' | 'iluminacao' | 'residuos'

export interface Coordinates {
  latitude: number
  longitude: number
}

export interface InventoryItem extends Coordinates {
  id: string
  category: InventoryCategory
  class_name: string
  label: string
  position_manually_corrected: boolean
}

export interface Detection {
  bbox: [number, number, number, number]
  confidence: number
  label?: string
  class_name?: string
  predicted_class?: string
  latitude?: number
  longitude?: number
}

export interface PublishedImage extends Coordinates {
  id: string
  heading: number
  url: string
  uploader_name: string | null
  submitted_at: string
  detections?: Detection[]
}

export interface ItemDetail extends InventoryItem {
  images: PublishedImage[]
}

export interface Preview {
  id: string
  camera: Record<'latitude' | 'longitude' | 'heading', number | null>
  detections: Detection[]
}

export interface CameraPoint {
  latitude: number | null
  longitude: number | null
  heading: number | null
}

export type AccountRole = 'technician' | 'authenticated'

export interface Account {
  id: string
  public_name: string | null
  role: AccountRole
}

export interface Report {
  id: string
  description: string
  item_id: string | null
  item_label: string | null
  status: 'open' | 'resolved'
  author_id: string
  submitted_at: string
  resolved_at: string | null
  resolved_by: string | null
}
