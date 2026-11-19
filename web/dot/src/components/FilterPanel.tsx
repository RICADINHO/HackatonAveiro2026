import { useState } from 'react'
import { CATEGORY_META, CATEGORY_ORDER } from '../constants.ts'
import type { InventoryCategory, InventoryItem } from '../types.ts'

export function FilterPanel({ items, visibleCount, filters, onToggleCategory, search, onSearch, onOpenUpload, onShowAll }: {
  items: InventoryItem[]
  visibleCount: number
  filters: Set<InventoryCategory>
  onToggleCategory: (category: InventoryCategory) => void
  search: string
  onSearch: (value: string) => void
  onOpenUpload: () => void
  onShowAll: () => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const counts = Object.fromEntries(CATEGORY_ORDER.map((category) => [
    category,
    items.filter((item) => item.category === category).length,
  ])) as Record<InventoryCategory, number>

  return (
    <aside className={`filter-panel${collapsed ? ' is-collapsed' : ''}`} aria-label="Filtros do mapa">
      <div className="filter-panel__head">
        <div>
          <p className="eyebrow"><span className="live-dot" aria-hidden="true" /> Inventário em direto</p>
          <h1>Mobiliário urbano de Aveiro</h1>
          <p className="filter-panel__summary">
            {visibleCount === items.length
              ? `${items.length} ${items.length === 1 ? 'elemento no mapa' : 'elementos no mapa'}`
              : `${visibleCount} de ${items.length} elementos visíveis`}
          </p>
        </div>
        <button
          type="button"
          className="icon-btn filter-panel__collapse"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expandir filtros' : 'Recolher filtros'}
        >
          <i className={`bi ${collapsed ? 'bi-sliders' : 'bi-chevron-up'}`} aria-hidden="true" />
        </button>
      </div>

      {!collapsed && (
        <>
          <div className="search">
            <i className="bi bi-search" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              placeholder="Procurar um elemento…"
              aria-label="Procurar elemento no mapa"
            />
            {search && (
              <button type="button" className="search__clear" aria-label="Limpar procura" onClick={() => onSearch('')}>
                <i className="bi bi-x-circle-fill" aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="filter-chips" role="group" aria-label="Categorias">
            {CATEGORY_ORDER.map((category) => {
              const meta = CATEGORY_META[category]
              const active = filters.has(category)
              return (
                <button
                  key={category}
                  type="button"
                  className={`filter-chip filter-chip--${category}${active ? ' is-active' : ''}`}
                  aria-pressed={active}
                  onClick={() => onToggleCategory(category)}
                >
                  <span className="filter-chip__icon"><i className={`bi ${meta.icon}`} aria-hidden="true" /></span>
                  <span className="filter-chip__label">{meta.nome}</span>
                  <span className="filter-chip__count">{counts[category]}</span>
                </button>
              )
            })}
          </div>

          <div className="filter-panel__foot">
            {filters.size < CATEGORY_ORDER.length && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onShowAll}>
                <i className="bi bi-arrow-counterclockwise" aria-hidden="true" /> Mostrar tudo
              </button>
            )}
            <button type="button" className="btn btn-primary filter-panel__upload" onClick={onOpenUpload}>
              <i className="bi bi-cloud-arrow-up-fill" aria-hidden="true" />
              Carregar imagem
            </button>
          </div>

          <p className="filter-panel__hint">
            <i className="bi bi-info-circle" aria-hidden="true" />
            Clica num marcador para ver as imagens que o identificaram.
          </p>
        </>
      )}
    </aside>
  )
}

export default FilterPanel
