import type { Category } from './types.ts'

export const CATEGORIAS: Category[] = [
  {
    id: 'sinalizacao',
    nome: 'Sinais de trânsito',
    opcoes: [
      { id: 'stop', nome: 'Stop' },
      { id: 'cedencia', nome: 'Cedência de passagem' },
      { id: 'velocidade-30', nome: 'Limite de 30 km/h' },
      { id: 'velocidade-50', nome: 'Limite de 50 km/h' },
      { id: 'passadeira', nome: 'Passagem para peões' },
    ],
  },
  {
    id: 'residuos',
    nome: 'Ecopontos e contentores',
    opcoes: [
      { id: 'subterraneo', nome: 'Contentor subterrâneo' },
      { id: 'ilha-reciclagem', nome: 'Ilha de reciclagem' },
      { id: 'indiferenciado', nome: 'Contentor de indiferenciados' },
    ],
  },
  {
    id: 'iluminacao',
    nome: 'Iluminação pública',
  },
]

