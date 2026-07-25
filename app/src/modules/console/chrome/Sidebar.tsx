// Ported (Phase 1D / Task 6) from console.html:44-76 (the `<aside id="side">`
// skeleton): live-network tile, the "National grid" panel wrapping
// GridStats, and the flight-requests board, in that order. `<aside id="side">`
// itself is `ConsoleChrome.tsx`'s job (Task 2) -- this component supplies
// only its children, mounted by Task 8's `Console.tsx` as
// `<ConsoleChrome sidebar={<Sidebar/>} .../>`.

import GridStats from '@/modules/console/hud/GridStats'
import LiveNetworkTile from './LiveNetworkTile'
import RequestBoard from './RequestBoard'

export default function Sidebar() {
  return (
    <>
      <LiveNetworkTile />
      <div className="panel">
        <h4 className="lbl">National grid</h4>
        <GridStats />
      </div>
      <RequestBoard />
    </>
  )
}
