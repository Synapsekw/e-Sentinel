// Ported from assets/js/ui/panels.js:2-5 (EMIRATE_NAMES), :2064
// (EMIRATE_ORDER) and :1950 (FILTER_KEYS).
import type { FilterKey } from '@/shared/store'

export const EMIRATE_NAMES: Record<string, string> = {
  AUH: 'Abu Dhabi',
  DXB: 'Dubai',
  SHJ: 'Sharjah',
  AJM: 'Ajman',
  UAQ: 'Umm Al Quwain',
  RAK: 'Ras Al Khaimah',
  FUJ: 'Fujairah',
  AAN: 'Al Ain',
}

export const EMIRATE_ORDER = Object.keys(EMIRATE_NAMES)

export const FILTER_KEYS: FilterKey[] = [
  'ALL',
  'AUH',
  'DXB',
  'SHJ',
  'AJM',
  'UAQ',
  'RAK',
  'FUJ',
  'AAN',
  'FLYING',
  'ALERTS',
]
