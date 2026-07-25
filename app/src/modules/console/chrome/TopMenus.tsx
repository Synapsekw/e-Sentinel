// Phase 1D / Task 5 extra deliverable (not a direct legacy port -- legacy's
// wireTopMenus, panels.js:2010-2014, called wireDocksMenu/wireFilterMenu/
// wireLayersMenu individually at init time; there is no single legacy
// function this component transcribes). Bundles the topbar dropdowns so
// Task 8's console assembly can mount all of them with one element,
// mirroring how ConsoleChrome.tsx takes its slots as opaque ReactNode props
// rather than reaching into each menu's internals.
//
// Phase 1E / Task 4 adds the predefined-mission dropdown here too. Legacy
// built that one in control.js (buildMissionsMenu, :774-805) rather than
// panels.js's wireTopMenus, purely because control.js owned launchPreset;
// in the React port it is the same kind of <TopMenu> as the other three, so
// it belongs in the same bundle.

import DocksMenu from './DocksMenu'
import FilterMenu from './FilterMenu'
import LayersMenu from './LayersMenu'
import MissionsMenu from '@/modules/console/control/MissionsMenu'

export default function TopMenus() {
  return (
    <>
      <DocksMenu />
      <FilterMenu />
      <LayersMenu />
      <MissionsMenu />
    </>
  )
}
