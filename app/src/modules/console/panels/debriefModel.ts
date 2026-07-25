// Ported (Phase 1E / Task 5) from assets/js/ui/panels.js:644-690
// (ANALYTICS_FORMATS / humanizeKey / formatAnalyticsValue / analyticsDL),
// :692-695 (debriefVideoSources), :726-777 (routeSvg — the pure pixel-math
// half; the SVG markup itself is JSX, see panels/RouteSvg.tsx), :815-860
// (missionReportHTML), :993-1004 (timeHHMM / analyticsSummaryLine) and
// :1099-1107 (recordCompletedMission's `_debriefAt`/`_videoVariant`
// stamping + SESSION_MISSIONS_CAP). Everything here is pure (no DOM, no
// store, no engine singleton) so it is unit-testable standalone.

import { MISSIONS_CONFIG, VIDEO_MANIFEST } from '@/modules/console/domain'
import type { LonLat, Mission, MissionType } from '@/modules/console/domain'
import { fmtMMSS, thousands } from '@/modules/console/chrome/format'

// panels.js:1099-1122's SESSION_MISSIONS_CAP. shared/store.ts (Phase 1E /
// Task 1) keeps its own copy of this same value for pushSessionMission's
// cap so that module doesn't have to import from this feature module — see
// that file's comment. Both copies must stay `40`.
export const SESSION_MISSIONS_CAP = 40

// The engine's Mission type (domain/types.ts) has no `_debriefAt`/
// `_videoVariant` fields — those are legacy's ad hoc properties stamped
// onto a mission object the first time its debrief is recorded
// (panels.js:1101/1104), never declared on the shared Mission shape because
// nothing outside the debrief/MEDIA lanes reads them. Extending Mission
// locally (rather than editing domain/types.ts, which is out of this
// task's file scope) keeps that same "bolt-on" shape without widening the
// type every other consumer of Mission sees.
export interface DebriefMission extends Mission {
  _debriefAt?: Date
  _videoVariant?: number
}

// panels.js:648-659, verbatim.
export const ANALYTICS_FORMATS: Record<string, { label: string; fmt: (v: number) => string }> = {
  timeToSceneS: { label: 'TIME TO SCENE', fmt: (v) => v + 'S' },
  etaDeltaS: { label: 'ETA DELTA', fmt: (v) => (v > 0 ? '+' : '') + v + 'S' },
  payloadKg: { label: 'PAYLOAD', fmt: (v) => v + ' KG' },
  areaHa: { label: 'AREA', fmt: (v) => thousands(v) + ' HA' },
  volumeDeltaM3: { label: 'VOLUME Δ', fmt: (v) => thousands(v) + ' M³' },
  ndviMean: { label: 'NDVI MEAN', fmt: (v) => String(v) },
  coveragePct: { label: 'COVERAGE', fmt: (v) => v + '%' },
  progressPct: { label: 'PROGRESS', fmt: (v) => v + '%' },
  stressedPct: { label: 'STRESSED', fmt: (v) => v + '%' },
  palmCount: { label: 'PALM COUNT', fmt: (v) => thousands(v) },
}

// panels.js:663-667.
export function humanizeKey(key: string): string {
  const known = ANALYTICS_FORMATS[key]
  if (known) return known.label
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toUpperCase()
}

// panels.js:669-674.
export function formatAnalyticsValue(key: string, v: unknown): string {
  if (Array.isArray(v)) return v.join(' · ')
  const known = ANALYTICS_FORMATS[key]
  if (known) return known.fmt(v as number)
  return String(v)
}

// panels.js:676-687's per-row half of analyticsDL (the "NO ANALYTICS
// CAPTURED" empty state and the <dl> wrapper are DebriefPanel.tsx's JSX).
export function analyticsEntries(mission: Mission): Array<{ label: string; value: string }> {
  const a = mission.analytics || {}
  return Object.keys(a).map((k) => ({
    label: humanizeKey(k),
    value: formatAnalyticsValue(k, a[k]),
  }))
}

// panels.js:692-695. Legacy served a bare `videos/<file>` relative path;
// this app is served under a base path, so every static asset URL is
// prefixed with `import.meta.env.BASE_URL`, matching panels/dronePanel.ts's
// fpvSources.
export function debriefVideoSources(mission: Mission): string[] {
  const variants = VIDEO_MANIFEST[mission.type] || []
  return variants.map((f) => `${import.meta.env.BASE_URL}videos/${f}`)
}

