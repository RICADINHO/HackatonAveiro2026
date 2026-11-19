import { useState, useEffect, useRef } from 'react'
import type { FilterOption } from '../types.ts'
import { CATEGORIAS } from '../constants.ts'

export function FiltersSection() {
  const [filtrosSelecionados, setFiltrosSelecionados] = useState<Map<string, string>>(new Map())
  const [openDropdown, setOpenDropdown] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Emite evento CustomEvent quando os filtros se alteram, como no script original
  useEffect(() => {
    document.dispatchEvent(
      new CustomEvent('filtros-alterados', {
        detail: Array.from(filtrosSelecionados.keys()),
      }),
    )
  }, [filtrosSelecionados])

  // Fecha dropdowns se clicar fora
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpenDropdown(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  const alternarFiltro = (opcao: FilterOption) => {
    setFiltrosSelecionados((prev) => {
      const proximo = new Map(prev)
      if (proximo.has(opcao.id)) {
        proximo.delete(opcao.id)
      } else {
        proximo.set(opcao.id, opcao.nome)
      }
      return proximo
    })
  }

  const removerFiltro = (id: string) => {
    setFiltrosSelecionados((prev) => {
      const proximo = new Map(prev)
      proximo.delete(id)
      return proximo
    })
  }

  return (
    <div id="filtros" className="container mb-4" ref={containerRef}>
      <div className="filtros-mapa">
        <div id="categorias-filtros" className="d-flex flex-wrap justify-content-center gap-2">
          {CATEGORIAS.map((categoria, indice) => {
            // Categoria sem dropdown: ex. iluminação pública
            if (!categoria.opcoes) {
              const id = categoria.id || 'sem-id'
              const selecionado = filtrosSelecionados.has(id)
              return (
                <button
                  key={id}
                  type="button"
                  className={`btn btn-outline-primary ${selecionado ? 'active' : ''}`}
                  aria-pressed={selecionado}
                  onClick={() => alternarFiltro({ id, nome: categoria.nome })}
                >
                  {categoria.nome}
                </button>
              )
            }

            const isOpen = openDropdown === indice
            return (
              <div key={categoria.nome} className="dropdown position-relative">
                <button
                  type="button"
                  id={`categoria-filtro-${indice}`}
                  className={`btn btn-outline-primary dropdown-toggle ${isOpen ? 'show' : ''}`}
                  data-bs-toggle="dropdown"
                  data-bs-auto-close="outside"
                  aria-expanded={isOpen}
                  onClick={() => setOpenDropdown(isOpen ? null : indice)}
                >
                  {categoria.nome}
                </button>

                <ul
                  className={`dropdown-menu ${isOpen ? 'show' : ''}`}
                  aria-labelledby={`categoria-filtro-${indice}`}
                >
                  {categoria.opcoes.map((opcao) => {
                    const selecionado = filtrosSelecionados.has(opcao.id)
                    return (
                      <li key={opcao.id}>
                        <button
                          type="button"
                          className={`dropdown-item ${selecionado ? 'active' : ''}`}
                          aria-pressed={selecionado}
                          onClick={() => alternarFiltro(opcao)}
                        >
                          {opcao.nome}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </div>

        <div
          id="filtros-selecionados"
          className="d-flex flex-wrap justify-content-center gap-2 mt-3"
          aria-live="polite"
        >
          {Array.from(filtrosSelecionados.entries()).map(([id, nome]) => (
            <button
              key={id}
              type="button"
              className="btn btn-primary btn-sm"
              aria-label={`Remover filtro: ${nome}`}
              onClick={() => removerFiltro(id)}
            >
              {nome} ×
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default FiltersSection
