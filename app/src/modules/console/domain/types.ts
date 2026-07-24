// Domain types for the drone-C2 simulation core.
//
// Ported (Phase 1A / Task 1) from the vanilla-JS legacy app under
// assets/js/{data,sim}/*.js. The state unions below were derived from a
// literal grep of assets/js/sim/engine.js (see task-1-report.md for the
// exact commands/output), not guessed — DockState/MissionState/
// RequestStatus/TrackStatus/Priority/SimEvent['level'] all matched the
// task brief's baseline exactly. DroneState did not: the brief's baseline
// ('docked'|'takeoff'|'enroute'|'onstation'|'returning'|'landing') does
// not occur anywhere in the shipped app (grepped repo-wide) — the engine
// actually assigns drone.state to 'docked'|'takeoff'|'transit'|'on-task'|
// 'rtb'|'landing'|'hold'|'manual', corroborated by assets/js/ui/panels.js
// (FLYING_STATES / FPV_LIVE_STATES). DroneState below reflects the real
// literals so this stays a faithful port.

export type LonLat = [lon: number, lat: number]

export type MissionType =
  'security' | 'infra' | 'emergency' | 'delivery' | 'construction' | 'highway' | 'parks'

export type DockState =
  'ready' | 'launching' | 'drone-away' | 'landing' | 'charging' | 'fault' | 'offline'

export type DroneState =
  'docked' | 'takeoff' | 'transit' | 'on-task' | 'rtb' | 'landing' | 'hold' | 'manual'

export type MissionState = 'active' | 'complete'
export type RequestStatus = 'pending' | 'approved' | 'declined' | 'completed'
export type TrackStatus = 'active' | 'tasked' | 'resolved' | 'expired'
export type Priority = 'ROUTINE' | 'PRIORITY' | 'URGENT'

// Raw dock input as it appears in DATA_DOCKS (data/docks.js entries).
export interface DockSeed {
  id: string
  name: string
  emirate: string
  coords: LonLat
  model: string
  urban?: boolean
}

export interface Drone {
  id: string
  model: string
  dockId: string
  pos: LonLat
  alt: number
  heading: number
  speedMs: number
  battery: number
  state: DroneState
  missionId: string | null
  _leg: unknown
  _legDistKm: number
  _legProgress: number
  _timer: number
  _holdUntil: number
}

export interface Dock {
  id: string
  name: string
  emirate: string
  coords: LonLat
  urban: boolean | undefined
  battery: number
  state: DockState
  drone: Drone
  _faultUntil: number
  _allDocks?: Dock[]
}

export interface Mission {
  id: string
  type: MissionType
  dockId: string
  waypoints: LonLat[]
  params: { altM: number; speedMs: number }
  progress: number
  state: MissionState
  analytics: Record<string, unknown> | null
  startedAt: number
  distanceKm: number
  durationS: number
  completedAt?: number
  requestId?: string
  trackId?: string
  _milestones: Record<string, unknown>
}

export interface FlightRequest {
  id: string | null
  customer: string
  customerFull: string
  type: MissionType
  place: string
  coords: LonLat
  priority: Priority
  params: { altM: number; speedMs: number }
  requestedAt: number
  status: RequestStatus
  dockId: string
  waypoints: LonLat[] | null
  missionId: string | null
}

export interface Track {
  id: string
  label: string
  missionType: MissionType
  pos: LonLat
  sourceDrone: string
  sourceMission: string
  detectedAt: number
  expiresAt: number
  status: TrackStatus
  missionId: string | null
  dockId: string | null
  homeDockId: string
}

export interface SimEvent {
  time: number
  level: 'info' | 'warn' | 'alert'
  source: string
  message: string
  code?: string
  // C-2 extras merged onto the event (e.g. dockId, requestId, trackId).
  dockId?: string
  requestId?: string
  trackId?: string
}

// Raw site input as it appears in DATA_SITES (data/sites.js entries).
export interface Site {
  id: string
  name: string
  coords: LonLat
  status: 'installed' | 'not-installed' | 'replace'
}

// Per-mission-type configuration as it appears in MISSIONS_CONFIG
// (data/missions-config.js entries).
export interface MissionConfig {
  label: string
  pattern: 'perimeter' | 'corridor' | 'atob' | 'lawnmower'
  defaults: { altM: number; speedMs: number }
  analytics: (mission: Mission, rand: () => number) => Record<string, unknown>
}
