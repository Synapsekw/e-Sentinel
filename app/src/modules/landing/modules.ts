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

// Single source of truth for the landing cards.
//
// The blurbs were middot-separated keyword dumps carried 1:1 from the legacy
// index.html, set in 9.5px tracked-out mono like every other label on the
// page. They are now one readable sentence each, which is what lets the card
// carry two type registers (mono for the number and status, body text for the
// description) instead of one. No em dashes, per the house convention.
export const MODULES: ModuleCard[] = [
  {
    num: '01',
    slug: 'console',
    title: 'Simulation',
    blurb: 'National grid command and control. 104 docks, live fleet, mission video debriefs.',
    status: 'online',
    statusLabel: 'ONLINE',
    enabled: true,
  },
  {
    num: '02',
    slug: 'planner',
    title: 'Deployment Planner',
    // This blurb used to end in AI CO-PLANNER, a capability that does not
    // exist. Keeping it was a deliberate call recorded in
    // docs/superpowers/specs/2026-07-26-planner-hardening-design.md (section
    // 9) on the grounds that the card described the module's intent. That call
    // is deliberately REVERSED here: the landing page is shown to government
    // clients and partners, so every card now claims only what the module
    // actually does today. Re-add it when the co-planner ships, not before.
    blurb: 'Draw a customer area, place docks, read coverage and overlap before a single flight.',
    status: 'online',
    statusLabel: 'ONLINE',
    enabled: true,
  },
  {
    num: '03',
    slug: 'telemetry',
    title: 'Telemetry',
    // The old blurb promised "fleet performance analytics", which this module
    // does not do, and used "track replay" -- a word that means detected
    // ground targets everywhere else in this codebase (console/panels/
    // TrackPanel.tsx). Both corrected on the same principle recorded on the
    // planner card above: this page is shown to government clients and
    // partners, so every card claims only what the module actually does.
    blurb: 'Replay real DJI flight logs: path, altitude, battery and flight mode, frame by frame.',
    status: 'online',
    statusLabel: 'ONLINE',
    enabled: true,
  },
  {
    num: '04',
    slug: 'compliance',
    title: 'Compliance',
    blurb: 'Drone logbook, approvals, and a regulatory audit trail.',
    status: 'planned',
    statusLabel: 'PLANNED',
    enabled: false,
  },
]
