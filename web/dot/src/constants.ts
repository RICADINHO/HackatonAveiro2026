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

const SIGN_LABELS: Record<string, string> = {
  'sinal-transito': 'Sinal de trânsito',
  stop: 'Sinal de STOP',
  cedencia: 'Cedência de passagem',
  passadeira: 'Passagem para peões',
  'sentido-proibido': 'Sentido proibido',
  estacionamento: 'Estacionamento',
  'estacionamento-proibido': 'Estacionamento proibido',
  rotunda: 'Rotunda',
  obras: 'Trabalhos na via',
  'sentido-obrigatorio': 'Sentido obrigatório',
  'virar-esquerda': 'Virar à esquerda',
  'virar-direita': 'Virar à direita',
  'seguir-esquerda': 'Em frente ou à esquerda',
  'seguir-direita': 'Em frente ou à direita',
  'manter-esquerda': 'Manter à esquerda',
  'manter-direita': 'Manter à direita',
  'proibido-ultrapassar': 'Proibido ultrapassar',
  'proibido-ultrapassar-pesados': 'Proibido ultrapassar a pesados',
  'proibido-pesados': 'Proibido a veículos pesados',
  'proibido-veiculos': 'Proibido a veículos motorizados',
  'proibido-autocarros': 'Proibido a autocarros',
  'proibido-bicicletas': 'Proibido a bicicletas',
  'proibido-peoes': 'Proibido a peões',
  'proibido-inverter': 'Proibida a inversão de marcha',
  'proibido-virar-esquerda': 'Proibido virar à esquerda',
  'proibido-virar-direita': 'Proibido virar à direita',
  'pista-ciclista': 'Pista para bicicletas',
  'zona-peoes': 'Zona de peões',
  'via-partilhada': 'Via partilhada com bicicletas',
  'limite-altura': 'Limite de altura',
  'limite-peso': 'Limite de peso',
  'limite-peso-eixo': 'Limite de peso por eixo',
  'limite-velocidade': 'Limite de velocidade',
  'fim-restricoes': 'Fim de todas as restrições',
  'fim-proibicao-ultrapassar': 'Fim da proibição de ultrapassar',
  'fim-proibicao-ultrapassar-pesados': 'Fim da proibição de ultrapassar a pesados',
  'fim-velocidade-80': 'Fim do limite de 80 km/h',
  semaforos: 'Sinalização luminosa',
  criancas: 'Passagem de crianças',
  'passagem-ciclistas': 'Passagem de ciclistas',
  'piso-escorregadio': 'Piso escorregadio',
  estreitamento: 'Estreitamento da via',
  'estreitamento-direita': 'Estreitamento à direita',
  'estreitamento-esquerda': 'Estreitamento à esquerda',
  prioridade: 'Estrada com prioridade',
  cruzamento: 'Cruzamento',
  perigo: 'Outro perigo',
  'animais-selvagens': 'Animais selvagens',
  animais: 'Animais domésticos',
  pedras: 'Pedras na via',
  lomba: 'Lomba',
  depressao: 'Depressão na via',
  'piso-irregular': 'Piso irregular',
  gelo: 'Gelo ou neve',
  inclinacao: 'Inclinação da via',
  'curva-esquerda': 'Curva perigosa à esquerda',
  'curva-direita': 'Curva perigosa à direita',
  'curva-dupla': 'Curva dupla',
  convergencia: 'Convergência de trânsito',
  'passagem-nivel': 'Passagem de nível',
  hospital: 'Hospital',
  'posto-combustivel': 'Posto de combustível',
  autoestrada: 'Autoestrada',
  'paragem-transporte': 'Paragem de transporte',
  'mobilidade-reduzida': 'Mobilidade reduzida',
  'velocidade-20': 'Limite de 20 km/h',
  'velocidade-30': 'Limite de 30 km/h',
  'velocidade-50': 'Limite de 50 km/h',
  'velocidade-60': 'Limite de 60 km/h',
  'velocidade-70': 'Limite de 70 km/h',
  'velocidade-80': 'Limite de 80 km/h',
  'velocidade-100': 'Limite de 100 km/h',
  'velocidade-120': 'Limite de 120 km/h',
}

const WASTE_LABELS: Record<string, string> = {
  'contentor-lixo': 'Contentor de lixo',
  'ilha-reciclagem': 'Ilha de reciclagem',
  indiferenciado: 'Contentor de indiferenciados',
  subterraneo: 'Contentor subterrâneo',
}

export const CLASS_LABELS: Record<string, string> = {
  ...SIGN_LABELS,
  ...WASTE_LABELS,
  'poste-iluminacao': 'Poste de iluminação',
}

