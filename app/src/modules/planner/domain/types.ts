import type GeoJSON from 'geojson'

export type DockModelId = 'DOCK3' | 'DOCK2'
export type DroneModelId = 'M4TD' | 'M4D' | 'M350'

export interface Aoi {
  id: string
  name: string
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
  source: 'drawn' | 'kml' | 'kmz'
  valid: boolean
  simplifiedFrom?: number
}

export interface PlannedDock {
  id: string
  name: string
  position: [lon: number, lat: number]
  dockModel: DockModelId
  droneModel: DroneModelId
  environment: 'urban' | 'rural'
  radiusKmOverride?: number
  source: 'manual' | 'auto'
}

export interface CoverageParams {
  targetOverlapPct: number
  requiredCoveragePct: number
}

export interface DeploymentPlan {
  id: string
  name: string
  customer: string
  createdAt: string
  updatedAt: string
  schemaVersion: number
  aois: Aoi[]
  docks: PlannedDock[]
  params: CoverageParams
  rev: number
}

export type CoverageResult =
  | { ok: false; reason: 'no-aoi' | 'no-docks' | 'degenerate' }
  | {
      ok: true
      aoiKm2: number
      coveragePct: number
      overlapPct: number
      uncovered: GeoJSON.MultiPolygon
      gapCount: number
      perDock: { dockId: string; contributionKm2: number }[]
    }
