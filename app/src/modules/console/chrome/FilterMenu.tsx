// Ported (Phase 1D / Task 5) from assets/js/ui/panels.js:1955-1963
// (wireFilterMenu's markup) and :2534-2548 (wireFilters' click handler):
// single-choice chip picker, active chip carries `.on`, and picking one
// updates the trigger label (Topbar.tsx's job, out of this task's scope)
// and dismisses the menu.

import TopMenu from './TopMenu'
import { useAppStore } from '@/shared/store'
import { FILTER_KEYS } from './emirates'

export default function FilterMenu() {
  const dockFilter = useAppStore((s) => s.dockFilter)
  const setDockFilter = useAppStore((s) => s.setDockFilter)
  const setOpenMenu = useAppStore((s) => s.setOpenMenu)

  return (
    <TopMenu name="filter" buttonId="btn-filter" extraClass="filter-menu" align="right">
      <div className="mm-head lbl">Dock filter</div>
      <div className="filters filters-compact" id="filters">
        {FILTER_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            className={'fchip' + (k === dockFilter ? ' on' : '')}
            data-filter={k}
            onClick={() => {
              setDockFilter(k)
              setOpenMenu(null) // panels.js:2546: picking a filter dismisses the dropdown
            }}
          >
            {k}
          </button>
        ))}
      </div>
    </TopMenu>
  )
}
