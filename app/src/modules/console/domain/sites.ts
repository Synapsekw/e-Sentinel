// Ported (Phase 1A / Task 2) verbatim from assets/js/data/sites.js.
// Only the module wiring changed (IIFE + global-attach -> ES module
// exports + type annotations); data values are transcribed exactly.

import type { Site } from './types'

export const DATA_SITES: Site[] = [
  // ===== AAN region — installed (7) =====
  { id: 'AAN3198', name: 'AAN3198', coords: [55.74855, 24.30247], status: 'installed' },
  { id: 'AAN367', name: 'AAN367', coords: [55.73797, 24.15002], status: 'installed' },
  { id: 'AAN335', name: 'AAN335', coords: [55.71325, 24.12025], status: 'installed' },
  { id: 'AAN3165', name: 'AAN3165', coords: [55.41096, 23.90509], status: 'installed' },
  { id: 'AAN393', name: 'AAN393', coords: [55.43455, 24.19889], status: 'installed' },
  { id: 'AAN3002', name: 'AAN3002', coords: [55.30959, 24.13174], status: 'installed' },
  { id: 'AAN3015', name: 'AAN3015', coords: [55.28236, 24.17465], status: 'installed' },

  // ===== AUH region — installed (6) =====
  { id: 'AUH140', name: 'AUH140', coords: [54.8161, 24.22098], status: 'installed' },
  { id: 'AUH127', name: 'AUH127', coords: [54.7061, 24.25757], status: 'installed' },
  { id: 'AUH1376', name: 'AUH1376', coords: [54.71223, 24.35448], status: 'installed' },
  { id: 'AUH158', name: 'AUH158', coords: [54.7688, 24.4225], status: 'installed' },
  { id: 'AUH136', name: 'AUH136', coords: [54.5132, 24.41214], status: 'installed' },
  { id: 'AUH109', name: 'AUH109', coords: [54.35471, 24.46012], status: 'installed' },

  // ===== AUH region — not yet installed (4) =====
  { id: 'AUH1284', name: 'AUH1284', coords: [54.46215, 24.34387], status: 'not-installed' },
  { id: 'AUH110', name: 'AUH110', coords: [54.69729, 24.56038], status: 'not-installed' },
  { id: 'AUH1377', name: 'AUH1377', coords: [54.6731, 24.2991], status: 'not-installed' },
  { id: 'AUH1383', name: 'AUH1383', coords: [55.09369, 24.12939], status: 'not-installed' },

  // ===== AUH region — needs replacement (2) =====
  { id: 'AUH165', name: 'AUH165', coords: [54.82644, 24.73646], status: 'replace' },
  { id: 'AUH1285', name: 'AUH1285', coords: [54.61264, 24.40395], status: 'replace' },
]
