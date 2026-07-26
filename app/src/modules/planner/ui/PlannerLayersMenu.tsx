// The planner's LAYERS basemap picker (spec section 4). Labels and order are
// imported from the console's map/basemap.ts, not copied -- one product, one
// set of basemap names -- but this reuses the topbar's own pl-dropdown /
// pl-menu / pl-menu-item pattern (the same one DRAW uses) rather than
// importing the console's TopMenu, which is bound to the console store's
// `openMenu` slice and to #topbar ids that do not exist here.
//
// Reads `layer`/`setLayer` straight off useAppStore rather than taking them as
// props: the basemap is an app-level display preference already modelled
// there, so a user's pick carries between /console and /planner, which is the
// behaviour a single product should have. Open/closed state IS a prop, because
// PlannerTopbar owns "only one dropdown open at a time".
import { useAppStore } from '@/shared/store'
import { LAYER_LABELS, LAYER_ORDER, layerButtonLabel } from '@/modules/console/map/basemap'

export interface PlannerLayersMenuProps {
  open: boolean
  onToggle: () => void
  onClose: () => void
}

export default function PlannerLayersMenu({ open, onToggle, onClose }: PlannerLayersMenuProps) {
  const layer = useAppStore((s) => s.layer)
  const setLayer = useAppStore((s) => s.setLayer)

  return (
    <>
      <button
        type="button"
        className="pl-btn"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={onToggle}
      >
        {layerButtonLabel(layer)} ▾
      </button>
      {open ? (
        <div className="pl-menu" role="menu">
          {LAYER_ORDER.map((l) => (
            <button
              key={l}
              type="button"
              className="pl-menu-item pl-menu-radio"
              role="menuitemradio"
              aria-checked={l === layer}
              onClick={() => {
                setLayer(l)
                onClose()
              }}
            >
              <span>{LAYER_LABELS[l]}</span>
              <span className="pl-menu-check">{l === layer ? '✓' : ''}</span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  )
}
