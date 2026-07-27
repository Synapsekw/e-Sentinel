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

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { DJILog } from '../app/node_modules/dji-log-parser-js/dji_log_parser_js.mjs'

const FLIGHTS_DIR = join(import.meta.dirname, '..', 'app', 'public', 'flights')
const ENDPOINT = 'https://dev.dji.com/openapi/v1/flight-records/keychains'
const dryRun = process.argv.includes('--dry-run')
// Refetch keychains even when a <id>.keychain.json is already on disk.
const force = process.argv.includes('--force')

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

  const keychainPath = join(FLIGHTS_DIR, `${id}.keychain.json`)

  if (!dryRun && version >= 13) {
    // Skip logs whose keychain is already on disk. DJI's endpoint is a remote
    // dependency and the keys do not change; re-running the tool to pick up
    // one new log should not re-request keys for every old one. Use --force to
    // refetch anyway.
    if (existsSync(keychainPath) && !force) {
      console.log(`  skip ${id}  v${version}  keychain already present`)
    } else {
      try {
        const keychains = await fetchKeychains(parser, key)
        writeFileSync(keychainPath, JSON.stringify(keychains))
        console.log(`  ok   ${id}  v${version}  keychain baked`)
      } catch (err) {
        failures++
        console.error(`  FAIL ${id}  v${version}  ${err.message}`)
      }
    }
  } else {
    console.log(
      `  ${dryRun ? 'dry ' : 'ok  '} ${id}  v${version}  ${dryRun ? 'catalog only' : 'no keychain needed'}`,
    )
  }

  // Derived from what is actually on disk, NOT from what this run happened to
  // do. Deriving it from the run made --dry-run rewrite a good catalog with
  // hasKeychain:false while the keychain files sat right there, so every
  // flight rendered as FRAMES LOCKED despite being fully decodable.
  const hasKeychain = version < 13 || existsSync(keychainPath)

  flights.push(catalogEntry(id, file, version, details, hasKeychain))
}

// A dry run must not write. It exists to show what WOULD be produced without
// touching the network or a key; writing index.json made it destructive, which
// is the opposite of what the name promises.
if (dryRun) {
  console.log(`\n--dry-run: index.json NOT written. Would contain ${flights.length} flight(s):`)
  for (const f of flights) {
    console.log(`  ${f.id}  ${f.aircraftSn}  ${f.durationS}s  keychain:${f.hasKeychain}`)
  }
} else {
  writeFileSync(
    join(FLIGHTS_DIR, 'index.json'),
    JSON.stringify({ version: 1, flights }, null, 2) + '\n',
  )
  console.log(`\nwrote index.json with ${flights.length} flight(s)`)
}

if (failures > 0) {
  console.error(`${failures} keychain fetch(es) failed; those flights show metadata only`)
  process.exit(1)
}
