// Telemetry's LAYERS basemap picker (spec section 8.1): the console and the
// planner both place this control in the same topbar slot so it lives in one
// place in the user's memory across all three modules. Copied, not imported,
// from planner/ui/PlannerLayersMenu.tsx -- its DATA dependency is already
// module-agnostic (layer/setLayer come straight off the shared useAppStore,
// so a pick made here carries to /console and /planner too), but it renders
// pl-btn/pl-menu/pl-menu-item/pl-menu-radio/pl-menu-check classes that only
// planner.css defines. This copy uses tm-* classes so it renders styled here.
// LAYER_ORDER/LAYER_LABELS/layerButtonLabel are still imported, never
// duplicated -- one set of basemap names for the whole product.
//
// Unlike PlannerTopbar, telemetry's topbar has only this one dropdown (no
// DRAW menu to coordinate with), so open/close state is self-contained here
// instead of being lifted into TelemetryTopbar the way PlannerTopbar's
// `openMenu` coordinates two sibling dropdowns.
//
// Rows are plain buttons marked with `aria-pressed`, not
// `role="menuitemradio"`/`aria-checked` the way PlannerLayersMenu's rows
// are: an explicit ARIA role overrides a <button>'s implicit "button" role,
// so a menuitemradio row is invisible to `getByRole('button', ...)`.
// `aria-pressed` keeps the native button role and matches this module's own
// convention (telemetry.css's `.tm-btn[aria-pressed='true']`).
import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/shared/store'
import { LAYER_LABELS, LAYER_ORDER, layerButtonLabel } from '@/modules/console/map/basemap'

export default function TelemetryLayersMenu() {
  const layer = useAppStore((s) => s.layer)
  const setLayer = useAppStore((s) => s.setLayer)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  // Close on an outside click, the same convention as a native <select>:
  // without this the menu only ever closes via picking a row.
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  return (
    <div className="tm-dropdown" ref={ref}>
      <button
        type="button"
        className="tm-btn"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {layerButtonLabel(layer)} ▾
      </button>
      {open ? (
        <div className="tm-menu" role="menu">
          {LAYER_ORDER.map((l) => (
            <button
              key={l}
              type="button"
              className="tm-menu-item tm-menu-radio"
              aria-pressed={l === layer}
              onClick={() => {
                setLayer(l)
                setOpen(false)
              }}
            >
              <span>{LAYER_LABELS[l]}</span>
              <span className="tm-menu-check">{l === layer ? '✓' : ''}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
