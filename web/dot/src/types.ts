export interface FilterOption {
  id: string
  nome: string
}

export interface Category {
  id?: string
  nome: string
  opcoes?: FilterOption[]
}