export interface RouteGeometry {
  // Space-separated "x,y" pairs (one per waypoint), ready for an SVG
  // <polyline points="...">.
  path: string
  points: Array<{ x: number; y: number }>
  // The 25/50/75%-of-path-length dot positions (panels.js:753-765).
  marks: Array<{ x: number; y: number }>
}

// panels.js:726-765 (the pixel-space math half of routeSvg — the <svg>
// markup itself is JSX, see RouteSvg.tsx). Returns null for fewer than two
// finite waypoints, mirroring routeSvg's `if (wps.length < 2) return ''`.
export function routeGeometry(
  waypoints: readonly LonLat[] | null | undefined,
  w = 240,
  h = 140,
): RouteGeometry | null {
  const wps = (waypoints || []).filter(
    (p): p is LonLat => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]),
  )
  if (wps.length < 2) return null

  const px = w * 0.08
  const py = h * 0.08

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of wps) {
    if (p[0] < minX) minX = p[0]
    if (p[0] > maxX) maxX = p[0]
    if (p[1] < minY) minY = p[1]
    if (p[1] > maxY) maxY = p[1]
  }
  const spanX = maxX - minX
  const spanY = maxY - minY
  // Degenerate spans (straight N-S / E-W legs) collapse to the box center
  // on that axis rather than dividing by zero.
  const sx = (p: LonLat) => (spanX > 0 ? px + ((p[0] - minX) / spanX) * (w - 2 * px) : w / 2)
  const sy = (p: LonLat) => (spanY > 0 ? h - py - ((p[1] - minY) / spanY) * (h - 2 * py) : h / 2)
  const points = wps.map((p) => ({ x: sx(p), y: sy(p) }))

  // Cumulative screen-space length, for the 25/50/75% progress dots.
  const cum = [0]
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    cum.push(total)
  }
  const marks: Array<{ x: number; y: number }> = []
  if (total > 0) {
    for (const f of [0.25, 0.5, 0.75]) {
      const target = f * total
      let i = 1
      while (i < cum.length - 1 && cum[i] < target) i++
      const segLen = cum[i] - cum[i - 1]
      const t = segLen > 0 ? (target - cum[i - 1]) / segLen : 0
      const x = points[i - 1].x + (points[i].x - points[i - 1].x) * t
      const y = points[i - 1].y + (points[i].y - points[i - 1].y) * t
      marks.push({ x, y })
    }
  }

  const path = points.map((p) => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ')
  return { path, points, marks }
}

// panels.js:993-996.
export function timeHHMM(date: Date | null | undefined): string {
  return date instanceof Date
    ? date.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit' })
    : '--:--'
}

// panels.js:999-1004.
export function analyticsSummaryLine(mission: Mission): string {
  const a = mission.analytics || {}
  const keys = Object.keys(a).slice(0, 2)
  if (!keys.length) return 'NO ANALYTICS'
  return keys.map((k) => humanizeKey(k) + ' ' + formatAnalyticsValue(k, a[k])).join(' · ')
}

// panels.js:1102-1104's variant-rotation rule, factored out as a pure,
// testable step of recordCompletedMission (the rest of that function needs
// store/ticker access and lives in useDebriefWatch.ts).
export function computeVideoVariant(type: MissionType, priorOfType: number): number {
  const variants = VIDEO_MANIFEST[type] || []
  return variants.length ? priorOfType % variants.length : 0
}

