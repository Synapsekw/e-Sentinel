// Phase 1D / Task 5 extra deliverable (not a direct legacy port -- legacy's
// wireTopMenus, panels.js:2010-2014, called wireDocksMenu/wireFilterMenu/
// wireLayersMenu individually at init time; there is no single legacy
// function this component transcribes). Bundles the three topbar dropdowns
// so Task 8's console assembly can mount all of them with one element,
// mirroring how ConsoleChrome.tsx takes its slots as opaque ReactNode props
// rather than reaching into each menu's internals.

import DocksMenu from './DocksMenu'
import FilterMenu from './FilterMenu'
import LayersMenu from './LayersMenu'

export default function TopMenus() {
  return (
    <>
      <DocksMenu />
      <FilterMenu />
      <LayersMenu />
    </>
  )
}
