// Ported (Phase 1D / Task 5) from assets/js/ui/panels.js:1973-1984
// (LAYER_LABELS + layersMenuHTML) and :1998-2008 (wireLayersMenu's click
// delegate): DARK/LIGHT/SATELLITE/TERRAIN radio rows, active one
// check-marked. Legacy re-rendered this menu's innerHTML on every open so
// the checkmark tracked EC2.state.layer even if it changed elsewhere;
// reading `layer` straight off the store on every render is the React
// equivalent (no separate "on open" repaint needed).

import TopMenu from './TopMenu'
import { useAppStore } from '@/shared/store'
import type { MapLayer } from '@/shared/store'

const LAYER_LABELS: Record<MapLayer, string> = {
  dark: 'DARK',
  light: 'LIGHT',
  sat: 'SATELLITE',
  terrain: 'TERRAIN',
}

const LAYER_ORDER: MapLayer[] = ['dark', 'light', 'sat', 'terrain']

export default function LayersMenu() {
  const layer = useAppStore((s) => s.layer)
  const setLayer = useAppStore((s) => s.setLayer)
  const setOpenMenu = useAppStore((s) => s.setOpenMenu)

  return (
    <TopMenu name="layers" buttonId="btn-layers" extraClass="layers-menu" align="right">
      <div className="mm-head lbl">Map layers</div>
      {LAYER_ORDER.map((l) => (
        <button
          key={l}
          type="button"
          className="mm-item"
          role="menuitemradio"
          aria-checked={l === layer}
          data-l={l}
          onClick={() => {
            setLayer(l)
            setOpenMenu(null) // panels.js:2006: picking a layer dismisses the dropdown
          }}
        >
          <span className="mm-label">{LAYER_LABELS[l]}</span>
          <span className="mm-check">{l === layer ? '✓' : ''}</span>
        </button>
      ))}
    </TopMenu>
  )
}
