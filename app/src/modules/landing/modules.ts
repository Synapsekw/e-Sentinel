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
    blurb: 'CUSTOMER AOI · DOCK PLACEMENT · COVERAGE & OVERLAP · AI CO-PLANNER',
    status: 'dev',
    statusLabel: 'IN DEVELOPMENT',
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
