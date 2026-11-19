import type { InventoryCategory } from './types.ts'

export interface CategoryMeta {
  id: InventoryCategory
  nome: string
  short: string
  icon: string
  color: string
}

export const CATEGORY_META: Record<InventoryCategory, CategoryMeta> = {
  sinalizacao: {
    id: 'sinalizacao',
    nome: 'Sinais de trânsito',
    short: 'Sinais',
    icon: 'bi-signpost-2-fill',
    color: 'var(--cat-sign)',
  },
  iluminacao: {
    id: 'iluminacao',
    nome: 'Iluminação pública',
    short: 'Iluminação',
    icon: 'bi-lightbulb-fill',
    color: 'var(--cat-light)',
  },
  residuos: {
    id: 'residuos',
    nome: 'Caixotes de lixo',
    short: 'Caixotes',
    icon: 'bi-trash3-fill',
    color: 'var(--cat-bin)',
  },
}

export const CATEGORY_ORDER: InventoryCategory[] = ['sinalizacao', 'iluminacao', 'residuos']

const CLASS_CATEGORY: Record<string, InventoryCategory> = {
  'sinal-transito': 'sinalizacao',
  stop: 'sinalizacao',
  cedencia: 'sinalizacao',
  'velocidade-30': 'sinalizacao',
  'velocidade-50': 'sinalizacao',
  'velocidade-20': 'sinalizacao',
  'velocidade-60': 'sinalizacao',
  'velocidade-70': 'sinalizacao',
  'velocidade-80': 'sinalizacao',
  'velocidade-100': 'sinalizacao',
  'velocidade-120': 'sinalizacao',
  passadeira: 'sinalizacao',
  'sentido-proibido': 'sinalizacao',
  estacionamento: 'sinalizacao',
  'estacionamento-proibido': 'sinalizacao',
  rotunda: 'sinalizacao',
  obras: 'sinalizacao',
  'poste-iluminacao': 'iluminacao',
  'contentor-lixo': 'residuos',
  subterraneo: 'residuos',
  'ilha-reciclagem': 'residuos',
  indiferenciado: 'residuos',
}

export function categoryForClass(className?: string): InventoryCategory | undefined {
  return className ? CLASS_CATEGORY[className] : undefined
}

export const CLASS_LABELS: Record<string, string> = {
  'sinal-transito': 'Sinal de trânsito',
  stop: 'Sinal de STOP',
  cedencia: 'Cedência de passagem',
  'velocidade-30': 'Limite de 30 km/h',
  'velocidade-50': 'Limite de 50 km/h',
  'velocidade-20': 'Limite de 20 km/h',
  'velocidade-60': 'Limite de 60 km/h',
  'velocidade-70': 'Limite de 70 km/h',
  'velocidade-80': 'Limite de 80 km/h',
  'velocidade-100': 'Limite de 100 km/h',
  'velocidade-120': 'Limite de 120 km/h',
  passadeira: 'Passagem para peões',
  'sentido-proibido': 'Sentido proibido',
  estacionamento: 'Estacionamento',
  'estacionamento-proibido': 'Estacionamento proibido',
  rotunda: 'Rotunda',
  obras: 'Trabalhos na via',
  'poste-iluminacao': 'Poste de iluminação',
  'contentor-lixo': 'Contentor de lixo',
  subterraneo: 'Contentor subterrâneo',
  'ilha-reciclagem': 'Ilha de reciclagem',
  indiferenciado: 'Contentor de indiferenciados',
}

export function classLabel(className: string): string {
  return CLASS_LABELS[className] ?? className.replaceAll('-', ' ')
}

export function compassPoint(heading: number): string {
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO']
  return points[Math.round((((heading % 360) + 360) % 360) / 45) % 8]
}

export function formatHeading(heading: number | null | undefined): string {
  if (heading === null || heading === undefined || Number.isNaN(heading)) return '—'
  return `${Math.round(heading)}° ${compassPoint(heading)}`
}

export function formatCoordinates(latitude: number, longitude: number): string {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
}
