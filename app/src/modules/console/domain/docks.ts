// Ported (Phase 1A / Task 1) verbatim from assets/js/data/docks.js.
// Only the module wiring changed (IIFE + global-attach -> ES module
// exports + type annotations); data values, constants, and logic are
// transcribed exactly.

import type { DockSeed, LonLat } from './types'

// ---------- coverage range classification ----------
// Operational reach of a dock's drone, driven by where it sits: inside a
// dense city a drone is held to a tighter 3 km radius (RF congestion, tighter
// airspace, line-of-sight), out in open desert / highways / mountains it gets
// 5 km. This single source of truth feeds BOTH the map coverage rings and the
// simulation's route generator, so what the presenter sees (the ring) always
// matches where the drones are allowed to fly.
const URBAN_RANGE_KM = 3
const RURAL_RANGE_KM = 5

// Generous circles over each built-up conurbation. A dock inside any of these
// reads as "urban". Tuned by eye against the dock list; they intentionally
// overlap where cities merge (Sharjah–Ajman–UAQ). To fix a single station the
// circle guesses wrong, set `urban:true|false` on that dock below — the
// explicit flag always wins over geography (see isUrbanDock).
const URBAN_CENTERS: { name: string; lon: number; lat: number; rKm: number }[] = [
  { name: 'Abu Dhabi', lon: 54.45, lat: 24.45, rKm: 30 },
  { name: 'Dubai', lon: 55.25, lat: 25.15, rKm: 32 },
  { name: 'Sharjah-Ajman-UAQ', lon: 55.47, lat: 25.4, rKm: 22 },
  { name: 'Al Ain', lon: 55.74, lat: 24.22, rKm: 20 },
  { name: 'Ras Al Khaimah', lon: 55.95, lat: 25.75, rKm: 16 },
  { name: 'Fujairah', lon: 56.34, lat: 25.15, rKm: 14 },
]

// Self-contained great-circle distance in km (docks.js loads before the
// SimRouter helpers, so it can't depend on them).
function distKm(a: LonLat, b: LonLat): number {
  const R = 6371,
    D2R = Math.PI / 180
  const dLat = (b[1] - a[1]) * D2R
  const dLon = (b[0] - a[0]) * D2R
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * D2R) * Math.cos(b[1] * D2R) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

function isUrbanDock(dock: { coords: LonLat; urban?: boolean }): boolean {
  if (dock && typeof dock.urban === 'boolean') return dock.urban // explicit override
  const c = dock && dock.coords
  if (!Array.isArray(c)) return false
  return URBAN_CENTERS.some((u) => distKm(c, [u.lon, u.lat]) <= u.rKm)
}

function dockRangeKm(dock: { coords: LonLat; urban?: boolean }): 3 | 5 {
  return isUrbanDock(dock) ? URBAN_RANGE_KM : RURAL_RANGE_KM
}

export const DOCK_RANGE = {
  URBAN_RANGE_KM,
  RURAL_RANGE_KM,
  URBAN_CENTERS,
  isUrbanDock,
  dockRangeKm,
} as const

