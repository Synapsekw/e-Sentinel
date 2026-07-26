export type ModuleStatus = 'online' | 'dev' | 'planned'

export interface ModuleCard {
  num: string
  slug: string
  title: string
  blurb: string
  status: ModuleStatus
  statusLabel: string
  enabled: boolean
}

// Single source of truth for the landing cards. Mirrors the legacy index.html
// copy exactly (no em dashes; middot separators).
export const MODULES: ModuleCard[] = [
  {
    num: '01',
    slug: 'console',
    title: 'Simulation',
    blurb: 'NATIONAL GRID C2 · 104 DOCKS · LIVE FLEET · MISSION VIDEO DEBRIEFS',
    status: 'online',
    statusLabel: 'ONLINE',
    enabled: true,
  },
  {
    num: '02',
    slug: 'planner',
    title: 'Deployment Planner',
    // The blurb keeps AI CO-PLANNER, which does not exist yet: this copy is
    // carried 1:1 from the legacy index.html the landing page was ported from,
    // and the card describes the module's intent. Recorded in
    // docs/superpowers/specs/2026-07-26-planner-hardening-design.md (section 9)
    // so it reads as a decision rather than an oversight.
    blurb: 'CUSTOMER AOI · DOCK PLACEMENT · COVERAGE & OVERLAP · AI CO-PLANNER',
    status: 'online',
    statusLabel: 'ONLINE',
    enabled: true,
  },
  {
    num: '03',
    slug: 'telemetry',
    title: 'Telemetry',
    blurb: 'FLIGHT HISTORY · TRACK REPLAY · PERFORMANCE ANALYTICS',
    status: 'planned',
    statusLabel: 'PLANNED',
    enabled: false,
  },
  {
    num: '04',
    slug: 'compliance',
    title: 'Compliance',
    blurb: 'DRONE LOGBOOK · APPROVALS · REGULATORY AUDIT TRAIL',
    status: 'planned',
    statusLabel: 'PLANNED',
    enabled: false,
  },
]
