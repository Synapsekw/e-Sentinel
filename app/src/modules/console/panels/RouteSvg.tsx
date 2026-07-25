// Ported (Phase 1E / Task 5) from assets/js/ui/panels.js:726-777 (routeSvg)
// — specifically the JSX rendering half. The pixel-space geometry (viewBox
// math, quartile-mark placement) is computed by this module's sibling
// debriefModel.ts's routeGeometry(), which this component just lays out as
// an inline <svg>, in the same element order legacy emitted: track
// polyline, quarter dots, dock/start square, end circle.
//
// SHARED PROP SURFACE: this component is also imported by another Phase 1E
// lane's RequestPanel.tsx (the planned-route snapshot for a pending flight
// request), so its props are kept minimal and stable — do not add fields
// here without checking that lane.

import { routeGeometry } from './debriefModel'
import type { LonLat } from '@/modules/console/domain'

export interface RouteSvgProps {
  waypoints: LonLat[]
  width?: number
  height?: number
}

export default function RouteSvg({ waypoints, width = 240, height = 140 }: RouteSvgProps) {
  const geo = routeGeometry(waypoints, width, height)
  if (!geo) return null

  const start = geo.points[0]
  const end = geo.points[geo.points.length - 1]

  return (
    <svg
      className="route-svg"
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="MISSION ROUTE SNAPSHOT"
    >
      <polyline
        points={geo.path}
        fill="none"
        stroke="#38bdf8"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {geo.marks.map((m, i) => (
        <circle key={i} cx={m.x.toFixed(1)} cy={m.y.toFixed(1)} r={1.8} fill="#38bdf8" />
      ))}
      <rect
        x={(start.x - 3).toFixed(1)}
        y={(start.y - 3).toFixed(1)}
        width={6}
        height={6}
        fill="#8b93a3"
      />
      <circle cx={end.x.toFixed(1)} cy={end.y.toFixed(1)} r={3} fill="#e8ecf4" />
    </svg>
  )
}