export const DATA_DOCKS: DockSeed[] = [
  // ===== AUH — Abu Dhabi (28): city/island, industrial, west region =====
  { id: 'AUH-001', name: 'Corniche', emirate: 'AUH', coords: [54.349, 24.477], model: 'M4TD' },
  { id: 'AUH-002', name: 'Saadiyat', emirate: 'AUH', coords: [54.435, 24.542], model: 'M4D' },
  { id: 'AUH-003', name: 'Yas Island', emirate: 'AUH', coords: [54.605, 24.487], model: 'M4TD' },
  { id: 'AUH-004', name: 'Masdar City', emirate: 'AUH', coords: [54.605, 24.41], model: 'M4TD' },
  { id: 'AUH-005', name: 'Khalifa Port', emirate: 'AUH', coords: [54.67, 24.8], model: 'M350' },
  { id: 'AUH-006', name: 'KIZAD', emirate: 'AUH', coords: [54.78, 24.72], model: 'M4D' },
  { id: 'AUH-007', name: 'Mussafah', emirate: 'AUH', coords: [54.49, 24.36], model: 'M4TD' },
  { id: 'AUH-008', name: 'Al Wathba', emirate: 'AUH', coords: [54.64, 24.19], model: 'M4D' },
  { id: 'AUH-009', name: 'Reem Island', emirate: 'AUH', coords: [54.405, 24.497], model: 'M4TD' },
  { id: 'AUH-010', name: 'Al Raha', emirate: 'AUH', coords: [54.586, 24.447], model: 'M4D' },
  { id: 'AUH-011', name: 'Al Shamkha', emirate: 'AUH', coords: [54.73, 24.31], model: 'M4TD' },
  { id: 'AUH-012', name: 'Al Falah', emirate: 'AUH', coords: [54.715, 24.345], model: 'M4TD' },
  { id: 'AUH-013', name: 'Baniyas', emirate: 'AUH', coords: [54.62, 24.33], model: 'M4D' },
  { id: 'AUH-014', name: 'Al Samha', emirate: 'AUH', coords: [54.75, 24.63], model: 'M4TD' },
  { id: 'AUH-015', name: 'Al Rahba', emirate: 'AUH', coords: [54.7, 24.36], model: 'M4TD' },
  { id: 'AUH-016', name: 'Shahama', emirate: 'AUH', coords: [54.62, 24.53], model: 'M4D' },
  { id: 'AUH-017', name: 'Al Bahia', emirate: 'AUH', coords: [54.585, 24.51], model: 'M4TD' },
  { id: 'AUH-018', name: 'Al Maqta', emirate: 'AUH', coords: [54.47, 24.41], model: 'M4TD' },
  { id: 'AUH-019', name: 'Zayed Port', emirate: 'AUH', coords: [54.37, 24.505], model: 'M350' },
  { id: 'AUH-020', name: 'ICAD', emirate: 'AUH', coords: [54.53, 24.33], model: 'M350' },
  { id: 'AUH-021', name: 'Ruwais', emirate: 'AUH', coords: [52.73, 24.11], model: 'M350' },
  { id: 'AUH-022', name: 'Ghayathi', emirate: 'AUH', coords: [52.81, 23.83], model: 'M4D' },
  { id: 'AUH-023', name: 'Madinat Zayed', emirate: 'AUH', coords: [53.65, 23.65], model: 'M4D' },
  { id: 'AUH-024', name: 'Liwa Oasis', emirate: 'AUH', coords: [53.78, 23.13], model: 'M4D' },
  { id: 'AUH-025', name: 'Sila', emirate: 'AUH', coords: [51.75, 24.03], model: 'M350' },
  { id: 'AUH-026', name: 'Khalifa City', emirate: 'AUH', coords: [54.575, 24.415], model: 'M4TD' },
  { id: 'AUH-027', name: 'Al Bateen', emirate: 'AUH', coords: [54.325, 24.465], model: 'M4D' },
  {
    id: 'AUH-028',
    name: 'Tourist Club Area',
    emirate: 'AUH',
    coords: [54.37, 24.494],
    model: 'M4TD',
  },

  // ===== DXB — Dubai (26) =====
  { id: 'DXB-001', name: 'Business Bay', emirate: 'DXB', coords: [55.263, 25.185], model: 'M4TD' },
  { id: 'DXB-002', name: 'Marina', emirate: 'DXB', coords: [55.14, 25.078], model: 'M4TD' },
  { id: 'DXB-003', name: 'Jebel Ali Port', emirate: 'DXB', coords: [55.06, 25.01], model: 'M350' },
  { id: 'DXB-004', name: 'Expo City', emirate: 'DXB', coords: [55.15, 24.96], model: 'M4D' },
  { id: 'DXB-005', name: 'Silicon Oasis', emirate: 'DXB', coords: [55.38, 25.12], model: 'M4TD' },
  { id: 'DXB-006', name: 'Al Qusais', emirate: 'DXB', coords: [55.395, 25.295], model: 'M4TD' },
  { id: 'DXB-007', name: 'Al Khawaneej', emirate: 'DXB', coords: [55.47, 25.24], model: 'M4D' },
  { id: 'DXB-008', name: 'Hatta', emirate: 'DXB', coords: [56.12, 24.8], model: 'M4D' },
  { id: 'DXB-009', name: 'Deira', emirate: 'DXB', coords: [55.32, 25.27], model: 'M4TD' },
  { id: 'DXB-010', name: 'Jumeirah', emirate: 'DXB', coords: [55.245, 25.211], model: 'M4TD' },
  { id: 'DXB-011', name: 'Meydan', emirate: 'DXB', coords: [55.31, 25.155], model: 'M4D' },
  { id: 'DXB-012', name: 'Dubailand', emirate: 'DXB', coords: [55.3, 25.045], model: 'M4TD' },
  { id: 'DXB-013', name: 'Al Barsha', emirate: 'DXB', coords: [55.2, 25.1], model: 'M4TD' },
  { id: 'DXB-014', name: 'Palm Jumeirah', emirate: 'DXB', coords: [55.138, 25.112], model: 'M4D' },
  { id: 'DXB-015', name: 'DIP', emirate: 'DXB', coords: [55.18, 24.985], model: 'M4D' },
  { id: 'DXB-016', name: 'Al Awir', emirate: 'DXB', coords: [55.47, 25.17], model: 'M4TD' },
  { id: 'DXB-017', name: 'Lehbab', emirate: 'DXB', coords: [55.55, 25.02], model: 'M4D' },
  { id: 'DXB-018', name: 'Al Lisaili', emirate: 'DXB', coords: [55.65, 24.9], model: 'M4D' },
  { id: 'DXB-019', name: 'Margham', emirate: 'DXB', coords: [55.75, 24.83], model: 'M4D' },
  { id: 'DXB-020', name: 'Al Marmoom', emirate: 'DXB', coords: [55.55, 24.85], model: 'M4D' },
  { id: 'DXB-021', name: 'Dubai South', emirate: 'DXB', coords: [55.17, 24.89], model: 'M350' },
  { id: 'DXB-022', name: 'Al Warqa', emirate: 'DXB', coords: [55.43, 25.22], model: 'M4TD' },
  { id: 'DXB-023', name: 'Nad Al Sheba', emirate: 'DXB', coords: [55.34, 25.17], model: 'M4TD' },
  { id: 'DXB-024', name: 'Mirdif', emirate: 'DXB', coords: [55.42, 25.21], model: 'M4TD' },
  {
    id: 'DXB-025',
    name: 'International City',
    emirate: 'DXB',
    coords: [55.408, 25.167],
    model: 'M4TD',
  },
  { id: 'DXB-026', name: 'Al Ruwayyah', emirate: 'DXB', coords: [55.5, 25.13], model: 'M4D' },

  // ===== SHJ — Sharjah (12) =====
  { id: 'SHJ-001', name: 'Sharjah City', emirate: 'SHJ', coords: [55.39, 25.35], model: 'M4TD' },
  { id: 'SHJ-002', name: 'Al Dhaid', emirate: 'SHJ', coords: [55.88, 25.28], model: 'M4D' },
  { id: 'SHJ-003', name: 'Khor Fakkan', emirate: 'SHJ', coords: [56.35, 25.34], model: 'M4D' },
  { id: 'SHJ-004', name: 'Kalba', emirate: 'SHJ', coords: [56.35, 25.06], model: 'M4D' },
  { id: 'SHJ-005', name: 'Mleiha', emirate: 'SHJ', coords: [55.86, 25.13], model: 'M4D' },
  { id: 'SHJ-006', name: 'Hamriyah', emirate: 'SHJ', coords: [55.49, 25.46], model: 'M350' },
  { id: 'SHJ-007', name: 'Muweilah', emirate: 'SHJ', coords: [55.44, 25.3], model: 'M4TD' },
  { id: 'SHJ-008', name: 'Al Nahda', emirate: 'SHJ', coords: [55.36, 25.31], model: 'M4TD' },
  { id: 'SHJ-009', name: 'Al Majaz', emirate: 'SHJ', coords: [55.38, 25.33], model: 'M4TD' },
  { id: 'SHJ-010', name: 'University City', emirate: 'SHJ', coords: [55.49, 25.3], model: 'M4TD' },
  { id: 'SHJ-011', name: 'Al Suyoh', emirate: 'SHJ', coords: [55.47, 25.36], model: 'M4TD' },
  { id: 'SHJ-012', name: 'Al Rahmaniya', emirate: 'SHJ', coords: [55.43, 25.33], model: 'M4D' },

  // ===== AJM — Ajman (4) =====
  { id: 'AJM-001', name: 'Ajman City', emirate: 'AJM', coords: [55.44, 25.4], model: 'M4TD' },
  { id: 'AJM-002', name: 'Al Zorah', emirate: 'AJM', coords: [55.45, 25.43], model: 'M4D' },
  { id: 'AJM-003', name: 'Manama', emirate: 'AJM', coords: [55.75, 25.33], model: 'M4TD' },
  { id: 'AJM-004', name: 'Masfout', emirate: 'AJM', coords: [56.05, 24.85], model: 'M4D' },

  // ===== UAQ — Umm Al Quwain (4) =====
  {
    id: 'UAQ-001',
    name: 'Umm Al Quwain City',
    emirate: 'UAQ',
    coords: [55.55, 25.56],
    model: 'M4TD',
  },
  { id: 'UAQ-002', name: 'Falaj Al Mualla', emirate: 'UAQ', coords: [55.86, 25.42], model: 'M4D' },
  { id: 'UAQ-003', name: 'UAQ Marina', emirate: 'UAQ', coords: [55.58, 25.58], model: 'M4D' },
  { id: 'UAQ-004', name: 'Al Salamah', emirate: 'UAQ', coords: [55.62, 25.52], model: 'M4TD' },

  // ===== RAK — Ras Al Khaimah (10) =====
  {
    id: 'RAK-001',
    name: 'Ras Al Khaimah City',
    emirate: 'RAK',
    coords: [55.94, 25.79],
    model: 'M4TD',
  },
  { id: 'RAK-002', name: 'Al Hamra', emirate: 'RAK', coords: [55.78, 25.69], model: 'M4TD' },
  { id: 'RAK-003', name: 'Mina Al Arab', emirate: 'RAK', coords: [55.83, 25.72], model: 'M4D' },
  { id: 'RAK-004', name: 'Khatt', emirate: 'RAK', coords: [56.05, 25.65], model: 'M4D' },
  { id: 'RAK-005', name: 'Jebel Jais', emirate: 'RAK', coords: [56.18, 25.95], model: 'M4D' },
  { id: 'RAK-006', name: 'Al Rams', emirate: 'RAK', coords: [56.02, 25.87], model: 'M4TD' },
  { id: 'RAK-007', name: 'Shaam', emirate: 'RAK', coords: [56.09, 26.02], model: 'M4D' },
  { id: 'RAK-008', name: 'Digdaga', emirate: 'RAK', coords: [55.97, 25.63], model: 'M4TD' },
  { id: 'RAK-009', name: 'Ghalilah', emirate: 'RAK', coords: [56.07, 25.93], model: 'M4D' },
  { id: 'RAK-010', name: 'RAK Port', emirate: 'RAK', coords: [55.95, 25.81], model: 'M350' },

  // ===== FUJ — Fujairah (8) =====
  { id: 'FUJ-001', name: 'Fujairah City', emirate: 'FUJ', coords: [56.34, 25.12], model: 'M4TD' },
  { id: 'FUJ-002', name: 'Fujairah Port', emirate: 'FUJ', coords: [56.36, 25.18], model: 'M350' },
  { id: 'FUJ-003', name: 'Dibba', emirate: 'FUJ', coords: [56.26, 25.59], model: 'M4TD' },
  { id: 'FUJ-004', name: 'Masafi', emirate: 'FUJ', coords: [56.16, 25.3], model: 'M4D' },
  { id: 'FUJ-005', name: 'Qidfa', emirate: 'FUJ', coords: [56.36, 25.3], model: 'M4D' },
  { id: 'FUJ-006', name: 'Al Bidiyah', emirate: 'FUJ', coords: [56.35, 25.44], model: 'M4D' },
  { id: 'FUJ-007', name: 'Mirbah', emirate: 'FUJ', coords: [56.37, 25.28], model: 'M4D' },
  {
    id: 'FUJ-008',
    name: 'Fujairah Free Zone',
    emirate: 'FUJ',
    coords: [56.35, 25.15],
    model: 'M350',
  },

  // ===== AAN — Al Ain region (12, administratively Abu Dhabi) =====
  { id: 'AAN-001', name: 'Al Ain', emirate: 'AAN', coords: [55.745, 24.207], model: 'M4TD' },
  { id: 'AAN-002', name: 'Hili', emirate: 'AAN', coords: [55.76, 24.29], model: 'M4TD' },
  { id: 'AAN-003', name: 'Al Jimi', emirate: 'AAN', coords: [55.735, 24.245], model: 'M4TD' },
  { id: 'AAN-004', name: 'Zakher', emirate: 'AAN', coords: [55.7, 24.16], model: 'M4D' },
  { id: 'AAN-005', name: 'Al Faqa', emirate: 'AAN', coords: [55.62, 24.72], model: 'M4D' },
  { id: 'AAN-006', name: 'Remah', emirate: 'AAN', coords: [55.3, 24.1], model: 'M4D' },
  { id: 'AAN-007', name: 'Sweihan', emirate: 'AAN', coords: [55.33, 24.47], model: 'M4D' },
  { id: 'AAN-008', name: 'Al Hayer', emirate: 'AAN', coords: [55.77, 24.52], model: 'M4D' },
  { id: 'AAN-009', name: 'Green Mubazzarah', emirate: 'AAN', coords: [55.74, 24.1], model: 'M4TD' },
  { id: 'AAN-010', name: 'Al Qattara', emirate: 'AAN', coords: [55.755, 24.265], model: 'M4TD' },
  { id: 'AAN-011', name: 'Al Yahar', emirate: 'AAN', coords: [55.58, 24.22], model: 'M4TD' },
  { id: 'AAN-012', name: 'Nahel', emirate: 'AAN', coords: [55.7, 24.63], model: 'M4D' },
]
