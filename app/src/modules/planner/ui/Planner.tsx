import MapView from '@/modules/console/map/MapView'
import { buildBaseStyle } from '@/modules/console/map/style'

// Working camera for the planner: the whole UAE in frame at a zoom you can
// actually place docks at, rather than the console's orbital globe entry.
const PLANNER_CENTER: [number, number] = [54.6, 24.3]
const PLANNER_ZOOM = 6.4

export default function Planner() {
  return (
    <div className="planner-root">
      <MapView
        initialCenter={PLANNER_CENTER}
        initialZoom={PLANNER_ZOOM}
        styleSpec={buildBaseStyle()}
      />
    </div>
  )
}
