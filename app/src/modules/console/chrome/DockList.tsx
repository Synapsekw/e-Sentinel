// Ported (Phase 1D / Task 5) from assets/js/ui/panels.js:2020-2047 (the
// #dock-tools search input + ID/BATT/STATE sort segment, injected once
// above #docklist), :2092-2123 (buildDockRow's markup + click handler) and
// :2311-2361 (renderDockList's grouping + empty note). Legacy's dockListSig
// diffing (only rebuild the DOM when filter/search/sort/membership/order
// actually changed, otherwise patch battery/state cells in place) has no
// analogue here -- React's own reconciliation already does the equivalent
// minimal-DOM-write job on every render.
//
// `engine` is an optional prop defaulting to the ambient EngineProvider (via
// the small `useOptionalEngine` helper below, not the throwing `useEngine()`)
// so DockList.test.tsx can render this component directly without an
// <EngineProvider> harness. A React hook cannot be called conditionally, so
// `useContext(EngineContext)` is always called; the prop, when explicitly
// passed (including `null`), simply overrides what it returns. The map
// instance is resolved the same way for the same reason: a dock-row click
// can fly the camera (via selectEntity), and MapContext's own `useMap()`
// throws outside <MapView> just like `useEngine()` does outside
// <EngineProvider>.

import { useContext, useEffect, useReducer, useState } from 'react'
import type { Engine } from '@/modules/console/domain'
import { EngineContext } from '@/modules/console/engine/EngineContext'
import { MapContext } from '@/modules/console/map/MapContext'
import { useAppStore } from '@/shared/store'
import { selectEntity, selectedDockId, inCaptureMode } from '@/modules/console/selection'
import { EMIRATE_NAMES } from './emirates'
import { ALERT_STATES } from './format'
import { batteryFor, dockListRows, groupRows, stateFor } from './dockModel'

// See the file header: mirrors useEngine() but returns null instead of
// throwing when there is no ambient <EngineProvider>.
function useOptionalEngine(): Engine | null {
  const ctx = useContext(EngineContext)
  return ctx ? ctx.engineRef.current : null
}

// Mirrors useMap() but returns null instead of throwing when there is no
// ambient <MapView>.
function useOptionalMap(): import('maplibre-gl').Map | null {
  const ctx = useContext(MapContext)
  return ctx ? ctx.mapRef.current : null
}

// panels.js:2735-2737's 2s poll interval, scoped to this component and
// gated on the DOCKS menu being open (panels.js:2319-2322's closed-menu
// no-op guard) so live battery/state cells stay current while visible.
const LIVE_REFRESH_MS = 2000
// panels.js:2110-2111's transient "blocked" title, cleared after 2s.
const BLOCKED_TITLE_MS = 2000

export interface DockListProps {
  engine?: Engine | null
}

export default function DockList({ engine }: DockListProps = {}) {
  const contextEngine = useOptionalEngine()
  const resolvedEngine = engine !== undefined ? engine : contextEngine
  const map = useOptionalMap()

  const dockFilter = useAppStore((s) => s.dockFilter)
  const dockSearch = useAppStore((s) => s.dockSearch)
  const dockSort = useAppStore((s) => s.dockSort)
  const setDockSearch = useAppStore((s) => s.setDockSearch)
  const setDockSort = useAppStore((s) => s.setDockSort)
  const setOpenMenu = useAppStore((s) => s.setOpenMenu)
  const selection = useAppStore((s) => s.selection)
  const isMenuOpen = useAppStore((s) => s.openMenu === 'docks')

  // A row that just got blocked by inCaptureMode() shows a transient title;
  // tracked locally since it's pure UI feedback, not selection state.
  const [blockedId, setBlockedId] = useState<string | null>(null)

  // Bumps to force a re-render off live engine state (battery %, alert dot)
  // on the same cadence legacy's poll used -- these values are read straight
  // off `resolvedEngine` each render, not stored in React state themselves.
  const [, forceTick] = useReducer((c: number) => c + 1, 0)
  useEffect(() => {
    if (!isMenuOpen) return
    const id = setInterval(() => forceTick(), LIVE_REFRESH_MS)
    return () => clearInterval(id)
  }, [isMenuOpen])

  const rows = dockListRows(resolvedEngine, dockFilter, dockSearch, dockSort)
  const items = groupRows(rows, dockSort)
  const selDockId = selectedDockId(selection)

  function handleRowClick(dockId: string): void {
    if (inCaptureMode()) {
      setBlockedId(dockId)
      setTimeout(() => setBlockedId((cur) => (cur === dockId ? null : cur)), BLOCKED_TITLE_MS)
      return
    }
    const drone = resolvedEngine ? resolvedEngine.drones.get('D-' + dockId) : undefined
    if (drone && drone.state !== 'docked') {
      selectEntity({ type: 'drone', id: drone.id }, resolvedEngine, map)
    } else {
      selectEntity({ type: 'dock', id: dockId }, resolvedEngine, map)
    }
    setOpenMenu(null) // picking a dock dismisses the dropdown
  }

  return (
    <>
      <div id="dock-tools">
        <input
          type="search"
          id="dock-search"
          className="dock-search"
          placeholder="SEARCH DOCKS"
          autoComplete="off"
          spellCheck={false}
          aria-label="Search docks"
          defaultValue={dockSearch}
          onChange={(e) => setDockSearch(e.target.value.trim().toLowerCase())}
        />
        <div className="dock-sort" id="dock-sort" role="group" aria-label="Sort docks">
          <button
            type="button"
            data-sort="ID"
            className={dockSort === 'ID' ? 'on' : undefined}
            onClick={() => setDockSort('ID')}
          >
            ID
          </button>
          <button
            type="button"
            data-sort="BATT"
            className={dockSort === 'BATT' ? 'on' : undefined}
            onClick={() => setDockSort('BATT')}
          >
            BATT
          </button>
          <button
            type="button"
            data-sort="STATE"
            className={dockSort === 'STATE' ? 'on' : undefined}
            onClick={() => setDockSort('STATE')}
          >
            STATE
          </button>
        </div>
      </div>
      <div id="docklist">
        {items.length === 0 && <div className="lbl empty-note">NO DOCKS MATCH THIS FILTER</div>}
        {items.map((item) =>
          item.kind === 'group' ? (
            <div key={'group-' + item.emirate} className="lbl dock-group">
              {item.emirate} &middot; {(EMIRATE_NAMES[item.emirate] || item.emirate).toUpperCase()}
            </div>
          ) : (
            <button
              key={item.dock.id}
              type="button"
              className={'dock-row' + (selDockId === item.dock.id ? ' sel' : '')}
              data-dock-id={item.dock.id}
              title={blockedId === item.dock.id ? 'EXIT CURRENT MODE FIRST' : undefined}
              onClick={() => handleRowClick(item.dock.id)}
            >
              <span
                className={
                  'sd' +
                  (ALERT_STATES.includes(stateFor(resolvedEngine, item.dock)) ? ' alert' : '')
                }
              />
              <span className="di">
                <b>{item.dock.id}</b>
                <i>{item.dock.name}</i>
              </span>
              <span className="dr">
                <span className="model">{item.dock.model}</span>
                <span className="batt">{batteryFor(resolvedEngine, item.dock.id)}%</span>
              </span>
            </button>
          ),
        )}
      </div>
    </>
  )
}