const CLASS_CATEGORY = {
  ...Object.fromEntries(Object.keys(SIGN_LABELS).map((name) => [name, 'sinalizacao'] as const)),
  ...Object.fromEntries(Object.keys(WASTE_LABELS).map((name) => [name, 'residuos'] as const)),
  'poste-iluminacao': 'iluminacao',
} as Record<string, InventoryCategory>

export function categoryForClass(className?: string): InventoryCategory | undefined {
  return className ? CLASS_CATEGORY[className] : undefined
}

const CLASS_ICONS: Record<string, string> = {
  'sinal-transito': 'bi-signpost-2-fill',
  stop: 'bi-sign-stop-fill',
  cedencia: 'bi-sign-yield-fill',
  passadeira: 'bi-person-walking',
  'sentido-proibido': 'bi-sign-do-not-enter-fill',
  estacionamento: 'bi-p-square-fill',
  'estacionamento-proibido': 'bi-sign-no-parking-fill',
  rotunda: 'bi-arrow-repeat',
  obras: 'bi-cone-striped',
  'sentido-obrigatorio': 'bi-arrow-up-circle-fill',
  'virar-esquerda': 'bi-sign-turn-left-fill',
  'virar-direita': 'bi-sign-turn-right-fill',
  'seguir-esquerda': 'bi-sign-turn-slight-left-fill',
  'seguir-direita': 'bi-sign-turn-slight-right-fill',
  'manter-esquerda': 'bi-sign-merge-left-fill',
  'manter-direita': 'bi-sign-merge-right-fill',
  'proibido-ultrapassar': 'bi-arrow-left-right',
  'proibido-ultrapassar-pesados': 'bi-truck',
  'proibido-pesados': 'bi-truck',
  'proibido-veiculos': 'bi-car-front-fill',
  'proibido-autocarros': 'bi-bus-front-fill',
  'proibido-bicicletas': 'bi-bicycle',
  'proibido-peoes': 'bi-person-walking',
  'proibido-inverter': 'bi-arrow-counterclockwise',
  'proibido-virar-esquerda': 'bi-sign-no-left-turn-fill',
  'proibido-virar-direita': 'bi-sign-no-right-turn-fill',
  'pista-ciclista': 'bi-bicycle',
  'passagem-ciclistas': 'bi-bicycle',
  'zona-peoes': 'bi-people-fill',
  'via-partilhada': 'bi-people-fill',
  'limite-altura': 'bi-arrows-collapse-vertical',
  'limite-peso': 'bi-box-seam-fill',
  'limite-peso-eixo': 'bi-box-seam-fill',
  'fim-restricoes': 'bi-check-circle-fill',
  'fim-proibicao-ultrapassar': 'bi-check-circle-fill',
  'fim-proibicao-ultrapassar-pesados': 'bi-check-circle-fill',
  semaforos: 'bi-stoplights-fill',
  criancas: 'bi-people-fill',
  'piso-escorregadio': 'bi-droplet-fill',
  estreitamento: 'bi-arrows-collapse',
  'estreitamento-direita': 'bi-arrows-collapse',
  'estreitamento-esquerda': 'bi-arrows-collapse',
  prioridade: 'bi-signpost-fill',
  cruzamento: 'bi-sign-intersection-fill',
  perigo: 'bi-exclamation-triangle-fill',
  'animais-selvagens': 'bi-exclamation-triangle-fill',
  animais: 'bi-exclamation-triangle-fill',
  pedras: 'bi-exclamation-diamond-fill',
  lomba: 'bi-activity',
  depressao: 'bi-activity',
  'piso-irregular': 'bi-activity',
  gelo: 'bi-snow',
  inclinacao: 'bi-arrow-up-right',
  'curva-esquerda': 'bi-sign-turn-left-fill',
  'curva-direita': 'bi-sign-turn-right-fill',
  'curva-dupla': 'bi-sign-turn-slight-left-fill',
  convergencia: 'bi-sign-merge-left-fill',
  'passagem-nivel': 'bi-sign-railroad-fill',
  hospital: 'bi-hospital-fill',
  'posto-combustivel': 'bi-fuel-pump-fill',
  autoestrada: 'bi-signpost-fill',
  'paragem-transporte': 'bi-bus-front-fill',
  'mobilidade-reduzida': 'bi-person-walking',
  'poste-iluminacao': 'bi-lightbulb-fill',
  'contentor-lixo': 'bi-trash3-fill',
  'ilha-reciclagem': 'bi-recycle',
  indiferenciado: 'bi-trash-fill',
  subterraneo: 'bi-arrow-down-circle-fill',
}

export function classIcon(className: string, category: InventoryCategory): string {
  if (className.startsWith('velocidade-') || className.startsWith('limite-velocidade')
    || className.startsWith('fim-velocidade')) {
    return 'bi-speedometer2'
  }
  return CLASS_ICONS[className] ?? CATEGORY_META[category].icon
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
