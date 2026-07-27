// Bakes DJI flight logs into assets the browser can use offline.
//
// Two outputs per run:
//   <id>.keychain.json  the AES keychains that decrypt one log's frames
//   index.json          the catalog, built from each log's UNENCRYPTED
//                       details block
//
// The catalog half needs no API key at all, which is why --dry-run works
// without one and why a failed keychain fetch still leaves a usable module.
//
// Lives at the repo root rather than under app/ because it is a Node build
// tool, not app source: app/tsconfig.json includes only src/, and app's
// eslint/prettier run from app/. Precedent: the removed tools/bake-geo.mjs.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { DJILog } from '../app/node_modules/dji-log-parser-js/dji_log_parser_js.mjs'

const FLIGHTS_DIR = join(import.meta.dirname, '..', 'app', 'public', 'flights')
const ENDPOINT = 'https://dev.dji.com/openapi/v1/flight-records/keychains'
const dryRun = process.argv.includes('--dry-run')

function apiKey() {
  if (process.env.DJI_API_KEY) return process.env.DJI_API_KEY
  const envPath = join(import.meta.dirname, '..', '.env')
  const match = readFileSync(envPath, 'utf8').match(/^DJI_API_KEY=(.+)$/m)
  if (!match) throw new Error('DJI_API_KEY not found in environment or .env')
  return match[1].trim()
}

async function fetchKeychains(parser, key) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Api-Key': key },
    body: JSON.stringify(parser.keychainsRequest()),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  const json = await res.json()
  if (json.result?.code !== 0) throw new Error(`DJI error ${json.result?.code}: ${json.result?.msg}`)
  return json.data
}

// Details.totalDistance is documented as metres but reads 10.58 for a
// 35-minute flight at up to 17 m/s. It is kilometres. Verified against
// decoded frames; see spec section 3.2.
function catalogEntry(id, file, version, details, hasKeychain) {
  return {
    id,
    file,
    version,
    encrypted: version >= 13,
    hasKeychain,
    aircraftName: details.aircraftName,
    aircraftSn: details.aircraftSn,
    startTime: details.startTime,
    durationS: details.totalTime,
    distanceKm: details.totalDistance,
    maxHeightM: details.maxHeight,
    maxSpeedMs: details.maxHorizontalSpeed,
    recordCount: details.recordLineCount,
    home: { lon: details.longitude, lat: details.latitude },
  }
}

const logs = readdirSync(FLIGHTS_DIR).filter((f) => f.endsWith('.txt')).sort()
if (logs.length === 0) {
  console.error(`no .txt logs in ${FLIGHTS_DIR}`)
  process.exit(1)
}

const key = dryRun ? null : apiKey()
const flights = []
let failures = 0

for (const file of logs) {
  const id = basename(file, '.txt')
  const bytes = new Uint8Array(readFileSync(join(FLIGHTS_DIR, file)))
  const parser = new DJILog(bytes)
  const version = parser.version
  const details = parser.details

  let hasKeychain = false
  if (!dryRun && version >= 13) {
    try {
      const keychains = await fetchKeychains(parser, key)
      writeFileSync(join(FLIGHTS_DIR, `${id}.keychain.json`), JSON.stringify(keychains))
      hasKeychain = true
      console.log(`  ok   ${id}  v${version}  keychain baked`)
    } catch (err) {
      failures++
      console.error(`  FAIL ${id}  v${version}  ${err.message}`)
    }
  } else {
    hasKeychain = version < 13
    console.log(`  ${dryRun ? 'dry ' : 'ok  '} ${id}  v${version}  ${dryRun ? 'catalog only' : 'no keychain needed'}`)
  }

  flights.push(catalogEntry(id, file, version, details, hasKeychain))
}

writeFileSync(join(FLIGHTS_DIR, 'index.json'), JSON.stringify({ version: 1, flights }, null, 2) + '\n')
console.log(`\nwrote index.json with ${flights.length} flight(s)`)

if (failures > 0) {
  console.error(`${failures} keychain fetch(es) failed; those flights show metadata only`)
  process.exit(1)
}