// Minimal HTML text escaper for missionReportText below. Unlike JSX (which
// escapes text children by construction, per this phase's global
// constraints), that document is a plain string handed to
// `document.write`, so its interpolated mission fields need the same
// escaping legacy's escapeHtml() did.
function esc(v: unknown): string {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// The exported report's route snapshot is plain markup text, not JSX, so it
// can't reuse RouteSvg.tsx's rendering — this reconstructs the same
// markup panels.js:768-776 emitted, from the same routeGeometry() pixel
// math RouteSvg.tsx renders.
function routeSvgMarkup(waypoints: LonLat[]): string {
  const geo = routeGeometry(waypoints, 240, 140)
  if (!geo) return ''
  const start = geo.points[0]
  const end = geo.points[geo.points.length - 1]
  const dots = geo.marks
    .map(
      (m) =>
        '<circle cx="' + m.x.toFixed(1) + '" cy="' + m.y.toFixed(1) + '" r="1.8" fill="#38bdf8"/>',
    )
    .join('')
  return (
    '<svg class="route-svg" viewBox="0 0 240 140" width="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="MISSION ROUTE SNAPSHOT">' +
    '<polyline points="' +
    geo.path +
    '" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>' +
    dots +
    '<rect x="' +
    (start.x - 3).toFixed(1) +
    '" y="' +
    (start.y - 3).toFixed(1) +
    '" width="6" height="6" fill="#8b93a3"/>' +
    '<circle cx="' +
    end.x.toFixed(1) +
    '" cy="' +
    end.y.toFixed(1) +
    '" r="3" fill="#e8ecf4"/>' +
    '</svg>'
  )
}

// panels.js:815-860 (missionReportHTML), renamed missionReportText since
// this port's DOM-touching half (window.open/document.write, panels.js:862-
// 872) lives in DebriefPanel.tsx's EXPORT REPORT handler, not here. Payload
// content (markup, inline styles, print script) is transcribed exactly;
// the <title> doubles as the suggested filename when the operator uses the
// browser's "print to PDF" on the popup this opens.
export function missionReportText(mission: Mission): string {
  const cfg = MISSIONS_CONFIG[mission.type]
  const a = mission.analytics || {}
  const rows = Object.keys(a)
    .map(
      (k) =>
        '<tr><td>' +
        esc(humanizeKey(k)) +
        '</td><td>' +
        esc(formatAnalyticsValue(k, a[k])) +
        '</td></tr>',
    )
    .join('')
  const route = routeSvgMarkup(mission.waypoints)
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<title>SENTINEL REPORT · ' +
    esc(mission.id) +
    '</title>' +
    '<style>' +
    'body{font-family:ui-monospace,"SF Mono",Consolas,Menlo,monospace;color:#111;margin:40px;max-width:640px}' +
    'h1{font-size:14px;letter-spacing:.22em;margin:0 0 4px}' +
    '.brand{font-size:11px;letter-spacing:.18em;color:#555;margin-bottom:28px}' +
    'h2{font-size:11px;letter-spacing:.18em;color:#555;margin:26px 0 8px;text-transform:uppercase}' +
    'table{border-collapse:collapse;width:100%;font-size:12px}' +
    'td{border-bottom:1px solid #ddd;padding:7px 4px;text-transform:uppercase;letter-spacing:.06em}' +
    'td:last-child{text-align:right;font-weight:700}' +
    '.route{border:1px solid #ddd;border-radius:6px;padding:10px;background:#0a0b0e;print-color-adjust:exact;-webkit-print-color-adjust:exact}' +
    '.foot{margin-top:32px;font-size:10px;letter-spacing:.14em;color:#888}' +
    '@media print{body{margin:16mm}}' +
    '</style></head><body>' +
    '<h1>SENTINEL &middot; SIMULATED OPERATIONS REPORT</h1>' +
    '<div class="brand">e&amp; &middot; GLOBAL COMMAND &amp; CONTROL &middot; DEMONSTRATION DATA ONLY</div>' +
    '<h2>Mission</h2>' +
    '<table>' +
    '<tr><td>MISSION ID</td><td>' +
    esc(mission.id) +
    '</td></tr>' +
    '<tr><td>TYPE</td><td>' +
    esc(cfg.label) +
    '</td></tr>' +
    '<tr><td>DOCK</td><td>' +
    esc(mission.dockId) +
    '</td></tr>' +
    (mission.requestedBy
      ? '<tr><td>REQUESTED BY</td><td>' + esc(mission.requestedBy) + '</td></tr>'
      : '') +
    (mission.trackId
      ? '<tr><td>TRACK RESPONSE</td><td>' + esc(mission.trackId) + '</td></tr>'
      : '') +
    '<tr><td>DURATION</td><td>' +
    fmtMMSS(mission.durationS) +
    '</td></tr>' +
    '<tr><td>DISTANCE</td><td>' +
    (mission.distanceKm || 0).toFixed(1) +
    ' KM</td></tr>' +
    '</table>' +
    (route ? '<h2>Route snapshot</h2><div class="route">' + route + '</div>' : '') +
    '<h2>Mission analytics</h2>' +
    (rows ? '<table>' + rows + '</table>' : '<p>NO ANALYTICS CAPTURED</p>') +
    '<div class="foot">GENERATED BY e&amp; SENTINEL CONSOLE &middot; ALL DATA SIMULATED</div>' +
    '<scr' +
    'ipt>window.onload=function(){window.print();};</scr' +
    'ipt>' +
    '</body></html>'
  )
}
