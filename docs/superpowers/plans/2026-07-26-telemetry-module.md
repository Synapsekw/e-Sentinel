# Telemetry Module 03 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/telemetry` — a flight review module that decodes real DJI TXT flight logs and replays them on a map with a scrubber and live telemetry readouts.

**Architecture:** Two stages. A Node tool bakes DJI keychains and a catalog offline into `app/public/flights/`. At runtime a Web Worker decodes a log to a compact normalized `FlightPath`; everything above that seam (map, scrubber, panel, filters) knows only `FlightPath` and has never heard of DJI. Decoded paths are cached in IndexedDB.

**Tech Stack:** React 18, TypeScript, Vite 6, MapLibre GL, zustand, Vitest, `dji-log-parser-js` (Rust/WASM).

**Spec:** `docs/superpowers/specs/2026-07-26-telemetry-module-design.md`

## Progress

- [x] **Task 1** — deps + `.env.example` (`3a1719f`)
- [x] **Task 2** — logs staged locally, NOT committed (gitignored; no commit by design)
- [x] **Task 3** — bake tool + keychains generated locally (`5b1afc0`, fixed in `22fb60e`)
- [x] **Task 4** — domain types (`795aa3a`)
- [x] **Task 5** — flight path queries (`8600ee2`)
- [x] **Task 6** — catalog filters and sorting (`ba58088`)
- [x] **Task 7** — telemetry formatting (`20cab87`)
- [x] **Task 8** — catalog loading and validation (`7832078`)
- [x] **Task 9** — frame normalization (`a590305`, corrupt-clock fix in `14b1960`)
- [x] **Task 10** — decode worker and client (`e97b2896`)
- [x] **Task 11** — decoded path cache
- [ ] Task 12 onward — store, map, UI

The whole `io/` layer is done. Everything above this line is pure logic plus the
build tool; nothing renders yet.

**Decision recorded 2026-07-27, after Task 4:** the flight logs, keychains and `index.json
are gitignored rather than committed, because this repo is public and the Pages workflow
publishes `app/public/`. Tasks 2, 3, 25 and 26 above were rewritten accordingly, and the
history that briefly contained the logs was rewound before anything was pushed. See spec
section 5.2.

---

## Conventions this plan assumes

Read these before Task 1; they are not obvious from the file tree.

- **Working directory is `app/`** for every `npm` command. The repo root proxies via `pnpm`/`npm run`, but tasks below assume `cd app`.
- **Vitest defaults to `environment: 'node'`** (`app/vite.config.ts`). Any test that renders React MUST start with the line `// @vitest-environment jsdom` as its very first line.
- **jest-dom matchers are not global.** There is no `test.setupFiles`. Any file using `toBeInTheDocument` must `import '@testing-library/jest-dom'` itself.
- **`test.globals: true` is set**, so `@testing-library/react` auto-cleanup registers. Existing files still call `cleanup()` in `afterEach` explicitly; follow that.
- **Path alias `@/` → `app/src/`.**
- **Map hooks must guard with `isMapUsable`** from `@/modules/console/map/mapLifecycle` before touching sources. Route unmount removes the map parent-first, so an unguarded `getSource` throws.
- **No em dashes in user-facing copy** (house convention, see `modules/landing/modules.ts`).
- **Vocabulary:** *flight*, *flight path*, *frame*. Never *track* — that word means detected ground targets in `modules/console`.
- **Never select a store ACTION through a zustand selector.** `const setFoo = useTelemetryStore((s) => s.setFoo)` trips `@typescript-eslint/unbound-method`, which is an error here (`--max-warnings 0`). Call actions in place: `useTelemetryStore.getState().setFoo(x)`. Select only STATE through the hook, since state is what must trigger a re-render — actions are stable and do not. `planner/ui/Planner.tsx` uses the same split. This bit Tasks 12, 14 and 16 before it was written down; the component code blocks below have been corrected, but check any you add.
- **Pre-commit hook runs `eslint . --max-warnings 0` and `prettier --check .` from `app/`.** Files under the repo-root `tools/` are outside `app/` and therefore outside both. Keep that file plain and simple.

---

## File Structure

### Created — repo root

| File | Responsibility |
|---|---|
| `.env.example` | Documents `DJI_API_KEY`. Committed. The real `.env` is gitignored and already populated. |
| `tools/bake-flights.mjs` | Node. Reads `app/public/flights/*.txt`, fetches keychains from DJI, writes `<id>.keychain.json` and `index.json`. Never runs in the browser. |

### Created — `app/public/flights/` (LOCAL ONLY, gitignored)

**None of these are committed.** This repo is public and the Pages workflow copies
`app/public/` into the deployed site, so real flight coordinates, aircraft serials and
frame-decryption keys stay on the developer's machine. Only `README.md` is tracked.

| File | Responsibility |
|---|---|
| `README.md` | **Committed.** Explains why the directory is empty and how to populate it. |
| `m400-2026-02-17-0627.txt` | Real DJI log, serial `…258U00A`, 27,229 records. Gitignored. |
| `m400-2026-02-17-0652.txt` | Real DJI log, serial `…259400A`, 20,915 records. Gitignored. |
| `m400-2026-02-17-0846.txt` | Real DJI log, serial `…257P00D`, name `dji aircraft`, 5,050 records. Gitignored. |
| `*.keychain.json` | Baked AES keychains, one per log. Generated by the tool. Gitignored. |
| `index.json` | The catalog. Generated by the tool. Gitignored. |

### Created — `app/src/modules/telemetry/`

| File | Responsibility |
|---|---|
| `domain/types.ts` | `FlightMeta`, `FlightSample`, `FlightPath`, `FlightCatalog`, `CatalogFilters`, `CatalogSort`, `NORMALIZER_VERSION`. No logic. |
| `domain/flightPath.ts` | Pure queries over a `FlightPath`: `sampleAt`, `pathBounds`, `distanceFromHomeM`, `traversedCoords`, `allCoords`. |
| `domain/filters.ts` | Pure catalog filtering, sorting, and aircraft option derivation. |
| `domain/format.ts` | Telemetry-specific formatting not already in `console/chrome/format.ts`. |
| `io/djiLog.worker.ts` | The ONLY file importing `dji-log-parser-js`. Decodes and normalizes. |
| `io/parseFlight.ts` | Worker client. Posts bytes, awaits a `FlightPath`. |
| `io/flightCache.ts` | IndexedDB get/put, keyed by flight id + `NORMALIZER_VERSION`. |
| `io/catalogIo.ts` | Fetch and validate `index.json`. |
| `map/telemetryStyle.ts` | Style spec + pure GeoJSON feature builders. |
| `map/useFlightLayers.ts` | Feeds those sources imperatively from the current path and cursor. |
| `store/telemetryStore.ts` | zustand: catalog, filters, sort, selection, path, cursor, playback. |
| `ui/Telemetry.tsx` | Route root. Composes chrome around `MapView`. |
| `ui/TelemetryTopbar.tsx` | Brand home link, offline chip, `LAYERS ▾`, `LOAD LOG`. |
| `ui/FlightLibrary.tsx` | Grouped, filtered flight list. |
| `ui/LibraryFilters.tsx` | Aircraft / date / duration / text controls. |
| `ui/FramePanel.tsx` | Static summary block + cursor-following readouts. |
| `ui/Scrubber.tsx` | Play/pause, rate, draggable cursor. |
| `ui/telemetry.css` | `tm-*` class names, mirroring `planner.css`'s isolation approach. |

### Modified

| File | Change |
|---|---|
| `app/package.json` | Add `dji-log-parser-js` dep, `fake-indexeddb` devDep. |
| `app/src/App.tsx` | `/telemetry` → `lazy(() => import('./modules/telemetry/ui/Telemetry'))`. |
| `app/src/modules/landing/modules.ts` | Module 03 → `online`, new blurb. |
| `README.md` | Document the module and the bake tool. |

---

## Task 1: Dependencies and environment scaffold

**Files:**
- Modify: `app/package.json`
- Create: `.env.example`

- [ ] **Step 1: Install the parser and the IndexedDB test double**

```bash
cd app
npm install dji-log-parser-js@0.5.7
npm install --save-dev fake-indexeddb@6.0.0
```

`fake-indexeddb` is needed because `flightCache.ts` (Task 10) is tested under Vitest's `node` environment, which has no `indexedDB` global.

- [ ] **Step 2: Verify the parser resolves and reports the expected version**

```bash
cd app
node -e "import('dji-log-parser-js').then(m => console.log(typeof m.DJILog))"
```

Expected: `function`

- [ ] **Step 3: Create `.env.example` at the repo root**

```
# Key for DJI's flight-record keychain API, used ONLY by tools/bake-flights.mjs
# under Node. Obtain from https://developer.dji.com/user -> CREATE APP ->
# Open API. The value is shown as the "SDK key".
#
# Deliberately NOT prefixed with VITE_. That prefix would inline the secret
# into the client bundle, which is exactly what baking keychains offline exists
# to avoid.
DJI_API_KEY=
```

- [ ] **Step 4: Confirm the real `.env` is present and ignored**

```bash
cd /Users/danijeljovanovic/Dev/e\&_Sentinel
test -s .env && echo "env present"
git check-ignore -v .env
```

Expected: `env present`, then a line showing `.gitignore` matches `.env`. If `.env` is missing, stop — Task 3 cannot run without it.

- [ ] **Step 5: Commit**

```bash
git add app/package.json app/package-lock.json .env.example
git commit -m "build: add dji-log-parser-js and document DJI_API_KEY"
```

---

## Task 2: Stage the flight logs

**Files:**
- Create: `app/public/flights/m400-2026-02-17-0627.txt`
- Create: `app/public/flights/m400-2026-02-17-0652.txt`
- Create: `app/public/flights/m400-2026-02-17-0846.txt`

Slugs are derived from each log's UTC start time (verified in spec section 3.2). Original DJI filenames contain brackets, which are avoidable trouble in asset URLs.

- [ ] **Step 1: Copy the logs under URL-safe names**

```bash
cd /Users/danijeljovanovic/Dev/e\&_Sentinel
mkdir -p app/public/flights
cp ~/Downloads/"5_DJIFlightRecord_2026-02-17_[09-27-04].txt"  app/public/flights/m400-2026-02-17-0627.txt
cp ~/Downloads/"15_DJIFlightRecord_2026-02-17_[09-52-28].txt" app/public/flights/m400-2026-02-17-0652.txt
cp ~/Downloads/"15_DJIFlightRecord_2026-02-17_[11-46-26].txt" app/public/flights/m400-2026-02-17-0846.txt
```

- [ ] **Step 2: Verify all three landed with the expected sizes**

```bash
ls -l app/public/flights/
```

Expected: three files, approximately 9.1 MB, 6.9 MB and 3.5 MB.

- [ ] **Step 3: Confirm they are gitignored, and do NOT commit them**

```bash
git status --short app/public/flights/
git check-ignore -v app/public/flights/m400-2026-02-17-0627.txt
```

Expected: `git status` reports nothing for the `.txt` files, and `check-ignore` shows
`.gitignore` matching them. There is no commit in this task — the logs are local-only
(see the file-structure note above). If `git status` offers to add a `.txt`, STOP: the
ignore rule is broken and committing would publish real flight data to a public repo.

---

## Task 3: The bake tool

**Files:**
- Create: `tools/bake-flights.mjs`
- Create (generated): `app/public/flights/index.json`, `app/public/flights/*.keychain.json`

Not unit-tested — it needs both network and a secret (spec section 10). Its `--dry-run` path is the manual check, and the app validates its output independently in Task 11.

- [ ] **Step 1: Write the tool**

```js
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
    // dependency and the keys do not change. Use --force to refetch anyway.
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
// touching the network or a key; writing index.json made it destructive,
// which is the opposite of what the name promises.
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
```

- [ ] **Step 2: Run the dry run to verify catalog generation with no network**

```bash
cd /Users/danijeljovanovic/Dev/e\&_Sentinel
node tools/bake-flights.mjs --dry-run
```

Expected: three `dry` lines showing `v14`, then `--dry-run: index.json NOT written.` followed by the catalog it would produce, exit 0. It must NOT write `index.json`.

- [ ] **Step 3: Verify the dry-run catalog content**

Read it from the dry run's own stdout in Step 2 — there is no `index.json` to inspect
yet, by design. The three catalog lines it prints must show exactly:

```
m400-2026-02-17-0627  1581F8DBW258U00A  2722.9s  keychain:false
m400-2026-02-17-0652  1581F8DBW259400A  2092.3s  keychain:false
m400-2026-02-17-0846  1581F5FKC257P00D  1009.6s  keychain:false
```

`keychain:false` is correct here: none have been fetched yet. If the serials differ, the wrong files were staged in Task 2. Stop and fix.

- [ ] **Step 4: Run the real bake**

```bash
cd /Users/danijeljovanovic/Dev/e\&_Sentinel
node tools/bake-flights.mjs
```

Expected: three `ok … keychain baked` lines, `wrote index.json with 3 flight(s)`, exit 0. Each request takes roughly 1.3 s.

- [ ] **Step 5: Verify the keychains are real and decrypt frames**

```bash
cd /Users/danijeljovanovic/Dev/e\&_Sentinel
node -e "
const fs=require('fs');
import('./app/node_modules/dji-log-parser-js/dji_log_parser_js.mjs').then(({DJILog})=>{
  const id='m400-2026-02-17-0846';
  const p=new DJILog(new Uint8Array(fs.readFileSync('app/public/flights/'+id+'.txt')));
  const kc=JSON.parse(fs.readFileSync('app/public/flights/'+id+'.keychain.json','utf8'));
  const frames=p.frames(kc);
  const withCoords=frames.filter(f=>f.osd.latitude||f.osd.longitude).length;
  console.log('frames',frames.length,'withCoords',withCoords);
});
"
```

Expected: `frames 5049 withCoords 5049` (or 5050/5050 — the exact count may be off by one; what matters is that *every* frame has coordinates, not zero).

- [ ] **Step 6: Commit**

```bash
git add tools/bake-flights.mjs app/.prettierignore .gitignore app/public/flights/README.md
git commit -m "feat(telemetry): bake DJI keychains locally, never into the repo"
```

Stage the TOOL and its config only. `index.json` and the `.keychain.json` files are
gitignored and must never appear in the staged set — verify with `git show --stat HEAD`
that no `.txt`, `.keychain.json` or `index.json` is listed.

`app/.prettierignore` needs a `public/flights/` entry: the generated keychains are
single-line JSON and the pre-commit hook's `prettier --check .` would otherwise fail on
them, even though they are untracked. Precedent: that file already exempts `dist` and
`package-lock.json` for the same reason.

---

## Task 4: Domain types

**Files:**
- Create: `app/src/modules/telemetry/domain/types.ts`

Types only, no logic, so no test. Every later task depends on these names being exact.

- [ ] **Step 1: Write the types**

```ts
// The telemetry module's vocabulary. `flight` is one log, `flight path` is
// its geometry, `frame`/`sample` is one point in time. Deliberately NOT
// `track`: modules/console already owns that word for detected ground
// targets (see console/panels/TrackPanel.tsx).

// Bump when the shape of FlightSample or the normalization in
// io/djiLog.worker.ts changes. io/flightCache.ts keys cached paths on it, so
// a bump invalidates stale entries instead of silently serving them.
export const NORMALIZER_VERSION = 1

// One catalog row. Every field here comes from a DJI log's UNENCRYPTED
// details block, which is why the library renders in full without a keychain.
export interface FlightMeta {
  id: string
  file: string
  version: number
  encrypted: boolean
  hasKeychain: boolean
  aircraftName: string
  aircraftSn: string
  startTime: string
  durationS: number
  distanceKm: number
  maxHeightM: number
  maxSpeedMs: number
  recordCount: number
  home: { lon: number; lat: number }
}

export interface FlightCatalog {
  version: 1
  flights: FlightMeta[]
}

// The normalization seam. DJI's Frame carries ~100 fields and serializes to
// 65MB for a 27k-record log; this is the 13-field subset the UI actually
// reads. Nothing above io/ ever sees a DJI type.
export interface FlightSample {
  t: number
  lon: number
  lat: number
  alt: number
  height: number
  speedH: number
  speedV: number
  heading: number
  gimbalPitch: number
  battery: number
  voltage: number
  sats: number
  mode: string
}

export interface FlightPath {
  meta: FlightMeta
  samples: FlightSample[]
}

export interface CatalogFilters {
  aircraftSn: string | null
  from: string | null
  to: string | null
  minDurationS: number
  text: string
}

export type CatalogSort = 'newest' | 'oldest' | 'duration' | 'distance'

export const NO_FILTERS: CatalogFilters = {
  aircraftSn: null,
  from: null,
  to: null,
  minDurationS: 0,
  text: '',
}
```

- [ ] **Step 2: Typecheck**

```bash
cd app && npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/modules/telemetry/domain/types.ts
git commit -m "feat(telemetry): define the flight path domain types"
```

---

## Task 5: Flight path queries

**Files:**
- Create: `app/src/modules/telemetry/domain/flightPath.ts`
- Test: `app/src/modules/telemetry/domain/flightPath.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import {
  sampleAt,
  pathBounds,
  distanceFromHomeM,
  traversedCoords,
  allCoords,
} from './flightPath'
import type { FlightMeta, FlightPath, FlightSample } from './types'

const meta: FlightMeta = {
  id: 'test',
  file: 'test.txt',
  version: 14,
  encrypted: true,
  hasKeychain: true,
  aircraftName: 'Matrice 400',
  aircraftSn: 'SN1',
  startTime: '2026-02-17T06:27:04.690Z',
  durationS: 30,
  distanceKm: 1,
  maxHeightM: 100,
  maxSpeedMs: 10,
  recordCount: 4,
  home: { lon: 48.0, lat: 28.78 },
}

function sample(over: Partial<FlightSample>): FlightSample {
  return {
    t: 0, lon: 48.0, lat: 28.78, alt: 0, height: 0, speedH: 0, speedV: 0,
    heading: 0, gimbalPitch: 0, battery: 100, voltage: 50, sats: 20,
    mode: 'GPSAtti', ...over,
  }
}

const path: FlightPath = {
  meta,
  samples: [
    sample({ t: 0, lon: 48.0, lat: 28.78, height: 0, battery: 100, heading: 10, mode: 'AutoTakeoff' }),
    sample({ t: 10, lon: 48.01, lat: 28.79, height: 50, battery: 90, heading: 350, mode: 'GPSWaypoint' }),
    sample({ t: 20, lon: 48.02, lat: 28.80, height: 100, battery: 80, heading: 180, mode: 'GPSWaypoint' }),
  ],
}

describe('sampleAt', () => {
  it('returns null for an empty path', () => {
    expect(sampleAt({ meta, samples: [] }, 5)).toBeNull()
  })

  it('clamps below the first sample', () => {
    expect(sampleAt(path, -10)?.height).toBe(0)
  })

  it('clamps above the last sample', () => {
    expect(sampleAt(path, 999)?.height).toBe(100)
  })

  it('returns an exact sample on a boundary', () => {
    expect(sampleAt(path, 10)?.height).toBe(50)
  })

  it('interpolates continuous fields between samples', () => {
    const s = sampleAt(path, 5)
    expect(s?.height).toBeCloseTo(25)
    expect(s?.battery).toBeCloseTo(95)
    expect(s?.lon).toBeCloseTo(48.005)
  })

  // Heading is circular: interpolating 10 -> 350 linearly sweeps the long way
  // round through 180, which would spin the map marker backwards through a
  // half turn. Nearest-sample is correct and cheap; the same applies to the
  // discrete fields (mode, sats).
  it('takes heading from the nearest sample rather than interpolating', () => {
    expect(sampleAt(path, 1)?.heading).toBe(10)
    expect(sampleAt(path, 9)?.heading).toBe(350)
  })

  it('takes mode from the nearest sample', () => {
    expect(sampleAt(path, 1)?.mode).toBe('AutoTakeoff')
    expect(sampleAt(path, 9)?.mode).toBe('GPSWaypoint')
  })
})

describe('pathBounds', () => {
  it('returns null for an empty path', () => {
    expect(pathBounds({ meta, samples: [] })).toBeNull()
  })

  it('returns southwest and northeast corners', () => {
    expect(pathBounds(path)).toEqual([
      [48.0, 28.78],
      [48.02, 28.8],
    ])
  })
})

describe('distanceFromHomeM', () => {
  it('is zero at the home point', () => {
    expect(distanceFromHomeM(path.samples[0], meta.home)).toBeCloseTo(0, 1)
  })

  // 0.01 degrees of latitude is ~1113m; the sample is offset in both axes.
  it('grows with distance', () => {
    const d = distanceFromHomeM(path.samples[1], meta.home)
    expect(d).toBeGreaterThan(1000)
    expect(d).toBeLessThan(2000)
  })
})

describe('traversedCoords', () => {
  it('is empty before the first sample', () => {
    expect(traversedCoords(path, -1)).toEqual([])
  })

  it('includes only samples up to the cursor', () => {
    expect(traversedCoords(path, 10)).toEqual([
      [48.0, 28.78],
      [48.01, 28.79],
    ])
  })

  it('includes every sample past the end', () => {
    expect(traversedCoords(path, 999)).toHaveLength(3)
  })
})

describe('allCoords', () => {
  it('returns every coordinate pair', () => {
    expect(allCoords(path)).toHaveLength(3)
    expect(allCoords(path)[2]).toEqual([48.02, 28.8])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app && npx vitest run src/modules/telemetry/domain/flightPath.test.ts
```

Expected: FAIL — cannot resolve `./flightPath`.

- [ ] **Step 3: Write the implementation**

```ts
// Pure queries over a decoded FlightPath. No React, no MapLibre, no DJI.
// This is the layer every UI component reads through.

import type { FlightPath, FlightSample } from './types'

// Fields safe to interpolate linearly. Deliberately excludes `heading`
// (circular: 350 -> 10 must not sweep through 180), `mode` (an enum label),
// and `sats` (a count). Those come from the nearest sample instead.
const CONTINUOUS = [
  'lon', 'lat', 'alt', 'height', 'speedH', 'speedV', 'gimbalPitch',
  'battery', 'voltage',
] as const

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f
}

// Largest index whose t is <= target. Binary search: a 27k-sample path is
// queried on every animation frame during playback.
function floorIndex(samples: FlightSample[], t: number): number {
  let lo = 0
  let hi = samples.length - 1
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (samples[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

export function sampleAt(path: FlightPath, t: number): FlightSample | null {
  const { samples } = path
  if (samples.length === 0) return null
  if (t <= samples[0].t) return samples[0]
  const last = samples[samples.length - 1]
  if (t >= last.t) return last

  const i = floorIndex(samples, t)
  const a = samples[i]
  const b = samples[i + 1]
  if (!b || b.t === a.t) return a

  const f = (t - a.t) / (b.t - a.t)
  const nearest = f < 0.5 ? a : b
  const out: FlightSample = {
    ...nearest,
    t,
    heading: nearest.heading,
    mode: nearest.mode,
    sats: nearest.sats,
  }
  for (const key of CONTINUOUS) out[key] = lerp(a[key], b[key], f)
  return out
}

export function allCoords(path: FlightPath): [number, number][] {
  return path.samples.map((s) => [s.lon, s.lat])
}

export function traversedCoords(path: FlightPath, t: number): [number, number][] {
  const out: [number, number][] = []
  for (const s of path.samples) {
    if (s.t > t) break
    out.push([s.lon, s.lat])
  }
  return out
}

export function pathBounds(
  path: FlightPath,
): [[number, number], [number, number]] | null {
  if (path.samples.length === 0) return null
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity
  for (const s of path.samples) {
    if (s.lon < minLon) minLon = s.lon
    if (s.lon > maxLon) maxLon = s.lon
    if (s.lat < minLat) minLat = s.lat
    if (s.lat > maxLat) maxLat = s.lat
  }
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ]
}

const EARTH_R_M = 6371000

export function distanceFromHomeM(
  sample: FlightSample,
  home: { lon: number; lat: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(sample.lat - home.lat)
  const dLon = toRad(sample.lon - home.lon)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(home.lat)) * Math.cos(toRad(sample.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_R_M * Math.asin(Math.min(1, Math.sqrt(a)))
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd app && npx vitest run src/modules/telemetry/domain/flightPath.test.ts
```

Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/modules/telemetry/domain/flightPath.ts app/src/modules/telemetry/domain/flightPath.test.ts
git commit -m "feat(telemetry): query a flight path by time"
```

---

## Task 6: Catalog filters and sorting

**Files:**
- Create: `app/src/modules/telemetry/domain/filters.ts`
- Test: `app/src/modules/telemetry/domain/filters.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { filterFlights, sortFlights, aircraftOptions } from './filters'
import { NO_FILTERS } from './types'
import type { FlightMeta } from './types'

function flight(over: Partial<FlightMeta>): FlightMeta {
  return {
    id: 'f', file: 'f.txt', version: 14, encrypted: true, hasKeychain: true,
    aircraftName: 'Matrice 400', aircraftSn: 'SN1',
    startTime: '2026-02-17T06:27:04.690Z',
    durationS: 100, distanceKm: 5, maxHeightM: 50, maxSpeedMs: 10,
    recordCount: 10, home: { lon: 48, lat: 28.78 }, ...over,
  }
}

const a = flight({ id: 'a', aircraftSn: 'SN1', startTime: '2026-02-17T06:27:04Z', durationS: 2722, distanceKm: 22.1 })
const b = flight({ id: 'b', aircraftSn: 'SN2', startTime: '2026-02-17T06:52:28Z', durationS: 2092, distanceKm: 10.6 })
const c = flight({ id: 'c', aircraftSn: 'SN2', startTime: '2026-03-01T08:46:26Z', durationS: 1009, distanceKm: 6.0 })
const all = [a, b, c]

describe('filterFlights', () => {
  it('returns everything with no filters', () => {
    expect(filterFlights(all, NO_FILTERS)).toHaveLength(3)
  })

  it('filters by aircraft serial', () => {
    expect(filterFlights(all, { ...NO_FILTERS, aircraftSn: 'SN2' }).map((f) => f.id)).toEqual(['b', 'c'])
  })

  it('filters by start date inclusive of the from day', () => {
    expect(filterFlights(all, { ...NO_FILTERS, from: '2026-02-17' }).map((f) => f.id)).toEqual(['a', 'b', 'c'])
  })

  // The `to` bound covers the whole named day, not midnight at its start --
  // a user picking 2026-02-17 expects that day's flights included.
  it('includes flights on the to day itself', () => {
    expect(filterFlights(all, { ...NO_FILTERS, to: '2026-02-17' }).map((f) => f.id)).toEqual(['a', 'b'])
  })

  it('filters by minimum duration', () => {
    expect(filterFlights(all, { ...NO_FILTERS, minDurationS: 2000 }).map((f) => f.id)).toEqual(['a', 'b'])
  })

  it('matches text against serial case-insensitively', () => {
    expect(filterFlights(all, { ...NO_FILTERS, text: 'sn2' }).map((f) => f.id)).toEqual(['b', 'c'])
  })

  it('matches text against aircraft name and filename', () => {
    expect(filterFlights(all, { ...NO_FILTERS, text: 'matrice' })).toHaveLength(3)
    expect(filterFlights([a], { ...NO_FILTERS, text: 'f.txt' })).toHaveLength(1)
  })

  it('combines filters conjunctively', () => {
    expect(
      filterFlights(all, { ...NO_FILTERS, aircraftSn: 'SN2', minDurationS: 2000 }).map((f) => f.id),
    ).toEqual(['b'])
  })

  it('returns an empty array when nothing matches', () => {
    expect(filterFlights(all, { ...NO_FILTERS, text: 'nothing' })).toEqual([])
  })
})

describe('sortFlights', () => {
  it('sorts newest first by default ordering', () => {
    expect(sortFlights(all, 'newest').map((f) => f.id)).toEqual(['c', 'b', 'a'])
  })

  it('sorts oldest first', () => {
    expect(sortFlights(all, 'oldest').map((f) => f.id)).toEqual(['a', 'b', 'c'])
  })

  it('sorts by duration descending', () => {
    expect(sortFlights(all, 'duration').map((f) => f.id)).toEqual(['a', 'b', 'c'])
  })

  it('sorts by distance descending', () => {
    expect(sortFlights(all, 'distance').map((f) => f.id)).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate the input array', () => {
    const input = [c, a, b]
    sortFlights(input, 'newest')
    expect(input.map((f) => f.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('aircraftOptions', () => {
  it('returns one entry per distinct serial, sorted by name then serial', () => {
    expect(aircraftOptions(all)).toEqual([
      { sn: 'SN1', name: 'Matrice 400' },
      { sn: 'SN2', name: 'Matrice 400' },
    ])
  })

  it('is empty for an empty catalog', () => {
    expect(aircraftOptions([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app && npx vitest run src/modules/telemetry/domain/filters.test.ts
```

Expected: FAIL — cannot resolve `./filters`.

- [ ] **Step 3: Write the implementation**

```ts
// Pure catalog filtering and sorting. Every filter reads a field that comes
// from a log's unencrypted details block, so the library filters correctly
// whether or not any keychain was baked.

import type { CatalogFilters, CatalogSort, FlightMeta } from './types'

function matchesText(f: FlightMeta, text: string): boolean {
  const q = text.trim().toLowerCase()
  if (q === '') return true
  return (
    f.aircraftName.toLowerCase().includes(q) ||
    f.aircraftSn.toLowerCase().includes(q) ||
    f.file.toLowerCase().includes(q)
  )
}

export function filterFlights(
  flights: FlightMeta[],
  filters: CatalogFilters,
): FlightMeta[] {
  return flights.filter((f) => {
    if (filters.aircraftSn && f.aircraftSn !== filters.aircraftSn) return false

    const start = Date.parse(f.startTime)
    if (filters.from && start < Date.parse(`${filters.from}T00:00:00Z`)) return false
    // Inclusive of the whole `to` day: a user picking a date means that date,
    // not the instant it begins.
    if (filters.to && start > Date.parse(`${filters.to}T23:59:59.999Z`)) return false

    if (f.durationS < filters.minDurationS) return false
    return matchesText(f, filters.text)
  })
}

const COMPARATORS: Record<CatalogSort, (a: FlightMeta, b: FlightMeta) => number> = {
  newest: (a, b) => Date.parse(b.startTime) - Date.parse(a.startTime),
  oldest: (a, b) => Date.parse(a.startTime) - Date.parse(b.startTime),
  duration: (a, b) => b.durationS - a.durationS,
  distance: (a, b) => b.distanceKm - a.distanceKm,
}

// Copies before sorting: the store holds the catalog array, and an in-place
// sort would mutate state a component is already rendering from.
export function sortFlights(flights: FlightMeta[], sort: CatalogSort): FlightMeta[] {
  return [...flights].sort(COMPARATORS[sort])
}

export interface AircraftOption {
  sn: string
  name: string
}

export function aircraftOptions(flights: FlightMeta[]): AircraftOption[] {
  const bySn = new Map<string, AircraftOption>()
  for (const f of flights) {
    if (!bySn.has(f.aircraftSn)) bySn.set(f.aircraftSn, { sn: f.aircraftSn, name: f.aircraftName })
  }
  return [...bySn.values()].sort((a, b) => a.name.localeCompare(b.name) || a.sn.localeCompare(b.sn))
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd app && npx vitest run src/modules/telemetry/domain/filters.test.ts
```

Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/modules/telemetry/domain/filters.ts app/src/modules/telemetry/domain/filters.test.ts
git commit -m "feat(telemetry): filter and sort the flight catalog"
```

---

## Task 7: Telemetry formatting

**Files:**
- Create: `app/src/modules/telemetry/domain/format.ts`
- Test: `app/src/modules/telemetry/domain/format.test.ts`

Only what `console/chrome/format.ts` does not already provide. `fmtMMSS` is reused from there rather than reimplemented.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { fmtFlightClock, fmtDuration, fmtDate, fmtKm, fmtMeters, fmtSpeed, fmtHeading } from './format'

describe('fmtFlightClock', () => {
  it('formats as T+MM:SS', () => {
    expect(fmtFlightClock(0)).toBe('T+00:00')
    expect(fmtFlightClock(862)).toBe('T+14:22')
  })

  it('rolls past an hour without an hours field', () => {
    expect(fmtFlightClock(3661)).toBe('T+61:01')
  })

  it('clamps negatives to zero', () => {
    expect(fmtFlightClock(-5)).toBe('T+00:00')
  })
})

describe('fmtDuration', () => {
  it('formats minutes and seconds', () => {
    expect(fmtDuration(2722.9)).toBe('45m 23s')
    expect(fmtDuration(1009.6)).toBe('16m 50s')
  })

  it('omits minutes under a minute', () => {
    expect(fmtDuration(42)).toBe('42s')
  })
})

describe('fmtDate', () => {
  it('formats an ISO timestamp as UTC date and time', () => {
    expect(fmtDate('2026-02-17T06:27:04.690Z')).toBe('2026-02-17 06:27')
  })

  it('returns a dash for an unparseable value', () => {
    expect(fmtDate('nonsense')).toBe('—')
  })
})

describe('numeric formatters', () => {
  it('formats kilometres to one decimal', () => {
    expect(fmtKm(22.071382)).toBe('22.1 km')
  })

  it('formats metres as a whole number', () => {
    expect(fmtMeters(49.9000015)).toBe('50 m')
  })

  it('formats speed to one decimal', () => {
    expect(fmtSpeed(17.0425949)).toBe('17.0 m/s')
  })

  it('formats heading zero-padded to three digits', () => {
    expect(fmtHeading(9)).toBe('009°')
    expect(fmtHeading(116.9)).toBe('117°')
  })

  // DJI yaw is signed, -180..180; compass headings are 0..359.
  it('normalises negative headings into 0..359', () => {
    expect(fmtHeading(-90)).toBe('270°')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app && npx vitest run src/modules/telemetry/domain/format.test.ts
```

Expected: FAIL — cannot resolve `./format`.

- [ ] **Step 3: Write the implementation**

```ts
// Telemetry-specific display formatting. Anything already in
// console/chrome/format.ts (fmtMMSS, fmtETA, thousands, battLevel) is reused
// from there rather than duplicated here.

import { fmtMMSS } from '@/modules/console/chrome/format'

export function fmtFlightClock(t: number): string {
  return 'T+' + fmtMMSS(Math.max(0, t))
}

export function fmtDuration(totalS: number): string {
  const s = Math.max(0, Math.round(totalS))
  const m = Math.floor(s / 60)
  return m === 0 ? `${s}s` : `${m}m ${String(s % 60).padStart(2, '0')}s`
}

// Logs are UTC and the flights are not in the viewer's timezone, so a local
// rendering would silently shift every timestamp. Formatted as UTC on purpose.
export function fmtDate(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16)
}

export function fmtKm(km: number): string {
  return `${km.toFixed(1)} km`
}

export function fmtMeters(m: number): string {
  return `${Math.round(m)} m`
}

export function fmtSpeed(ms: number): string {
  return `${ms.toFixed(1)} m/s`
}

// DJI reports yaw signed in -180..180; a compass readout wants 0..359.
export function fmtHeading(deg: number): string {
  const norm = ((Math.round(deg) % 360) + 360) % 360
  return `${String(norm).padStart(3, '0')}°`
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd app && npx vitest run src/modules/telemetry/domain/format.test.ts
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/modules/telemetry/domain/format.ts app/src/modules/telemetry/domain/format.test.ts
git commit -m "feat(telemetry): format flight clock, duration and readouts"
```

---

## Task 8: Catalog loading and validation

**Files:**
- Create: `app/src/modules/telemetry/io/catalogIo.ts`
- Test: `app/src/modules/telemetry/io/catalogIo.test.ts`

The app validates the bake tool's output independently, so a malformed `index.json` degrades to an empty library rather than crashing the route (spec section 9).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseCatalog, fetchCatalog } from './catalogIo'

const validFlight = {
  id: 'a', file: 'a.txt', version: 14, encrypted: true, hasKeychain: true,
  aircraftName: 'Matrice 400', aircraftSn: 'SN1',
  startTime: '2026-02-17T06:27:04.690Z',
  // maxHeightM is 104, NOT 50: a sample height of 49.9 also renders '50 m',
  // and getByText then matches two elements. The point of this test is that the
  // summary and the readouts show different numbers from different sources.
  durationS: 2722.9, distanceKm: 22.07, maxHeightM: 104, maxSpeedMs: 17.04,
  recordCount: 27229, home: { lon: 48.004, lat: 28.782 },
}

describe('parseCatalog', () => {
  it('accepts a well-formed catalog', () => {
    expect(parseCatalog({ version: 1, flights: [validFlight] })?.flights).toHaveLength(1)
  })

  it('accepts an empty flight list', () => {
    expect(parseCatalog({ version: 1, flights: [] })?.flights).toEqual([])
  })

  it('rejects a null or non-object payload', () => {
    expect(parseCatalog(null)).toBeNull()
    expect(parseCatalog('nope')).toBeNull()
  })

  it('rejects an unknown catalog version', () => {
    expect(parseCatalog({ version: 2, flights: [] })).toBeNull()
  })

  it('rejects a missing flights array', () => {
    expect(parseCatalog({ version: 1 })).toBeNull()
  })

  // Element-level validation, matching the planner's parsePlan precedent:
  // a malformed element must not be admitted just because the envelope is
  // well-formed.
  it('drops malformed flight entries but keeps valid ones', () => {
    const result = parseCatalog({ version: 1, flights: [validFlight, { id: 'bad' }] })
    expect(result?.flights.map((f) => f.id)).toEqual(['a'])
  })

  it('drops an entry whose home point is not numeric', () => {
    const bad = { ...validFlight, id: 'b', home: { lon: 'x', lat: 28 } }
    expect(parseCatalog({ version: 1, flights: [bad] })?.flights).toEqual([])
  })
})

describe('fetchCatalog', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns the parsed catalog on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ version: 1, flights: [validFlight] }),
    }))
    const result = await fetchCatalog('/base/')
    expect(result.flights).toHaveLength(1)
  })

  it('requests index.json under the given base', async () => {
    const spy = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ version: 1, flights: [] }) })
    vi.stubGlobal('fetch', spy)
    await fetchCatalog('/e-Sentinel/')
    expect(spy).toHaveBeenCalledWith('/e-Sentinel/flights/index.json')
  })

  it('returns an empty catalog when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    expect((await fetchCatalog('/')).flights).toEqual([])
  })

  it('returns an empty catalog when the network throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect((await fetchCatalog('/')).flights).toEqual([])
  })

  it('returns an empty catalog when the payload is malformed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ nope: true }) }))
    expect((await fetchCatalog('/')).flights).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app && npx vitest run src/modules/telemetry/io/catalogIo.test.ts
```

Expected: FAIL — cannot resolve `./catalogIo`.

- [ ] **Step 3: Write the implementation**

```ts
// Loads and validates the baked catalog. The bake tool is a separate Node
// program outside app/'s typecheck and lint, so its output is treated as
// untrusted input here -- the same stance planner/domain/planIo.ts takes
// toward an imported plan file.

import type { FlightCatalog, FlightMeta } from '../domain/types'

const EMPTY: FlightCatalog = { version: 1, flights: [] }

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function parseFlight(raw: unknown): FlightMeta | null {
  if (typeof raw !== 'object' || raw === null) return null
  const f = raw as Record<string, unknown>
  const home = f.home as Record<string, unknown> | undefined

  if (typeof f.id !== 'string' || f.id === '') return null
  if (typeof f.file !== 'string' || f.file === '') return null
  if (!isNum(f.version)) return null
  if (typeof f.aircraftName !== 'string') return null
  if (typeof f.aircraftSn !== 'string') return null
  if (typeof f.startTime !== 'string' || !Number.isFinite(Date.parse(f.startTime))) return null
  if (!isNum(f.durationS) || !isNum(f.distanceKm)) return null
  if (!isNum(f.maxHeightM) || !isNum(f.maxSpeedMs) || !isNum(f.recordCount)) return null
  if (!home || !isNum(home.lon) || !isNum(home.lat)) return null

  return {
    id: f.id,
    file: f.file,
    version: f.version,
    encrypted: f.encrypted === true,
    hasKeychain: f.hasKeychain === true,
    aircraftName: f.aircraftName,
    aircraftSn: f.aircraftSn,
    startTime: f.startTime,
    durationS: f.durationS,
    distanceKm: f.distanceKm,
    maxHeightM: f.maxHeightM,
    maxSpeedMs: f.maxSpeedMs,
    recordCount: f.recordCount,
    home: { lon: home.lon, lat: home.lat },
  }
}

export function parseCatalog(raw: unknown): FlightCatalog | null {
  if (typeof raw !== 'object' || raw === null) return null
  const c = raw as Record<string, unknown>
  if (c.version !== 1) return null
  if (!Array.isArray(c.flights)) return null
  const flights = c.flights.map(parseFlight).filter((f): f is FlightMeta => f !== null)
  return { version: 1, flights }
}

// Never throws. A missing or corrupt catalog leaves an empty library with the
// drop zone still working, which is strictly better in front of a client than
// a blank route.
export async function fetchCatalog(base: string): Promise<FlightCatalog> {
  try {
    const res = await fetch(`${base}flights/index.json`)
    if (!res.ok) {
      console.error(`[telemetry] catalog fetch failed: HTTP ${res.status}`)
      return EMPTY
    }
    const parsed = parseCatalog(await res.json())
    if (!parsed) {
      console.error('[telemetry] catalog payload malformed')
      return EMPTY
    }
    return parsed
  } catch (err) {
    console.error('[telemetry] could not load catalog', err)
    return EMPTY
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd app && npx vitest run src/modules/telemetry/io/catalogIo.test.ts
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/modules/telemetry/io/catalogIo.ts app/src/modules/telemetry/io/catalogIo.test.ts
git commit -m "feat(telemetry): load and validate the flight catalog"
```

---

## Task 9: Frame normalization

**Files:**
- Create: `app/src/modules/telemetry/io/normalizeFrames.ts`
- Test: `app/src/modules/telemetry/io/normalizeFrames.test.ts`

> **Plan refinement over the spec's file list.** The spec put normalization inside `djiLog.worker.ts`. Splitting it out means the logic that can actually be wrong is a pure function with real tests, and the worker shrinks to a shim with nothing worth testing. `normalizeFrames.ts` never imports `dji-log-parser-js` — it takes a structural type — so this test runs with no WASM.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { normalizeFrames } from './normalizeFrames'
import type { RawFrame } from './normalizeFrames'
import type { FlightMeta } from '../domain/types'

const meta: FlightMeta = {
  id: 'a', file: 'a.txt', version: 14, encrypted: true, hasKeychain: true,
  aircraftName: 'Matrice 400', aircraftSn: 'SN1',
  startTime: '2026-02-17T06:27:04.690Z',
  durationS: 30, distanceKm: 1, maxHeightM: 100, maxSpeedMs: 10,
  recordCount: 3, home: { lon: 48, lat: 28.78 },
}

function raw(dateTime: string, over: Partial<RawFrame['osd']> = {}): RawFrame {
  return {
    custom: { dateTime },
    osd: {
      latitude: 28.78, longitude: 48.0, altitude: 90, height: 50,
      xSpeed: 3, ySpeed: 4, zSpeed: -1, yaw: 116.9, gpsNum: 32,
      flycState: 'GPSWaypoint', ...over,
    },
    gimbal: { pitch: -30 },
    battery: { chargeLevel: 67, voltage: 50.067 },
  }
}

describe('normalizeFrames', () => {
  it('returns an empty path for no frames', () => {
    expect(normalizeFrames([], meta).samples).toEqual([])
  })

  it('carries the meta through unchanged', () => {
    expect(normalizeFrames([raw('2026-02-17T06:27:04.690Z')], meta).meta).toBe(meta)
  })

  // t is derived from the frame clock relative to the FIRST frame, not from
  // osd.flyTime: flyTime is not populated consistently across DJI firmware,
  // and the scrubber's whole contract is that t=0 is the start of the log.
  it('makes t relative to the first frame', () => {
    const path = normalizeFrames(
      [raw('2026-02-17T06:27:04.000Z'), raw('2026-02-17T06:27:14.500Z')],
      meta,
    )
    expect(path.samples[0].t).toBe(0)
    expect(path.samples[1].t).toBeCloseTo(10.5)
  })

  it('maps position, altitude and height', () => {
    const s = normalizeFrames([raw('2026-02-17T06:27:04Z')], meta).samples[0]
    expect(s.lon).toBe(48.0)
    expect(s.lat).toBe(28.78)
    expect(s.alt).toBe(90)
    expect(s.height).toBe(50)
  })

  // DJI gives horizontal velocity as separate x/y components; the readout
  // wants a single ground speed.
  it('derives horizontal speed from the x and y components', () => {
    const s = normalizeFrames([raw('2026-02-17T06:27:04Z', { xSpeed: 3, ySpeed: 4 })], meta).samples[0]
    expect(s.speedH).toBeCloseTo(5)
  })

  it('takes vertical speed from zSpeed', () => {
    expect(normalizeFrames([raw('2026-02-17T06:27:04Z', { zSpeed: -1 })], meta).samples[0].speedV).toBe(-1)
  })

  it('maps battery, gimbal, satellites and mode', () => {
    const s = normalizeFrames([raw('2026-02-17T06:27:04Z')], meta).samples[0]
    expect(s.battery).toBe(67)
    expect(s.voltage).toBeCloseTo(50.067)
    expect(s.gimbalPitch).toBe(-30)
    expect(s.sats).toBe(32)
    expect(s.mode).toBe('GPSWaypoint')
  })

  it('falls back to UNKNOWN for an absent flight mode', () => {
    const f = raw('2026-02-17T06:27:04Z')
    delete (f.osd as Record<string, unknown>).flycState
    expect(normalizeFrames([f], meta).samples[0].mode).toBe('UNKNOWN')
  })

  // DJI emits flycState as either a plain string or a { Unknown: n } object
  // depending on whether the enum value is recognised.
  it('renders an unrecognised flight mode object as UNKNOWN', () => {
    const f = raw('2026-02-17T06:27:04Z', { flycState: { Unknown: 42 } })
    expect(normalizeFrames([f], meta).samples[0].mode).toBe('UNKNOWN')
  })

  // Pre-GPS-lock frames at the very start of a log carry 0,0. Plotting them
  // draws a line from the Gulf of Guinea to Kuwait across the whole map.
  it('drops frames with no GPS fix', () => {
    const path = normalizeFrames(
      [raw('2026-02-17T06:27:04Z', { latitude: 0, longitude: 0 }), raw('2026-02-17T06:27:05Z')],
      meta,
    )
    expect(path.samples).toHaveLength(1)
  })

  it('drops frames with an unparseable timestamp', () => {
    expect(normalizeFrames([raw('nonsense')], meta).samples).toEqual([])
  })

  it('substitutes zero for a missing numeric field rather than emitting NaN', () => {
    const f = raw('2026-02-17T06:27:04Z')
    delete (f.battery as Record<string, unknown>).voltage
    expect(normalizeFrames([f], meta).samples[0].voltage).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app && npx vitest run src/modules/telemetry/io/normalizeFrames.test.ts
```

Expected: FAIL — cannot resolve `./normalizeFrames`.

- [ ] **Step 3: Write the implementation**

```ts
// The normalization seam (spec section 6). DJI's Frame carries ~100 fields
// and serializes to 65MB for a 27k-record log; this reduces it to the 13
// fields the UI reads, about 2.5MB.
//
// Deliberately does NOT import dji-log-parser-js. RawFrame below is a
// structural subset of the parser's Frame type, which keeps this module (and
// its test) free of WASM and makes the normalization independently testable.

import type { FlightMeta, FlightPath, FlightSample } from '../domain/types'

export interface RawFrame {
  custom: { dateTime: string }
  osd: {
    latitude: number
    longitude: number
    altitude: number
    height: number
    xSpeed: number
    ySpeed: number
    zSpeed: number
    yaw: number
    gpsNum: number
    flycState?: string | { Unknown: number }
  }
  gimbal: { pitch: number }
  battery: { chargeLevel: number; voltage?: number }
}

// A single flight cannot span more than a day. Anything further than this
// from the log's median timestamp is a corrupt clock, not a long flight.
const MAX_FLIGHT_MS = 24 * 60 * 60 * 1000

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function mode(state: RawFrame['osd']['flycState']): string {
  return typeof state === 'string' ? state : 'UNKNOWN'
}

export function normalizeFrames(frames: RawFrame[], meta: FlightMeta): FlightPath {
  const samples: FlightSample[] = []

  // Pass 1: keep frames that have a parseable clock and a real GPS fix.
  const usable: { f: RawFrame; ms: number }[] = []
  for (const f of frames) {
    const ms = Date.parse(f.custom?.dateTime ?? '')
    if (!Number.isFinite(ms)) continue

    const lat = num(f.osd?.latitude)
    const lon = num(f.osd?.longitude)
    // A 0,0 fix is "no GPS yet", not the Gulf of Guinea. Plotting these
    // stretches the flight path across half the planet.
    if (lat === 0 && lon === 0) continue

    usable.push({ f, ms })
  }
  if (usable.length === 0) return { meta, samples: [] }

  // Pass 2: drop frames with a CORRUPT clock.
  //
  // Real logs carry them. The 5,049-frame m400-2026-02-17-0846 log has two:
  // one stamped 2095-04-15 and one stamped 2012-05-04, among frames that are
  // otherwise all 2026-02-17. They are valid dates, so the Number.isFinite
  // guard above passes them straight through.
  //
  // Leaving them in breaks two things downstream, neither obviously:
  //   - traversedCoords() stops at the first sample past the cursor, so one
  //     far-future frame freezes the drawn path partway through the flight
  //     and it never completes.
  //   - sampleAt()'s binary search assumes t is sorted, and silently returns
  //     the wrong sample once it is not.
  //
  // Anchor on the MEDIAN timestamp, not the first: a corrupt FIRST frame
  // would otherwise poison the anchor and reject the entire rest of the log.
  // A couple of outliers cannot move a median.
  const median = [...usable].sort((a, b) => a.ms - b.ms)[usable.length >> 1].ms
  const sane = usable.filter((u) => Math.abs(u.ms - median) <= MAX_FLIGHT_MS)
  if (sane.length === 0) return { meta, samples: [] }

  // t is relative to the earliest SURVIVING frame, so t=0 is the start of the
  // flight as flown, which is the scrubber's contract.
  const t0 = Math.min(...sane.map((u) => u.ms))
  let lastT = -Infinity

  for (const { f, ms } of sane) {
    const t = (ms - t0) / 1000
    // Belt and braces: anything still out of order after the median filter is
    // dropped, so the array handed to sampleAt() is guaranteed sorted.
    if (t < lastT) continue
    lastT = t

    const lat = num(f.osd?.latitude)
    const lon = num(f.osd?.longitude)
    const xs = num(f.osd?.xSpeed)
    const ys = num(f.osd?.ySpeed)

    samples.push({
      t,
      lon,
      lat,
      alt: num(f.osd?.altitude),
      height: num(f.osd?.height),
      speedH: Math.hypot(xs, ys),
      speedV: num(f.osd?.zSpeed),
      heading: num(f.osd?.yaw),
      gimbalPitch: num(f.gimbal?.pitch),
      battery: num(f.battery?.chargeLevel),
      voltage: num(f.battery?.voltage),
      sats: num(f.osd?.gpsNum),
      mode: mode(f.osd?.flycState),
    })
  }

  return { meta, samples }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd app && npx vitest run src/modules/telemetry/io/normalizeFrames.test.ts
```

Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/modules/telemetry/io/normalizeFrames.ts app/src/modules/telemetry/io/normalizeFrames.test.ts
git commit -m "feat(telemetry): normalize DJI frames to a compact flight path"
```

---

## Task 10: The decode worker and its client

**Files:**
- Create: `app/src/modules/telemetry/io/djiLog.worker.ts`
- Create: `app/src/modules/telemetry/io/parseFlight.ts`
- Test: `app/src/modules/telemetry/io/parseFlight.test.ts`

The worker is mandatory, not an optimisation: `dji-log-parser-js` base64-inlines its WASM and instantiates it with a synchronous `new WebAssembly.Module`, which Chrome forbids on the main thread for buffers over 4 KB (spec section 3.4).

- [ ] **Step 1: Write the worker shim**

```ts
// The ONLY module that imports dji-log-parser-js. Runs off the main thread
// because the parser instantiates its inlined WASM synchronously, which
// Chrome refuses above 4KB on the main thread (spec section 3.4). Decode
// itself is cheap -- 414ms for 27k frames -- so this is about legality, not
// speed.
//
// Nothing here is unit-tested: it is a message shim over normalizeFrames.ts
// (which is fully tested) and the parser (which is third-party). Its real
// verification is Task 20's browser run.

import { DJILog } from 'dji-log-parser-js'
import { normalizeFrames } from './normalizeFrames'
import type { RawFrame } from './normalizeFrames'
import type { FlightMeta } from '../domain/types'

export interface DecodeRequest {
  id: number
  bytes: Uint8Array
  keychains: unknown[] | null
  meta: FlightMeta
}

self.onmessage = (event: MessageEvent<DecodeRequest>) => {
  const { id, bytes, keychains, meta } = event.data
  try {
    const parser = new DJILog(bytes)
    // frames() takes no argument for pre-v13 logs, which need no keychain.
    const frames = (
      keychains ? parser.frames(keychains as never) : parser.frames()
    ) as unknown as RawFrame[]
    const path = normalizeFrames(frames, meta)
    self.postMessage({ id, ok: true, path })
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
```

- [ ] **Step 2: Write the failing test for the client**

```ts
// `vi` is deliberately NOT imported here: this test drives a hand-written
// FakeWorker rather than a vitest mock, and tsconfig sets noUnusedLocals, which
// makes an unused import a hard TS6133 error rather than a warning.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { decodeFlight, __setWorkerFactory, __resetWorkerFactory } from './parseFlight'
import type { FlightMeta } from '../domain/types'

const meta: FlightMeta = {
  id: 'a', file: 'a.txt', version: 14, encrypted: true, hasKeychain: true,
  aircraftName: 'Matrice 400', aircraftSn: 'SN1',
  startTime: '2026-02-17T06:27:04.690Z',
  durationS: 30, distanceKm: 1, maxHeightM: 100, maxSpeedMs: 10,
  recordCount: 1, home: { lon: 48, lat: 28.78 },
}

// Stands in for the Vite-built worker. Records what it was posted and replies
// on the next microtask, mirroring a real worker's async message delivery.
class FakeWorker {
  posted: unknown[] = []
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  terminated = false
  reply: (msg: Record<string, unknown>) => Record<string, unknown> = (m) => ({
    id: m.id, ok: true, path: { meta, samples: [] },
  })
  postMessage(msg: Record<string, unknown>) {
    this.posted.push(msg)
    queueMicrotask(() => this.onmessage?.({ data: this.reply(msg) }))
  }
  terminate() { this.terminated = true }
}

let fake: FakeWorker

beforeEach(() => {
  fake = new FakeWorker()
  __setWorkerFactory(() => fake as unknown as Worker)
})
afterEach(() => __resetWorkerFactory())

describe('decodeFlight', () => {
  it('resolves with the decoded path', async () => {
    const path = await decodeFlight(new Uint8Array([1, 2]), null, meta)
    expect(path.meta.id).toBe('a')
  })

  it('posts the bytes, keychains and meta to the worker', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    await decodeFlight(bytes, [{ k: 1 }], meta)
    const sent = fake.posted[0] as Record<string, unknown>
    expect(sent.bytes).toBe(bytes)
    expect(sent.keychains).toEqual([{ k: 1 }])
    expect((sent.meta as FlightMeta).id).toBe('a')
  })

  it('rejects when the worker reports a decode failure', async () => {
    fake.reply = (m) => ({ id: m.id, ok: false, error: 'bad keychain' })
    await expect(decodeFlight(new Uint8Array([1]), null, meta)).rejects.toThrow('bad keychain')
  })

  it('ignores a reply whose id does not match the pending request', async () => {
    fake.reply = (m) => ({ id: (m.id as number) + 999, ok: true, path: { meta, samples: [] } })
    let settled = false
    void decodeFlight(new Uint8Array([1]), null, meta).then(() => (settled = true))
    await new Promise((r) => setTimeout(r, 10))
    expect(settled).toBe(false)
  })

  // Concurrency matters: the library lets a user click a second flight while
  // the first is still decoding, and both replies arrive on one worker.
  it('routes concurrent decodes to the right callers', async () => {
    fake.reply = (m) => ({
      id: m.id, ok: true,
      path: { meta: { ...meta, id: `flight-${String(m.id)}` }, samples: [] },
    })
    const [first, second] = await Promise.all([
      decodeFlight(new Uint8Array([1]), null, meta),
      decodeFlight(new Uint8Array([2]), null, meta),
    ])
    expect(first.meta.id).not.toBe(second.meta.id)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd app && npx vitest run src/modules/telemetry/io/parseFlight.test.ts
```

Expected: FAIL — cannot resolve `./parseFlight`.

- [ ] **Step 4: Write the client**

```ts
// Worker client. One long-lived worker for the whole module: spinning one up
// per decode would re-instantiate the inlined WASM every time, and the
// library legitimately allows a second flight to be opened while the first is
// still decoding, so replies are routed by request id.

import type { FlightMeta, FlightPath } from '../domain/types'
import DjiLogWorker from './djiLog.worker?worker'

type WorkerFactory = () => Worker

let factory: WorkerFactory = () => new DjiLogWorker()
let worker: Worker | null = null
let nextId = 1

const pending = new Map<
  number,
  { resolve: (p: FlightPath) => void; reject: (e: Error) => void }
>()

// Test seams. Vite rewrites the ?worker import at build time, so a unit test
// cannot construct the real thing; these let a fake stand in.
export function __setWorkerFactory(next: WorkerFactory): void {
  __resetWorkerFactory()
  factory = next
}

export function __resetWorkerFactory(): void {
  worker?.terminate()
  worker = null
  pending.clear()
  factory = () => new DjiLogWorker()
}

interface DecodeReply {
  id: number
  ok: boolean
  path?: FlightPath
  error?: string
}

function ensureWorker(): Worker {
  if (worker) return worker
  const w = factory()
  w.onmessage = (event: MessageEvent<DecodeReply>) => {
    const { id, ok, path, error } = event.data
    const entry = pending.get(id)
    if (!entry) return
    pending.delete(id)
    if (ok && path) entry.resolve(path)
    else entry.reject(new Error(error ?? 'decode failed'))
  }
  w.onerror = () => {
    // A worker-level error has no request id, so every in-flight decode is
    // lost. Fail them all rather than leaving promises hanging forever.
    for (const [, entry] of pending) entry.reject(new Error('decode worker crashed'))
    pending.clear()
    worker = null
  }
  worker = w
  return w
}

export function decodeFlight(
  bytes: Uint8Array,
  keychains: unknown[] | null,
  meta: FlightMeta,
): Promise<FlightPath> {
  const w = ensureWorker()
  const id = nextId++
  return new Promise<FlightPath>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({ id, bytes, keychains, meta })
  })
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd app && npx vitest run src/modules/telemetry/io/parseFlight.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Typecheck, to confirm the `?worker` import resolves**

```bash
cd app && npm run typecheck
```

Expected: no errors. `vite/client` types (referenced in `src/vite-env.d.ts`) declare the `*?worker` module.

- [ ] **Step 7: Commit**

```bash
git add app/src/modules/telemetry/io/djiLog.worker.ts app/src/modules/telemetry/io/parseFlight.ts app/src/modules/telemetry/io/parseFlight.test.ts
git commit -m "feat(telemetry): decode DJI logs in a worker off the main thread"
```

---

## Task 11: Decoded path cache

**Files:**
- Create: `app/src/modules/telemetry/io/flightCache.ts`
- Test: `app/src/modules/telemetry/io/flightCache.test.ts`

Caches normalized paths only, never raw frames — raw frames are 65 MB per log (spec section 3.6). Also the persistence layer for session drop-ins.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { getCachedPath, putCachedPath, listCachedPaths, clearCache } from './flightCache'
import { NORMALIZER_VERSION } from '../domain/types'
import type { FlightMeta, FlightPath } from '../domain/types'

const meta: FlightMeta = {
  id: 'a', file: 'a.txt', version: 14, encrypted: true, hasKeychain: true,
  aircraftName: 'Matrice 400', aircraftSn: 'SN1',
  startTime: '2026-02-17T06:27:04.690Z',
  durationS: 30, distanceKm: 1, maxHeightM: 100, maxSpeedMs: 10,
  recordCount: 1, home: { lon: 48, lat: 28.78 },
}

const path: FlightPath = {
  meta,
  samples: [{
    t: 0, lon: 48, lat: 28.78, alt: 90, height: 50, speedH: 5, speedV: 0,
    heading: 117, gimbalPitch: -30, battery: 67, voltage: 50, sats: 32,
    mode: 'GPSWaypoint',
  }],
}

beforeEach(async () => { await clearCache() })

describe('flightCache', () => {
  it('returns null for an id never stored', async () => {
    expect(await getCachedPath('missing')).toBeNull()
  })

  it('round-trips a stored path', async () => {
    await putCachedPath(path)
    const got = await getCachedPath('a')
    expect(got?.samples[0].mode).toBe('GPSWaypoint')
    expect(got?.meta.aircraftSn).toBe('SN1')
  })

  it('overwrites an existing entry for the same id', async () => {
    await putCachedPath(path)
    await putCachedPath({ ...path, samples: [] })
    expect((await getCachedPath('a'))?.samples).toEqual([])
  })

  // A normalizer change alters the shape of every sample. Serving a stale
  // entry after such a change is worse than re-decoding, which costs 414ms.
  it('ignores an entry written under an older normalizer version', async () => {
    await putCachedPath(path)
    vi.spyOn(await import('../domain/types'), 'NORMALIZER_VERSION', 'get')
    // Simulate the bump by writing a record with a stale version directly.
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('sentinel-telemetry', 1)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    await new Promise<void>((resolve) => {
      const tx = db.transaction('paths', 'readwrite')
      tx.objectStore('paths').put({ id: 'a', v: NORMALIZER_VERSION - 1, path })
      tx.oncomplete = () => resolve()
    })
    db.close()
    expect(await getCachedPath('a')).toBeNull()
  })

  it('lists the metadata of every cached path', async () => {
    await putCachedPath(path)
    await putCachedPath({ ...path, meta: { ...meta, id: 'b' } })
    const ids = (await listCachedPaths()).map((m) => m.id).sort()
    expect(ids).toEqual(['a', 'b'])
  })

  it('clears everything', async () => {
    await putCachedPath(path)
    await clearCache()
    expect(await getCachedPath('a')).toBeNull()
  })
})

describe('flightCache without IndexedDB', () => {
  afterEach(() => vi.unstubAllGlobals())

  // Private browsing blocks IndexedDB entirely. The module must degrade to
  // "decode every time", never fail (spec section 9).
  it('returns null instead of throwing when indexedDB is absent', async () => {
    vi.stubGlobal('indexedDB', undefined)
    expect(await getCachedPath('a')).toBeNull()
  })

  it('resolves silently when a put cannot be stored', async () => {
    vi.stubGlobal('indexedDB', undefined)
    await expect(putCachedPath(path)).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app && npx vitest run src/modules/telemetry/io/flightCache.test.ts
```

Expected: FAIL — cannot resolve `./flightCache`.

- [ ] **Step 3: Write the implementation**

```ts
// IndexedDB cache for decoded flight paths. Stores NORMALIZED paths only --
// a raw DJI Frame[] is 65MB for a 27k-record log (spec section 3.6), while
// the normalized form is roughly 2.5MB.
//
// Every function here swallows its errors and degrades to "no cache". A
// blocked IndexedDB (private browsing) must cost a 414ms re-decode, never a
// broken module.

import { NORMALIZER_VERSION } from '../domain/types'
import type { FlightMeta, FlightPath } from '../domain/types'

const DB_NAME = 'sentinel-telemetry'
const DB_VERSION = 1
const STORE = 'paths'

interface CacheRecord {
  id: string
  v: number
  path: FlightPath
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined' || indexedDB === null) return Promise.resolve(null)
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: 'id' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null)
        try {
          const tx = db.transaction(STORE, mode)
          const req = work(tx.objectStore(STORE))
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => resolve(null)
          tx.oncomplete = () => db.close()
        } catch {
          db.close()
          resolve(null)
        }
      }),
  )
}

export async function getCachedPath(id: string): Promise<FlightPath | null> {
  const rec = (await run<CacheRecord | undefined>('readonly', (s) =>
    s.get(id) as IDBRequest<CacheRecord | undefined>,
  )) as CacheRecord | undefined | null
  if (!rec) return null
  // A normalizer bump changes the shape of every sample; a stale entry is
  // worse than no entry.
  if (rec.v !== NORMALIZER_VERSION) return null
  return rec.path
}

export async function putCachedPath(path: FlightPath): Promise<void> {
  await run('readwrite', (s) =>
    s.put({ id: path.meta.id, v: NORMALIZER_VERSION, path } satisfies CacheRecord),
  )
}

export async function listCachedPaths(): Promise<FlightMeta[]> {
  const all = (await run<CacheRecord[]>('readonly', (s) =>
    s.getAll() as IDBRequest<CacheRecord[]>,
  )) as CacheRecord[] | null
  if (!all) return []
  return all.filter((r) => r.v === NORMALIZER_VERSION).map((r) => r.path.meta)
}

export async function clearCache(): Promise<void> {
  await run('readwrite', (s) => s.clear())
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd app && npx vitest run src/modules/telemetry/io/flightCache.test.ts
```

Expected: PASS, 8 tests. If the stale-version test is awkward against `fake-indexeddb`, simplify it to write the record through `run()` with a hand-set `v` rather than reopening the database — the behaviour under test is that `getCachedPath` rejects a version mismatch, not how the stale record got there.

- [ ] **Step 5: Commit**

```bash
git add app/src/modules/telemetry/io/flightCache.ts app/src/modules/telemetry/io/flightCache.test.ts
git commit -m "feat(telemetry): cache decoded paths in IndexedDB"
```

---

## Task 12: The telemetry store

**Files:**
- Create: `app/src/modules/telemetry/store/telemetryStore.ts`
- Test: `app/src/modules/telemetry/store/telemetryStore.test.ts`

Module-local, deliberately not a slice of `shared/store.ts` — same reasoning `planner/store/planStore.ts` records: nothing outside `/telemetry` reads a flight, and the cursor mutates on every animation frame.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { selectVisibleFlights, useTelemetryStore } from './telemetryStore'
import { NO_FILTERS } from '../domain/types'
import type { FlightMeta, FlightPath } from '../domain/types'

const meta: FlightMeta = {
  id: 'a', file: 'a.txt', version: 14, encrypted: true, hasKeychain: true,
  aircraftName: 'Matrice 400', aircraftSn: 'SN1',
  startTime: '2026-02-17T06:27:04.690Z',
  durationS: 30, distanceKm: 1, maxHeightM: 100, maxSpeedMs: 10,
  recordCount: 2, home: { lon: 48, lat: 28.78 },
}

const path: FlightPath = {
  meta,
  samples: [
    { t: 0, lon: 48, lat: 28.78, alt: 0, height: 0, speedH: 0, speedV: 0, heading: 0, gimbalPitch: 0, battery: 100, voltage: 50, sats: 20, mode: 'GPSAtti' },
    { t: 30, lon: 48.01, lat: 28.79, alt: 90, height: 50, speedH: 5, speedV: 0, heading: 90, gimbalPitch: -30, battery: 80, voltage: 49, sats: 32, mode: 'GPSWaypoint' },
  ],
}

const initial = useTelemetryStore.getState()
beforeEach(() => useTelemetryStore.setState(initial, true))

describe('telemetryStore', () => {
  it('starts empty and idle', () => {
    const s = useTelemetryStore.getState()
    expect(s.catalog).toEqual([])
    expect(s.selectedId).toBeNull()
    expect(s.playing).toBe(false)
    expect(s.rate).toBe(1)
    expect(s.filters).toEqual(NO_FILTERS)
    expect(s.sort).toBe('newest')
  })

  it('stores a loaded catalog', () => {
    useTelemetryStore.getState().setCatalog([meta])
    expect(useTelemetryStore.getState().catalog).toHaveLength(1)
  })

  it('merges session flights ahead of the baked catalog', () => {
    useTelemetryStore.getState().setCatalog([meta])
    useTelemetryStore.getState().addSessionFlight({ ...meta, id: 'dropped' })
    expect(selectVisibleFlights(useTelemetryStore.getState()).map((f) => f.id)).toEqual(['dropped', 'a'])
  })

  it('applies filters and sort to the visible list', () => {
    useTelemetryStore.getState().setCatalog([meta, { ...meta, id: 'b', aircraftSn: 'SN2' }])
    useTelemetryStore.getState().setFilters({ ...NO_FILTERS, aircraftSn: 'SN2' })
    expect(selectVisibleFlights(useTelemetryStore.getState()).map((f) => f.id)).toEqual(['b'])
  })

  it('clears session drop-ins', () => {
    useTelemetryStore.getState().addSessionFlight({ ...meta, id: 'dropped' })
    useTelemetryStore.getState().clearSessionFlights()
    expect(useTelemetryStore.getState().sessionFlights).toEqual([])
  })

  it('resets the cursor and playback when a path is loaded', () => {
    useTelemetryStore.setState({ cursorT: 99, playing: true })
    useTelemetryStore.getState().setPath(path)
    const s = useTelemetryStore.getState()
    expect(s.cursorT).toBe(0)
    expect(s.playing).toBe(false)
    expect(s.path?.meta.id).toBe('a')
  })

  it('clamps the cursor to the path duration', () => {
    useTelemetryStore.getState().setPath(path)
    useTelemetryStore.getState().setCursor(999)
    expect(useTelemetryStore.getState().cursorT).toBe(30)
    useTelemetryStore.getState().setCursor(-5)
    expect(useTelemetryStore.getState().cursorT).toBe(0)
  })

  it('stops playback when the cursor reaches the end', () => {
    useTelemetryStore.getState().setPath(path)
    useTelemetryStore.setState({ playing: true })
    useTelemetryStore.getState().setCursor(30)
    expect(useTelemetryStore.getState().playing).toBe(false)
  })

  it('rewinds to the start when play is pressed at the end', () => {
    useTelemetryStore.getState().setPath(path)
    useTelemetryStore.getState().setCursor(30)
    useTelemetryStore.getState().togglePlay()
    expect(useTelemetryStore.getState().cursorT).toBe(0)
    expect(useTelemetryStore.getState().playing).toBe(true)
  })

  it('does not play with no path loaded', () => {
    useTelemetryStore.getState().togglePlay()
    expect(useTelemetryStore.getState().playing).toBe(false)
  })

  // Called through getState() rather than destructured into a local binding:
  // destructuring a method off the store trips @typescript-eslint/unbound-method,
  // and this repo's established fix is to call it in place (see the comments in
  // planner/ui/PlanTree.tsx and planner/map/useDockPlacement.ts), never to
  // disable the rule.
  it('cycles the playback rate through 1, 4 and 16', () => {
    useTelemetryStore.getState().cycleRate()
    expect(useTelemetryStore.getState().rate).toBe(4)
    useTelemetryStore.getState().cycleRate()
    expect(useTelemetryStore.getState().rate).toBe(16)
    useTelemetryStore.getState().cycleRate()
    expect(useTelemetryStore.getState().rate).toBe(1)
  })

  it('records a load error and clears loading', () => {
    useTelemetryStore.setState({ loading: true })
    useTelemetryStore.getState().setError('Not a DJI flight record')
    const s = useTelemetryStore.getState()
    expect(s.error).toBe('Not a DJI flight record')
    expect(s.loading).toBe(false)
    expect(s.path).toBeNull()
  })

  it('clears the previous error when a new flight is selected', () => {
    useTelemetryStore.getState().setError('boom')
    useTelemetryStore.getState().select('a')
    const s = useTelemetryStore.getState()
    expect(s.error).toBeNull()
    expect(s.selectedId).toBe('a')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app && npx vitest run src/modules/telemetry/store/telemetryStore.test.ts
```

Expected: FAIL — cannot resolve `./telemetryStore`.

- [ ] **Step 3: Write the implementation**

```ts
// Telemetry-local state. Deliberately NOT a slice of shared/store.ts, the
// same call planner/store/planStore.ts records: nothing outside /telemetry
// reads a flight, and cursorT changes on every animation frame during
// playback, which would churn a global store the console also subscribes to.

import { create } from 'zustand'
import { filterFlights, sortFlights } from '../domain/filters'
import { NO_FILTERS } from '../domain/types'
import type { CatalogFilters, CatalogSort, FlightMeta, FlightPath } from '../domain/types'

export type PlaybackRate = 1 | 4 | 16
const RATES: PlaybackRate[] = [1, 4, 16]

function duration(path: FlightPath | null): number {
  if (!path || path.samples.length === 0) return 0
  return path.samples[path.samples.length - 1].t
}

interface TelemetryState {
  catalog: FlightMeta[]
  sessionFlights: FlightMeta[]
  filters: CatalogFilters
  sort: CatalogSort
  selectedId: string | null
  path: FlightPath | null
  loading: boolean
  error: string | null
  cursorT: number
  playing: boolean
  rate: PlaybackRate

  setCatalog(flights: FlightMeta[]): void
  addSessionFlight(meta: FlightMeta): void
  clearSessionFlights(): void
  setFilters(filters: CatalogFilters): void
  setSort(sort: CatalogSort): void
  select(id: string | null): void
  setLoading(loading: boolean): void
  setPath(path: FlightPath): void
  setError(error: string): void
  setCursor(t: number): void
  togglePlay(): void
  cycleRate(): void
}

export const useTelemetryStore = create<TelemetryState>((set, get) => ({
  catalog: [],
  sessionFlights: [],
  filters: NO_FILTERS,
  sort: 'newest',
  selectedId: null,
  path: null,
  loading: false,
  error: null,
  cursorT: 0,
  playing: false,
  rate: 1,

  setCatalog: (catalog) => set({ catalog }),
  addSessionFlight: (meta) =>
    set((s) => ({
      sessionFlights: [meta, ...s.sessionFlights.filter((f) => f.id !== meta.id)],
    })),
  clearSessionFlights: () => set({ sessionFlights: [] }),
  setFilters: (filters) => set({ filters }),
  setSort: (sort) => set({ sort }),

  select: (selectedId) => set({ selectedId, error: null }),
  setLoading: (loading) => set({ loading }),

  setPath: (path) => set({ path, loading: false, error: null, cursorT: 0, playing: false }),
  setError: (error) => set({ error, loading: false, path: null }),

  setCursor: (t) => {
    const total = duration(get().path)
    const cursorT = Math.min(total, Math.max(0, t))
    set(cursorT >= total ? { cursorT, playing: false } : { cursorT })
  },

  togglePlay: () => {
    const { path, playing, cursorT } = get()
    if (!path || path.samples.length === 0) return
    if (playing) return set({ playing: false })
    // Pressing play at the end replays from the start rather than doing
    // nothing, which is what a second press after a finished run means.
    set({ playing: true, cursorT: cursorT >= duration(path) ? 0 : cursorT })
  },

  cycleRate: () => set((s) => ({ rate: RATES[(RATES.indexOf(s.rate) + 1) % RATES.length] })),
}))

// A STANDALONE selector, deliberately not a method on the store.
//
// As a store method returning a fresh array, `useTelemetryStore((s) =>
// s.visibleFlights())` would hand React's useSyncExternalStore a new
// reference on every call and trip its "The result of getSnapshot should be
// cached to avoid an infinite loop" guard. Components subscribe to the four
// raw slices and memoize this call instead.
export function selectVisibleFlights(state: {
  catalog: FlightMeta[]
  sessionFlights: FlightMeta[]
  filters: CatalogFilters
  sort: CatalogSort
}): FlightMeta[] {
  const { catalog, sessionFlights, filters, sort } = state
  // Session drop-ins lead: a file the user just handed over is what they are
  // looking for, and burying it under the baked catalog's sort order is the
  // wrong answer even when the sort says otherwise.
  return [
    ...sortFlights(filterFlights(sessionFlights, filters), sort),
    ...sortFlights(filterFlights(catalog, filters), sort),
  ]
}

export { duration as pathDuration }
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd app && npx vitest run src/modules/telemetry/store/telemetryStore.test.ts
```

Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/modules/telemetry/store/telemetryStore.ts app/src/modules/telemetry/store/telemetryStore.test.ts
git commit -m "feat(telemetry): hold catalog, selection and playback state"
```

---

## Task 13: Map style and feature builders

**Files:**
- Create: `app/src/modules/telemetry/map/telemetryStyle.ts`
- Test: `app/src/modules/telemetry/map/telemetryStyle.test.ts`

Follows `planner/map/plannerStyle.ts` exactly: `buildBaseStyle()` plus this module's own sources and layers, and pure feature builders tested independently of MapLibre.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import {
  TELEMETRY_SOURCES,
  buildTelemetryStyle,
  pathFeature,
  traversedFeature,
  homeFeature,
  positionFeature,
} from './telemetryStyle'
import type { FlightMeta, FlightPath } from '../domain/types'

const meta: FlightMeta = {
  id: 'a', file: 'a.txt', version: 14, encrypted: true, hasKeychain: true,
  aircraftName: 'Matrice 400', aircraftSn: 'SN1',
  startTime: '2026-02-17T06:27:04.690Z',
  durationS: 30, distanceKm: 1, maxHeightM: 100, maxSpeedMs: 10,
  recordCount: 2, home: { lon: 48, lat: 28.78 },
}

const path: FlightPath = {
  meta,
  samples: [
    { t: 0, lon: 48, lat: 28.78, alt: 0, height: 0, speedH: 0, speedV: 0, heading: 0, gimbalPitch: 0, battery: 100, voltage: 50, sats: 20, mode: 'GPSAtti' },
    { t: 30, lon: 48.01, lat: 28.79, alt: 90, height: 50, speedH: 5, speedV: 0, heading: 90, gimbalPitch: -30, battery: 80, voltage: 49, sats: 32, mode: 'GPSWaypoint' },
  ],
}

describe('buildTelemetryStyle', () => {
  it('adds every telemetry source on top of the base style', () => {
    const style = buildTelemetryStyle()
    for (const id of Object.values(TELEMETRY_SOURCES)) {
      expect(style.sources[id]).toBeDefined()
    }
  })

  it('keeps the base style layers', () => {
    expect(buildTelemetryStyle().layers.length).toBeGreaterThan(4)
  })

  it('draws the traversed line above the full path', () => {
    const ids = buildTelemetryStyle().layers.map((l) => l.id)
    expect(ids.indexOf('tm-path-traversed')).toBeGreaterThan(ids.indexOf('tm-path-full'))
  })
})

describe('pathFeature', () => {
  it('is an empty collection with no path', () => {
    expect(pathFeature(null).features).toEqual([])
  })

  it('builds a single LineString over every sample', () => {
    const fc = pathFeature(path)
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].geometry).toEqual({
      type: 'LineString',
      coordinates: [[48, 28.78], [48.01, 28.79]],
    })
  })

  // MapLibre rejects a LineString with fewer than two positions.
  it('emits nothing for a single-sample path', () => {
    expect(pathFeature({ meta, samples: [path.samples[0]] }).features).toEqual([])
  })
})

describe('traversedFeature', () => {
  it('is empty before the flight starts', () => {
    expect(traversedFeature(path, -1).features).toEqual([])
  })

  it('covers the whole path at the end', () => {
    const geom = traversedFeature(path, 30).features[0].geometry
    expect(geom.type).toBe('LineString')
    // No cast: traversedFeature returns FeatureCollection<LineString>, so the
    // geometry is already narrowed and eslint flags a redundant assertion.
    expect(geom.coordinates).toHaveLength(2)
  })
})

describe('homeFeature', () => {
  it('is empty with no flight', () => {
    expect(homeFeature(null).features).toEqual([])
  })

  it('places a point at the home coordinates', () => {
    expect(homeFeature(meta).features[0].geometry).toEqual({ type: 'Point', coordinates: [48, 28.78] })
  })
})

describe('positionFeature', () => {
  it('is empty with no sample', () => {
    expect(positionFeature(null).features).toEqual([])
  })

  it('carries the heading as a property for icon rotation', () => {
    expect(positionFeature(path.samples[1]).features[0].properties?.heading).toBe(90)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app && npx vitest run src/modules/telemetry/map/telemetryStyle.test.ts
```

Expected: FAIL — cannot resolve `./telemetryStyle`.

- [ ] **Step 3: Write the implementation**

```ts
// Telemetry map style and its feature builders. Same shape as
// planner/map/plannerStyle.ts: buildBaseStyle() plus this module's sources
// and layers, with the feature builders kept pure so they test without a map.

import type { StyleSpecification } from 'maplibre-gl'
import type { FeatureCollection, LineString, Point } from 'geojson'
import { buildBaseStyle } from '@/modules/console/map/style'
import { allCoords, traversedCoords } from '../domain/flightPath'
import type { FlightMeta, FlightPath, FlightSample } from '../domain/types'

export const TELEMETRY_SOURCES = {
  path: 'tm-path',
  traversed: 'tm-traversed',
  home: 'tm-home',
  position: 'tm-position',
} as const

const empty = (): FeatureCollection => ({ type: 'FeatureCollection', features: [] })

function lineCollection(coords: [number, number][]): FeatureCollection<LineString> {
  // MapLibre's GeoJSON tiler drops a LineString with fewer than two
  // positions, so emitting one paints nothing while still costing a tile
  // rebuild. Emit no feature instead.
  if (coords.length < 2) return { type: 'FeatureCollection', features: [] }
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }],
  }
}

export function pathFeature(path: FlightPath | null): FeatureCollection<LineString> {
  return path ? lineCollection(allCoords(path)) : { type: 'FeatureCollection', features: [] }
}

export function traversedFeature(
  path: FlightPath | null,
  t: number,
): FeatureCollection<LineString> {
  return path ? lineCollection(traversedCoords(path, t)) : { type: 'FeatureCollection', features: [] }
}

export function homeFeature(meta: FlightMeta | null): FeatureCollection<Point> {
  if (!meta) return { type: 'FeatureCollection', features: [] }
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [meta.home.lon, meta.home.lat] },
    }],
  }
}

export function positionFeature(sample: FlightSample | null): FeatureCollection<Point> {
  if (!sample) return { type: 'FeatureCollection', features: [] }
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { heading: sample.heading },
      geometry: { type: 'Point', coordinates: [sample.lon, sample.lat] },
    }],
  }
}

export function buildTelemetryStyle(): StyleSpecification {
  const base = buildBaseStyle()
  return {
    ...base,
    sources: {
      ...base.sources,
      [TELEMETRY_SOURCES.path]: { type: 'geojson', data: empty() },
      [TELEMETRY_SOURCES.traversed]: { type: 'geojson', data: empty() },
      [TELEMETRY_SOURCES.home]: { type: 'geojson', data: empty() },
      [TELEMETRY_SOURCES.position]: { type: 'geojson', data: empty() },
    },
    layers: [
      ...base.layers,
      // The whole flight, drawn dim. These logs are survey grids -- 22km of
      // path inside a 790x710m box (spec section 3.5) -- so at fit-to-bounds
      // zoom the lawnmower legs sit close together. A thin, low-opacity line
      // keeps the shape readable instead of collapsing it into a solid block.
      {
        id: 'tm-path-full',
        type: 'line',
        source: TELEMETRY_SOURCES.path,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#7d8da3', 'line-width': 1.2, 'line-opacity': 0.45 },
      },
      // Flown so far, bright. At this path density the traversed/untraversed
      // contrast is what actually communicates progress; line width alone
      // cannot, since the legs are only metres apart on screen.
      {
        id: 'tm-path-traversed',
        type: 'line',
        source: TELEMETRY_SOURCES.traversed,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#e8eef7', 'line-width': 2, 'line-opacity': 0.95 },
      },
      {
        id: 'tm-home',
        type: 'circle',
        source: TELEMETRY_SOURCES.home,
        paint: {
          'circle-radius': 5,
          'circle-color': '#141D2D',
          'circle-stroke-color': '#e8eef7',
          'circle-stroke-width': 2,
        },
      },
      // Reuses the console's drone icon, seeded into the map by MapView's
      // load handler, so the aircraft reads the same across modules.
      {
        id: 'tm-position',
        type: 'symbol',
        source: TELEMETRY_SOURCES.position,
        layout: {
          'icon-image': 'drone',
          'icon-size': 0.9,
          'icon-rotate': ['get', 'heading'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
        },
      },
    ],
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd app && npx vitest run src/modules/telemetry/map/telemetryStyle.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/modules/telemetry/map/telemetryStyle.ts app/src/modules/telemetry/map/telemetryStyle.test.ts
git commit -m "feat(telemetry): draw flight path, home and position on the map"
```

---

## Task 14: Bind the path to the map

**Files:**
- Create: `app/src/modules/telemetry/map/useFlightLayers.ts`
- Test: `app/src/modules/telemetry/map/useFlightLayers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { useRef } from 'react'
import type { MutableRefObject } from 'react'
import type maplibregl from 'maplibre-gl'
import { useFlightLayers } from './useFlightLayers'
import { TELEMETRY_SOURCES } from './telemetryStyle'
import type { FlightMeta, FlightPath } from '../domain/types'

const meta: FlightMeta = {
  id: 'a', file: 'a.txt', version: 14, encrypted: true, hasKeychain: true,
  aircraftName: 'Matrice 400', aircraftSn: 'SN1',
  startTime: '2026-02-17T06:27:04.690Z',
  durationS: 30, distanceKm: 1, maxHeightM: 100, maxSpeedMs: 10,
  recordCount: 2, home: { lon: 48, lat: 28.78 },
}

const path: FlightPath = {
  meta,
  samples: [
    { t: 0, lon: 48, lat: 28.78, alt: 0, height: 0, speedH: 0, speedV: 0, heading: 0, gimbalPitch: 0, battery: 100, voltage: 50, sats: 20, mode: 'GPSAtti' },
    { t: 30, lon: 48.01, lat: 28.79, alt: 90, height: 50, speedH: 5, speedV: 0, heading: 90, gimbalPitch: -30, battery: 80, voltage: 49, sats: 32, mode: 'GPSWaypoint' },
  ],
}

function fakeMap() {
  const setData = vi.fn()
  return {
    setData,
    // isMapUsable probes for a truthy `style`.
    map: { style: {}, getSource: vi.fn(() => ({ setData })) } as unknown as maplibregl.Map,
  }
}

function renderLayers(map: maplibregl.Map | null, ready: boolean, p: FlightPath | null, t: number) {
  return renderHook(
    (props: { p: FlightPath | null; t: number }) => {
      const ref = useRef(map) as MutableRefObject<maplibregl.Map | null>
      useFlightLayers(ref, ready, props.p, props.t)
    },
    { initialProps: { p, t } },
  )
}

afterEach(() => cleanup())
beforeEach(() => vi.useRealTimers())

describe('useFlightLayers', () => {
  it('does nothing before the map is ready', () => {
    const { map, setData } = fakeMap()
    renderLayers(map, false, path, 0)
    expect(setData).not.toHaveBeenCalled()
  })

  it('does nothing with a null map', () => {
    expect(() => renderLayers(null, true, path, 0)).not.toThrow()
  })

  // Route unmount removes the map parent-first, so a hook that reaches for a
  // torn-down instance throws. Same guard planner hooks use.
  it('does nothing once the map has been removed', () => {
    const { setData } = fakeMap()
    const dead = { style: null, getSource: vi.fn() } as unknown as maplibregl.Map
    renderLayers(dead, true, path, 0)
    expect(setData).not.toHaveBeenCalled()
  })

  it('feeds the full path and home sources when a path loads', () => {
    const { map } = fakeMap()
    renderLayers(map, true, path, 0)
    const asked = (map.getSource as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string)
    expect(asked).toContain(TELEMETRY_SOURCES.path)
    expect(asked).toContain(TELEMETRY_SOURCES.home)
  })

  it('clears every source when the path becomes null', () => {
    const { map, setData } = fakeMap()
    const { rerender } = renderLayers(map, true, path, 0)
    setData.mockClear()
    rerender({ p: null, t: 0 })
    const cleared = setData.mock.calls.map((c) => c[0] as { features: unknown[] })
    expect(cleared.length).toBeGreaterThan(0)
    expect(cleared.every((fc) => fc.features.length === 0)).toBe(true)
  })

  // The full path is 27k coordinates. Rebuilding it on every cursor tick
  // would re-tile the whole line 60 times a second; only the traversed line
  // and position marker may follow the cursor.
  it('does not rebuild the full path when only the cursor moves', () => {
    const { map } = fakeMap()
    const { rerender } = renderLayers(map, true, path, 0)
    const getSource = map.getSource as ReturnType<typeof vi.fn>
    getSource.mockClear()
    rerender({ p: path, t: 15 })
    const asked = getSource.mock.calls.map((c) => c[0] as string)
    expect(asked).not.toContain(TELEMETRY_SOURCES.path)
    expect(asked).toContain(TELEMETRY_SOURCES.traversed)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app && npx vitest run src/modules/telemetry/map/useFlightLayers.test.ts
```

Expected: FAIL — cannot resolve `./useFlightLayers`.

- [ ] **Step 3: Write the implementation**

```ts
// The flight-path -> map bridge. Panels re-render through React; the map is
// fed imperatively so a cursor tick never rebuilds a MapLibre layer.
//
// Split into two effects on purpose, the same reasoning
// planner/map/usePlannerLayers.ts records: the full path is up to 27,000
// coordinates, and folding it into the cursor effect would re-tile the entire
// line on every animation frame.

import { useEffect } from 'react'
import type { MutableRefObject } from 'react'
import type maplibregl from 'maplibre-gl'
import type { GeoJSONSource } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { isMapUsable } from '@/modules/console/map/mapLifecycle'
import { sampleAt } from '../domain/flightPath'
import type { FlightPath } from '../domain/types'
import {
  TELEMETRY_SOURCES,
  homeFeature,
  pathFeature,
  positionFeature,
  traversedFeature,
} from './telemetryStyle'

function setData(map: maplibregl.Map, id: string, data: FeatureCollection): void {
  const src = map.getSource<GeoJSONSource>(id)
  if (src) src.setData(data)
}

export function useFlightLayers(
  mapRef: MutableRefObject<maplibregl.Map | null>,
  ready: boolean,
  path: FlightPath | null,
  cursorT: number,
): void {
  // Static geometry: rebuilt only when the flight itself changes.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !isMapUsable(map)) return
    setData(map, TELEMETRY_SOURCES.path, pathFeature(path))
    setData(map, TELEMETRY_SOURCES.home, homeFeature(path?.meta ?? null))
  }, [mapRef, ready, path])

  // Cursor-following geometry. Cheap by comparison: the traversed line is a
  // slice, and the position marker is one point.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !isMapUsable(map)) return
    setData(map, TELEMETRY_SOURCES.traversed, traversedFeature(path, cursorT))
    setData(map, TELEMETRY_SOURCES.position, positionFeature(path ? sampleAt(path, cursorT) : null))
  }, [mapRef, ready, path, cursorT])
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd app && npx vitest run src/modules/telemetry/map/useFlightLayers.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/modules/telemetry/map/useFlightLayers.ts app/src/modules/telemetry/map/useFlightLayers.test.ts
git commit -m "feat(telemetry): bind the flight path and cursor to the map"
```

---

## Task 15: Module stylesheet

**Files:**
- Create: `app/src/modules/telemetry/ui/telemetry.css`

One coherent grid written up front so every component task below has its classes to hand. Mirrors `planner.css`: same frosted `--chrome` glass and `.lbl` micro-label idiom, own `tm-*` prefix so nothing can collide with console or planner selectors.

- [ ] **Step 1: Write the stylesheet**

```css
/* Telemetry chrome. Same visual language as modules/planner/ui/planner.css
   and modules/console/chrome/chrome.css -- frosted --chrome glass, 9.5px
   .22em uppercase mono micro-labels from shared/index.css -- with its own
   tm-* prefix so /telemetry can never collide with the console's #topbar/
   #side/#rpanel ids or the planner's pl-* classes. */

.tm-root {
  position: fixed;
  inset: 0;
}

/* ---------- topbar ---------- */
.tm-topbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 56px;
  z-index: 900;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  background: var(--chrome);
  backdrop-filter: var(--chrome-blur);
  -webkit-backdrop-filter: var(--chrome-blur);
  border-bottom: 1px solid var(--line);
}
.tm-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
}
.tm-sp {
  flex: 1;
}
.tm-btn {
  background: transparent;
  border: 1px solid var(--line);
  color: var(--txt);
  padding: 7px 12px;
  cursor: pointer;
  font: inherit;
  letter-spacing: 0.22em;
  font-size: 9.5px;
  text-transform: uppercase;
}
.tm-btn:hover {
  border-color: var(--txt);
}
.tm-btn[aria-pressed='true'] {
  border-color: var(--txt);
  background: rgba(255, 255, 255, 0.06);
}

/* ---------- library ---------- */
.tm-library {
  position: fixed;
  top: 56px;
  bottom: 96px;
  left: 0;
  width: 288px;
  z-index: 850;
  display: flex;
  flex-direction: column;
  background: var(--chrome);
  backdrop-filter: var(--chrome-blur);
  -webkit-backdrop-filter: var(--chrome-blur);
  border-right: 1px solid var(--line);
}
.tm-filters {
  padding: 12px;
  border-bottom: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tm-filters select,
.tm-filters input {
  width: 100%;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--line);
  color: var(--txt);
  padding: 6px 8px;
  font: inherit;
  font-size: 12px;
}
.tm-filter-row {
  display: flex;
  gap: 8px;
}
.tm-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}
.tm-group {
  padding: 10px 12px 4px;
}
.tm-flight {
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  border-left: 2px solid transparent;
  color: var(--txt);
  padding: 10px 12px;
  cursor: pointer;
  font: inherit;
  display: block;
}
.tm-flight:hover {
  background: rgba(255, 255, 255, 0.04);
}
.tm-flight[aria-current='true'] {
  border-left-color: var(--hot);
  background: rgba(255, 255, 255, 0.07);
}
.tm-flight-time {
  font-size: 13px;
}
.tm-flight-stats {
  margin-top: 4px;
  opacity: 0.65;
}
.tm-session-tag {
  color: var(--hot);
}
.tm-empty {
  padding: 24px 12px;
  opacity: 0.6;
  text-align: center;
}

/* ---------- frame panel ---------- */
.tm-panel {
  position: fixed;
  top: 56px;
  bottom: 96px;
  right: 0;
  width: 296px;
  z-index: 850;
  overflow-y: auto;
  padding: 14px;
  background: var(--chrome);
  backdrop-filter: var(--chrome-blur);
  -webkit-backdrop-filter: var(--chrome-blur);
  border-left: 1px solid var(--line);
}
.tm-summary {
  padding-bottom: 12px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--line);
}
.tm-readouts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 12px;
}
.tm-readout-val {
  font-size: 15px;
  margin-top: 2px;
  font-variant-numeric: tabular-nums;
}
.tm-locked {
  border: 1px solid var(--line);
  padding: 12px;
  margin-top: 12px;
  opacity: 0.8;
}
.tm-error {
  border: 1px solid var(--hot);
  color: var(--hot);
  padding: 12px;
  margin-top: 12px;
}

/* ---------- scrubber ---------- */
.tm-scrubber {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  height: 96px;
  z-index: 860;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 18px;
  background: var(--chrome);
  backdrop-filter: var(--chrome-blur);
  -webkit-backdrop-filter: var(--chrome-blur);
  border-top: 1px solid var(--line);
}
.tm-scrub-track {
  flex: 1;
  appearance: none;
  height: 3px;
  background: var(--line);
  cursor: pointer;
}
.tm-scrub-track::-webkit-slider-thumb {
  appearance: none;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--txt);
  cursor: grab;
}
.tm-scrub-track::-moz-range-thumb {
  width: 13px;
  height: 13px;
  border: 0;
  border-radius: 50%;
  background: var(--txt);
  cursor: grab;
}
.tm-scrub-track:disabled {
  opacity: 0.35;
  cursor: default;
}
.tm-clock {
  font-variant-numeric: tabular-nums;
  min-width: 148px;
  text-align: right;
}
```

> **`--hot` DOES NOT EXIST.** This section originally specified a `--hot` token
> for the selected row, the drop-in tag and the error state. `src/shared/tokens.css`
> has no such token; the brand hot red is `--red` (#ff5a5a). More importantly,
> only the error state should be red at all: PRODUCT.md says "Status colors must
> NOT overload brand red: red is brand + alert only", and neither a selected row
> nor a locally-loaded file is an alert. `planner.css` settles the convention —
> `--amber` for active state (`.pl-btn.active`), `--red` for genuine alerts. The
> CSS above already reflects this.

- [ ] **Step 2: Verify every custom property used actually exists**

```bash
cd app && for t in $(grep -oE "var\(--[a-z-]+\)" src/modules/telemetry/ui/telemetry.css | sed 's/var(--\(.*\))/\1/' | sort -u); do printf "  --%-14s " "$t"; grep -qE "^\s*--$t:" src/shared/tokens.css && echo ok || echo MISSING; done
```

Expected: every line reads `ok`. A missing custom property fails silently at runtime, so do not skip this.

- [ ] **Step 3: Commit**

```bash
git add app/src/modules/telemetry/ui/telemetry.css
git commit -m "feat(telemetry): style the telemetry chrome"
```

---

## Task 16: Scrubber

**Files:**
- Create: `app/src/modules/telemetry/ui/Scrubber.tsx`
- Test: `app/src/modules/telemetry/ui/Scrubber.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import Scrubber from './Scrubber'
import { useTelemetryStore } from '../store/telemetryStore'
import type { FlightMeta, FlightPath } from '../domain/types'

const meta: FlightMeta = {
  id: 'a', file: 'a.txt', version: 14, encrypted: true, hasKeychain: true,
  aircraftName: 'Matrice 400', aircraftSn: 'SN1',
  startTime: '2026-02-17T06:27:04.690Z',
  durationS: 30, distanceKm: 1, maxHeightM: 100, maxSpeedMs: 10,
  recordCount: 2, home: { lon: 48, lat: 28.78 },
}

const path: FlightPath = {
  meta,
  samples: [
    { t: 0, lon: 48, lat: 28.78, alt: 0, height: 0, speedH: 0, speedV: 0, heading: 0, gimbalPitch: 0, battery: 100, voltage: 50, sats: 20, mode: 'GPSAtti' },
    { t: 120, lon: 48.01, lat: 28.79, alt: 90, height: 50, speedH: 5, speedV: 0, heading: 90, gimbalPitch: -30, battery: 80, voltage: 49, sats: 32, mode: 'GPSWaypoint' },
  ],
}

const initial = useTelemetryStore.getState()
beforeEach(() => useTelemetryStore.setState(initial, true))
afterEach(() => cleanup())

describe('Scrubber', () => {
  it('disables the track with no flight loaded', () => {
    render(<Scrubber />)
    expect(screen.getByRole('slider')).toBeDisabled()
  })

  it('shows the cursor position against the total duration', () => {
    useTelemetryStore.getState().setPath(path)
    useTelemetryStore.getState().setCursor(62)
    render(<Scrubber />)
    expect(screen.getByText('T+01:02 / 02:00')).toBeInTheDocument()
  })

  it('moves the cursor when the track is dragged', () => {
    useTelemetryStore.getState().setPath(path)
    render(<Scrubber />)
    fireEvent.change(screen.getByRole('slider'), { target: { value: '45' } })
    expect(useTelemetryStore.getState().cursorT).toBe(45)
  })

  it('toggles playback from the play button', () => {
    useTelemetryStore.getState().setPath(path)
    render(<Scrubber />)
    fireEvent.click(screen.getByRole('button', { name: /play/i }))
    expect(useTelemetryStore.getState().playing).toBe(true)
  })

  it('shows a pause affordance while playing', () => {
    useTelemetryStore.getState().setPath(path)
    useTelemetryStore.getState().togglePlay()
    render(<Scrubber />)
    expect(screen.getByRole('button', { name: /pause/i })).toBeInTheDocument()
  })

  it('cycles the playback rate', () => {
    useTelemetryStore.getState().setPath(path)
    render(<Scrubber />)
    fireEvent.click(screen.getByRole('button', { name: '1×' }))
    expect(useTelemetryStore.getState().rate).toBe(4)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app && npx vitest run src/modules/telemetry/ui/Scrubber.test.tsx
```

Expected: FAIL — cannot resolve `./Scrubber`.

- [ ] **Step 3: Write the component**

```tsx
// Playback transport. A 35-minute survey flight at 1x is unwatchable in a
// meeting, so the rate control is a first-class button rather than a setting:
// 16x replays the longest of these logs in under three minutes.

import { fmtMMSS } from '@/modules/console/chrome/format'
import { pathDuration, useTelemetryStore } from '../store/telemetryStore'
import { fmtFlightClock } from '../domain/format'
import './telemetry.css'

export default function Scrubber() {
  const path = useTelemetryStore((s) => s.path)
  const cursorT = useTelemetryStore((s) => s.cursorT)
  const playing = useTelemetryStore((s) => s.playing)
  const rate = useTelemetryStore((s) => s.rate)
  // Actions are called through getState(), never selected: selecting one
  // trips @typescript-eslint/unbound-method. Only state is selected below.
  const store = useTelemetryStore

  const total = pathDuration(path)
  const disabled = total === 0

  return (
    <div className="tm-scrubber">
      <button
        className="tm-btn"
        onClick={() => store.getState().togglePlay()}
        disabled={disabled}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <button className="tm-btn" onClick={() => store.getState().cycleRate()} disabled={disabled}>
        {rate}×
      </button>
      <input
        className="tm-scrub-track"
        type="range"
        min={0}
        max={total || 1}
        step={0.1}
        value={cursorT}
        disabled={disabled}
        aria-label="Flight position"
        onChange={(e) => store.getState().setCursor(Number(e.target.value))}
      />
      <div className="tm-clock lbl">
        {fmtFlightClock(cursorT)} / {fmtMMSS(total)}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd app && npx vitest run src/modules/telemetry/ui/Scrubber.test.tsx
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/modules/telemetry/ui/Scrubber.tsx app/src/modules/telemetry/ui/Scrubber.test.tsx
git commit -m "feat(telemetry): scrub and play back a flight"
```

---

## Task 17: Frame panel

**Files:**
- Create: `app/src/modules/telemetry/ui/FramePanel.tsx`
- Test: `app/src/modules/telemetry/ui/FramePanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom'
import FramePanel from './FramePanel'
import { useTelemetryStore } from '../store/telemetryStore'
import type { FlightMeta, FlightPath } from '../domain/types'

const meta: FlightMeta = {
  id: 'a', file: 'a.txt', version: 14, encrypted: true, hasKeychain: true,
  aircraftName: 'Matrice 400', aircraftSn: '1581F8DBW258U00A',
  startTime: '2026-02-17T06:27:04.690Z',
  // maxHeightM is 104, NOT 50: a sample height of 49.9 also renders '50 m',
  // and getByText then matches two elements. The point of this test is that the
  // summary and the readouts show different numbers from different sources.
  durationS: 2722.9, distanceKm: 22.07, maxHeightM: 104, maxSpeedMs: 17.04,
  recordCount: 27229, home: { lon: 48.004, lat: 28.782 },
}

const path: FlightPath = {
  meta,
  samples: [{
    t: 0, lon: 48.004, lat: 28.782, alt: 91.9, height: 49.9, speedH: 12.4,
    speedV: -1.2, heading: 116.9, gimbalPitch: -30, battery: 67,
    voltage: 50.067, sats: 32, mode: 'GPSWaypoint',
  }],
}

const initial = useTelemetryStore.getState()
beforeEach(() => useTelemetryStore.setState(initial, true))
afterEach(() => cleanup())

describe('FramePanel', () => {
  it('prompts to pick a flight when nothing is selected', () => {
    render(<FramePanel />)
    expect(screen.getByText(/select a flight/i)).toBeInTheDocument()
  })

  it('shows the flight summary once a path is loaded', () => {
    useTelemetryStore.getState().setPath(path)
    render(<FramePanel />)
    expect(screen.getByText('Matrice 400')).toBeInTheDocument()
    expect(screen.getByText('1581F8DBW258U00A')).toBeInTheDocument()
    expect(screen.getByText('45m 23s')).toBeInTheDocument()
    expect(screen.getByText('22.1 km')).toBeInTheDocument()
  })

  it('shows readouts at the cursor', () => {
    useTelemetryStore.getState().setPath(path)
    render(<FramePanel />)
    expect(screen.getByText('50 m')).toBeInTheDocument()
    expect(screen.getByText('12.4 m/s')).toBeInTheDocument()
    expect(screen.getByText('117°')).toBeInTheDocument()
    expect(screen.getByText('67%')).toBeInTheDocument()
    expect(screen.getByText('32')).toBeInTheDocument()
    expect(screen.getByText('GPSWaypoint')).toBeInTheDocument()
  })

  it('shows a loading state while decoding', () => {
    useTelemetryStore.setState({ selectedId: 'a', loading: true })
    render(<FramePanel />)
    expect(screen.getByText(/decoding/i)).toBeInTheDocument()
  })

  it('shows a decode error without losing the panel', () => {
    useTelemetryStore.getState().setError('Not a DJI flight record')
    render(<FramePanel />)
    expect(screen.getByText('Not a DJI flight record')).toBeInTheDocument()
  })

  // A v13+ flight with no baked keychain is a normal state, not an error:
  // the metadata is fully readable and only the frames are locked.
  it('shows FRAMES LOCKED with the summary for an unkeyed flight', () => {
    const locked = { ...meta, id: 'locked', hasKeychain: false }
    useTelemetryStore.setState({ catalog: [locked], selectedId: 'locked', path: null })
    render(<FramePanel />)
    expect(screen.getByText(/frames locked/i)).toBeInTheDocument()
    expect(screen.getByText('Matrice 400')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app && npx vitest run src/modules/telemetry/ui/FramePanel.test.tsx
```

Expected: FAIL — cannot resolve `./FramePanel`.

- [ ] **Step 3: Write the component**

```tsx
// Static flight summary above cursor-following readouts. Both halves come
// from different sources on purpose: the summary reads FlightMeta, which is
// available with no keychain, so an undecryptable flight still shows
// everything the log's details block knows.

import { useTelemetryStore } from '../store/telemetryStore'
import { distanceFromHomeM, sampleAt } from '../domain/flightPath'
import { fmtDate, fmtDuration, fmtHeading, fmtKm, fmtMeters, fmtSpeed } from '../domain/format'
import type { FlightMeta } from '../domain/types'
import './telemetry.css'

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="lbl">{label}</div>
      <div className="tm-readout-val">{value}</div>
    </div>
  )
}

function Summary({ meta }: { meta: FlightMeta }) {
  return (
    <div className="tm-summary">
      <div className="lbl">AIRCRAFT</div>
      <div className="tm-readout-val">{meta.aircraftName}</div>
      <div className="tm-readout-val" style={{ fontSize: 12, opacity: 0.7 }}>
        {meta.aircraftSn}
      </div>
      <div className="tm-readouts" style={{ marginTop: 12 }}>
        <Readout label="START" value={fmtDate(meta.startTime)} />
        <Readout label="DURATION" value={fmtDuration(meta.durationS)} />
        <Readout label="DISTANCE" value={fmtKm(meta.distanceKm)} />
        <Readout label="MAX ALT" value={fmtMeters(meta.maxHeightM)} />
        <Readout label="MAX SPEED" value={fmtSpeed(meta.maxSpeedMs)} />
        <Readout label="FRAMES" value={String(meta.recordCount)} />
      </div>
    </div>
  )
}

export default function FramePanel() {
  const path = useTelemetryStore((s) => s.path)
  const cursorT = useTelemetryStore((s) => s.cursorT)
  const loading = useTelemetryStore((s) => s.loading)
  const error = useTelemetryStore((s) => s.error)
  const selectedId = useTelemetryStore((s) => s.selectedId)
  const catalog = useTelemetryStore((s) => s.catalog)
  const sessionFlights = useTelemetryStore((s) => s.sessionFlights)

  const selectedMeta =
    path?.meta ?? [...sessionFlights, ...catalog].find((f) => f.id === selectedId) ?? null

  // Nothing to show at all: no selection, no in-flight decode, no error.
  // Loading/error can legitimately fire before a matching FlightMeta is
  // resolvable (e.g. a decode kicked off for an id not yet in the catalog),
  // so those must be able to render even when selectedMeta is still null.
  if (!selectedId && !path && !loading && !error) {
    return (
      <aside className="tm-panel">
        <div className="tm-empty lbl">SELECT A FLIGHT</div>
      </aside>
    )
  }

  const sample = path ? sampleAt(path, cursorT) : null

  return (
    <aside className="tm-panel">
      {selectedMeta && <Summary meta={selectedMeta} />}

      {loading && <div className="lbl">DECODING FLIGHT…</div>}
      {error && <div className="tm-error lbl">{error}</div>}

      {!loading && !error && !path && selectedMeta && (
        <div className="tm-locked">
          <div className="lbl">FRAMES LOCKED</div>
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
            No keychain baked for this log, so the recorded track cannot be decrypted. Everything
            above reads from the log&apos;s unencrypted details block.
          </div>
        </div>
      )}

      {path && sample && (
        <div className="tm-readouts">
          <Readout label="ALT AGL" value={fmtMeters(sample.height)} />
          <Readout label="ALT ASL" value={fmtMeters(sample.alt)} />
          <Readout label="GROUND SPD" value={fmtSpeed(sample.speedH)} />
          <Readout label="VERT SPD" value={fmtSpeed(sample.speedV)} />
          <Readout label="HEADING" value={fmtHeading(sample.heading)} />
          <Readout label="GIMBAL" value={fmtHeading(sample.gimbalPitch)} />
          <Readout label="BATTERY" value={`${Math.round(sample.battery)}%`} />
          <Readout label="VOLTAGE" value={`${sample.voltage.toFixed(1)} V`} />
          <Readout label="SATS" value={String(Math.round(sample.sats))} />
          <Readout label="MODE" value={sample.mode} />
          <Readout label="FROM HOME" value={fmtMeters(distanceFromHomeM(sample, path.meta.home))} />
        </div>
      )}
    </aside>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd app && npx vitest run src/modules/telemetry/ui/FramePanel.test.tsx
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/modules/telemetry/ui/FramePanel.tsx app/src/modules/telemetry/ui/FramePanel.test.tsx
git commit -m "feat(telemetry): read telemetry at the cursor"
```

---

## Task 18: Library filters

**Files:**
- Create: `app/src/modules/telemetry/ui/LibraryFilters.tsx`
- Test: `app/src/modules/telemetry/ui/LibraryFilters.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import LibraryFilters from './LibraryFilters'
import { useTelemetryStore } from '../store/telemetryStore'
import type { FlightMeta } from '../domain/types'

function flight(over: Partial<FlightMeta>): FlightMeta {
  return {
    id: 'f', file: 'f.txt', version: 14, encrypted: true, hasKeychain: true,
    aircraftName: 'Matrice 400', aircraftSn: 'SN1',
    startTime: '2026-02-17T06:27:04.690Z',
    durationS: 100, distanceKm: 5, maxHeightM: 50, maxSpeedMs: 10,
    recordCount: 10, home: { lon: 48, lat: 28.78 }, ...over,
  }
}

const initial = useTelemetryStore.getState()
beforeEach(() => {
  useTelemetryStore.setState(initial, true)
  useTelemetryStore.getState().setCatalog([
    flight({ id: 'a', aircraftSn: 'SN1' }),
    flight({ id: 'b', aircraftSn: 'SN2' }),
  ])
})
afterEach(() => cleanup())

describe('LibraryFilters', () => {
  // Scoped with within(): the component also renders a SORT select, so an
  // unscoped getAllByRole('option') collects all 7 options across both
  // selects, not the 3 belonging to the aircraft one.
  it('lists every distinct aircraft plus an all option', () => {
    render(<LibraryFilters />)
    const select = screen.getByLabelText(/aircraft/i)
    const options = within(select).getAllByRole('option').map((o) => o.textContent)
    expect(options[0]).toMatch(/all aircraft/i)
    expect(options).toHaveLength(3)
  })

  it('sets the aircraft filter', () => {
    render(<LibraryFilters />)
    fireEvent.change(screen.getByLabelText(/aircraft/i), { target: { value: 'SN2' } })
    expect(useTelemetryStore.getState().filters.aircraftSn).toBe('SN2')
  })

  it('clears the aircraft filter when all is chosen', () => {
    useTelemetryStore.getState().setFilters({ ...initial.filters, aircraftSn: 'SN2' })
    render(<LibraryFilters />)
    fireEvent.change(screen.getByLabelText(/aircraft/i), { target: { value: '' } })
    expect(useTelemetryStore.getState().filters.aircraftSn).toBeNull()
  })

  it('sets the text filter', () => {
    render(<LibraryFilters />)
    fireEvent.change(screen.getByLabelText(/search/i), { target: { value: 'm400' } })
    expect(useTelemetryStore.getState().filters.text).toBe('m400')
  })

  it('sets the date bounds', () => {
    render(<LibraryFilters />)
    fireEvent.change(screen.getByLabelText(/from/i), { target: { value: '2026-02-01' } })
    fireEvent.change(screen.getByLabelText(/to/i), { target: { value: '2026-02-28' } })
    const f = useTelemetryStore.getState().filters
    expect(f.from).toBe('2026-02-01')
    expect(f.to).toBe('2026-02-28')
  })

  it('sets minimum duration in whole minutes', () => {
    render(<LibraryFilters />)
    fireEvent.change(screen.getByLabelText(/min duration/i), { target: { value: '5' } })
    expect(useTelemetryStore.getState().filters.minDurationS).toBe(300)
  })

  it('changes the sort order', () => {
    render(<LibraryFilters />)
    fireEvent.change(screen.getByLabelText(/sort/i), { target: { value: 'distance' } })
    expect(useTelemetryStore.getState().sort).toBe('distance')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app && npx vitest run src/modules/telemetry/ui/LibraryFilters.test.tsx
```

Expected: FAIL — cannot resolve `./LibraryFilters`.

- [ ] **Step 3: Write the component**

```tsx
// Filter controls over the flight library. Every control here reads a field
// that comes from a log's unencrypted details block, so filtering works
// identically whether or not a keychain was baked.

import { useId } from 'react'
import { aircraftOptions } from '../domain/filters'
import { useTelemetryStore } from '../store/telemetryStore'
import type { CatalogSort } from '../domain/types'
import './telemetry.css'

const SORTS: { value: CatalogSort; label: string }[] = [
  { value: 'newest', label: 'NEWEST FIRST' },
  { value: 'oldest', label: 'OLDEST FIRST' },
  { value: 'duration', label: 'LONGEST' },
  { value: 'distance', label: 'FURTHEST' },
]

export default function LibraryFilters() {
  const catalog = useTelemetryStore((s) => s.catalog)
  const sessionFlights = useTelemetryStore((s) => s.sessionFlights)
  const filters = useTelemetryStore((s) => s.filters)
  const sort = useTelemetryStore((s) => s.sort)
  // Actions via getState(), not selectors -- see the conventions section.
  const store = useTelemetryStore

  const ids = useId()
  const aircraft = aircraftOptions([...sessionFlights, ...catalog])

  return (
    <div className="tm-filters">
      <div>
        <label className="lbl" htmlFor={`${ids}-search`}>SEARCH</label>
        <input
          id={`${ids}-search`}
          type="search"
          placeholder="aircraft, serial, file"
          value={filters.text}
          onChange={(e) => store.getState().setFilters({ ...filters, text: e.target.value })}
        />
      </div>

      <div>
        <label className="lbl" htmlFor={`${ids}-aircraft`}>AIRCRAFT</label>
        <select
          id={`${ids}-aircraft`}
          value={filters.aircraftSn ?? ''}
          onChange={(e) => store.getState().setFilters({ ...filters, aircraftSn: e.target.value || null })}
        >
          <option value="">ALL AIRCRAFT</option>
          {aircraft.map((a) => (
            <option key={a.sn} value={a.sn}>
              {a.name} · {a.sn.slice(-6)}
            </option>
          ))}
        </select>
      </div>

      <div className="tm-filter-row">
        <div style={{ flex: 1 }}>
          <label className="lbl" htmlFor={`${ids}-from`}>FROM</label>
          <input
            id={`${ids}-from`}
            type="date"
            value={filters.from ?? ''}
            onChange={(e) => store.getState().setFilters({ ...filters, from: e.target.value || null })}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label className="lbl" htmlFor={`${ids}-to`}>TO</label>
          <input
            id={`${ids}-to`}
            type="date"
            value={filters.to ?? ''}
            onChange={(e) => store.getState().setFilters({ ...filters, to: e.target.value || null })}
          />
        </div>
      </div>

      <div className="tm-filter-row">
        <div style={{ flex: 1 }}>
          {/* Minutes in the UI, seconds in the model: nobody filters flights
              by the second, and FlightMeta.durationS is seconds. */}
          <label className="lbl" htmlFor={`${ids}-dur`}>MIN DURATION (MIN)</label>
          <input
            id={`${ids}-dur`}
            type="number"
            min={0}
            value={filters.minDurationS === 0 ? '' : Math.round(filters.minDurationS / 60)}
            onChange={(e) =>
              store.getState().setFilters({ ...filters, minDurationS: Math.max(0, Number(e.target.value) || 0) * 60 })
            }
          />
        </div>
        <div style={{ flex: 1 }}>
          <label className="lbl" htmlFor={`${ids}-sort`}>SORT</label>
          <select
            id={`${ids}-sort`}
            value={sort}
            onChange={(e) => store.getState().setSort(e.target.value as CatalogSort)}
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd app && npx vitest run src/modules/telemetry/ui/LibraryFilters.test.tsx
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/modules/telemetry/ui/LibraryFilters.tsx app/src/modules/telemetry/ui/LibraryFilters.test.tsx
git commit -m "feat(telemetry): filter the flight library"
```

---

## Task 19: Flight library list

**Files:**
- Create: `app/src/modules/telemetry/ui/FlightLibrary.tsx`
- Test: `app/src/modules/telemetry/ui/FlightLibrary.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import FlightLibrary from './FlightLibrary'
import { useTelemetryStore } from '../store/telemetryStore'
import type { FlightMeta } from '../domain/types'

function flight(over: Partial<FlightMeta>): FlightMeta {
  return {
    id: 'f', file: 'f.txt', version: 14, encrypted: true, hasKeychain: true,
    aircraftName: 'Matrice 400', aircraftSn: 'SN1',
    startTime: '2026-02-17T06:27:04.690Z',
    durationS: 2722.9, distanceKm: 22.07, maxHeightM: 50, maxSpeedMs: 17,
    recordCount: 27229, home: { lon: 48, lat: 28.78 }, ...over,
  }
}

const initial = useTelemetryStore.getState()
beforeEach(() => useTelemetryStore.setState(initial, true))
afterEach(() => cleanup())

describe('FlightLibrary', () => {
  it('shows an empty state with no flights', () => {
    render(<FlightLibrary onOpen={vi.fn()} />)
    expect(screen.getByText(/no flights/i)).toBeInTheDocument()
  })

  it('renders one row per flight with its stats', () => {
    useTelemetryStore.getState().setCatalog([flight({ id: 'a' })])
    render(<FlightLibrary onOpen={vi.fn()} />)
    expect(screen.getByText('2026-02-17 06:27')).toBeInTheDocument()
    expect(screen.getByText(/45m 23s/)).toBeInTheDocument()
    expect(screen.getByText(/22\.1 km/)).toBeInTheDocument()
  })

  // Scoped to .tm-list. FlightLibrary renders LibraryFilters, whose aircraft
  // <select> formats its options exactly as the group headings do
  // (`${name} · ${sn.slice(-6)}`), so an unscoped query matches 4 elements:
  // two options and two headings.
  it('groups rows under an aircraft heading', () => {
    useTelemetryStore.getState().setCatalog([
      flight({ id: 'a', aircraftSn: 'SN1' }),
      flight({ id: 'b', aircraftSn: 'SN2' }),
    ])
    const { container } = render(<FlightLibrary onOpen={vi.fn()} />)
    const list = container.querySelector('.tm-list') as HTMLElement
    expect(within(list).getAllByText(/Matrice 400/)).toHaveLength(2)
  })

  it('calls onOpen with the flight when a row is clicked', () => {
    const onOpen = vi.fn()
    const a = flight({ id: 'a' })
    useTelemetryStore.getState().setCatalog([a])
    render(<FlightLibrary onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: /06:27/ }))
    expect(onOpen).toHaveBeenCalledWith(a)
  })

  it('marks the selected row as current', () => {
    useTelemetryStore.getState().setCatalog([flight({ id: 'a' })])
    useTelemetryStore.getState().select('a')
    render(<FlightLibrary onOpen={vi.fn()} />)
    expect(screen.getByRole('button', { name: /06:27/ })).toHaveAttribute('aria-current', 'true')
  })

  it('tags session drop-ins distinctly', () => {
    useTelemetryStore.getState().addSessionFlight(flight({ id: 'dropped' }))
    render(<FlightLibrary onOpen={vi.fn()} />)
    expect(screen.getByText(/· DROPPED/)).toBeInTheDocument()
  })

  it('offers no clear control until something has been dropped', () => {
    useTelemetryStore.getState().setCatalog([flight({ id: 'a' })])
    render(<FlightLibrary onOpen={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument()
  })

  it('clears session drop-ins on demand', () => {
    useTelemetryStore.getState().addSessionFlight(flight({ id: 'dropped' }))
    render(<FlightLibrary onOpen={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /clear 1 dropped/i }))
    expect(useTelemetryStore.getState().sessionFlights).toEqual([])
  })

  it('reports when filters exclude everything', () => {
    useTelemetryStore.getState().setCatalog([flight({ id: 'a' })])
    useTelemetryStore.getState().setFilters({ ...initial.filters, text: 'zzz' })
    render(<FlightLibrary onOpen={vi.fn()} />)
    expect(screen.getByText(/no flights match/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app && npx vitest run src/modules/telemetry/ui/FlightLibrary.test.tsx
```

Expected: FAIL — cannot resolve `./FlightLibrary`.

- [ ] **Step 3: Write the component**

```tsx
// The flight library. Grouping is by aircraft serial rather than name
// because these logs come from two distinct airframes that share the name
// "Matrice 400" (spec section 3.2) -- grouping by name would merge them.

import { useMemo } from 'react'
import LibraryFilters from './LibraryFilters'
import { selectVisibleFlights, useTelemetryStore } from '../store/telemetryStore'
import { fmtDate, fmtDuration, fmtKm, fmtMeters } from '../domain/format'
import type { FlightMeta } from '../domain/types'
import './telemetry.css'

interface FlightLibraryProps {
  onOpen: (meta: FlightMeta) => void
}

function groupBySerial(flights: FlightMeta[]): { sn: string; name: string; flights: FlightMeta[] }[] {
  const groups: { sn: string; name: string; flights: FlightMeta[] }[] = []
  for (const f of flights) {
    const existing = groups.find((g) => g.sn === f.aircraftSn)
    if (existing) existing.flights.push(f)
    else groups.push({ sn: f.aircraftSn, name: f.aircraftName, flights: [f] })
  }
  return groups
}

export default function FlightLibrary({ onOpen }: FlightLibraryProps) {
  // Four raw slices plus a memo, NOT a store method returning a fresh array:
  // see the note on selectVisibleFlights in the store.
  const catalog = useTelemetryStore((s) => s.catalog)
  const sessionFlights = useTelemetryStore((s) => s.sessionFlights)
  const filters = useTelemetryStore((s) => s.filters)
  const sort = useTelemetryStore((s) => s.sort)
  const selectedId = useTelemetryStore((s) => s.selectedId)
  // Action via getState(), not a selector -- see the conventions section.

  const visible = useMemo(
    () => selectVisibleFlights({ catalog, sessionFlights, filters, sort }),
    [catalog, sessionFlights, filters, sort],
  )
  const sessionIds = sessionFlights.map((f) => f.id)
  const total = catalog.length + sessionFlights.length

  return (
    <aside className="tm-library">
      <LibraryFilters />
      {sessionFlights.length > 0 && (
        <button className="tm-btn" style={{ margin: '0 12px 8px' }} onClick={() => useTelemetryStore.getState().clearSessionFlights()}>
          CLEAR {sessionFlights.length} DROPPED
        </button>
      )}
      <div className="tm-list">
        {total === 0 && <div className="tm-empty lbl">NO FLIGHTS LOADED</div>}
        {total > 0 && visible.length === 0 && (
          <div className="tm-empty lbl">NO FLIGHTS MATCH THESE FILTERS</div>
        )}
        {groupBySerial(visible).map((group) => (
          <div key={group.sn}>
            <div className="tm-group lbl">
              {group.name} · {group.sn.slice(-6)}
            </div>
            {group.flights.map((f) => (
              <button
                key={f.id}
                className="tm-flight"
                aria-current={f.id === selectedId ? 'true' : undefined}
                onClick={() => onOpen(f)}
              >
                <div className="tm-flight-time">
                  {fmtDate(f.startTime)}
                  {sessionIds.includes(f.id) && <span className="tm-session-tag"> · DROPPED</span>}
                </div>
                <div className="tm-flight-stats lbl">
                  {fmtDuration(f.durationS)} · {fmtKm(f.distanceKm)} · {fmtMeters(f.maxHeightM)}
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </aside>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd app && npx vitest run src/modules/telemetry/ui/FlightLibrary.test.tsx
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/modules/telemetry/ui/FlightLibrary.tsx app/src/modules/telemetry/ui/FlightLibrary.test.tsx
git commit -m "feat(telemetry): browse the flight library"
```

---

## Task 20: Topbar

**Files:**
- Create: `app/src/modules/telemetry/ui/TelemetryTopbar.tsx`
- Test: `app/src/modules/telemetry/ui/TelemetryTopbar.test.tsx`

Follows `PlannerTopbar.tsx`: brand home link, offline chip, spacer, then `LAYERS` in the same slot the console and planner put it, so the control sits in one place in the user's memory across all three modules.

- [ ] **Step 1: Read the planner topbar and its layers menu for the pattern to mirror**

```bash
cd app && sed -n 1,200p src/modules/planner/ui/PlannerTopbar.tsx
cd app && sed -n 1,120p src/modules/planner/ui/PlannerLayersMenu.tsx
```

Reuse `PlannerLayersMenu` directly if its props allow; if it is bound to planner state, copy it to `ui/TelemetryLayersMenu.tsx` and adapt. Record which you did in a comment.

- [ ] **Step 2: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { MemoryRouter } from 'react-router-dom'
import TelemetryTopbar from './TelemetryTopbar'

afterEach(() => cleanup())

function renderBar(onLoad = vi.fn()) {
  render(
    <MemoryRouter>
      <TelemetryTopbar onLoadFile={onLoad} />
    </MemoryRouter>,
  )
  return onLoad
}

describe('TelemetryTopbar', () => {
  it('links the brand home to the module landing page', () => {
    renderBar()
    expect(screen.getByRole('link')).toHaveAttribute('href', '/')
  })

  it('offers a load control', () => {
    renderBar()
    expect(screen.getByText(/load log/i)).toBeInTheDocument()
  })

  it('passes a chosen file up', () => {
    const onLoad = renderBar()
    const file = new File(['x'], 'flight.txt', { type: 'text/plain' })
    const input = screen.getByLabelText(/load log/i)
    fireEvent.change(input, { target: { files: [file] } })
    expect(onLoad).toHaveBeenCalledWith(file)
  })

  it('ignores a change event with no file', () => {
    const onLoad = renderBar()
    fireEvent.change(screen.getByLabelText(/load log/i), { target: { files: [] } })
    expect(onLoad).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd app && npx vitest run src/modules/telemetry/ui/TelemetryTopbar.test.tsx
```

Expected: FAIL — cannot resolve `./TelemetryTopbar`.

- [ ] **Step 4: Write the component**

```tsx
// Telemetry chrome. Same arrangement as PlannerTopbar: brand home link and
// offline chip, spacer, then the action row led by basemap LAYERS -- the
// slot the console's #btn-layers and the planner's own LAYERS both occupy,
// so the control lives in one place in the user's memory across modules.

import { useRef } from 'react'
import type { ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import OfflineChip from '@/modules/console/OfflineChip'
import './telemetry.css'

export interface TelemetryTopbarProps {
  onLoadFile: (file: File) => void
}

export default function TelemetryTopbar({ onLoadFile }: TelemetryTopbarProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Resetting the value lets the same file be chosen twice in a row, which
    // matters while iterating on one log in a demo.
    e.target.value = ''
    if (file) onLoadFile(file)
  }

  return (
    <header className="tm-topbar">
      <Link className="tm-brand lbl" to="/">
        e& · TELEMETRY
      </Link>
      <OfflineChip />
      <div className="tm-sp" />
      <label className="tm-btn" htmlFor="tm-load">
        LOAD LOG
      </label>
      <input
        id="tm-load"
        ref={inputRef}
        type="file"
        accept=".txt"
        aria-label="Load log"
        style={{ display: 'none' }}
        onChange={handleChange}
      />
    </header>
  )
}
```

> **Note on `LAYERS`:** the basemap control is spec section 8.1 and is **not optional**. It is Task 27 rather than part of this task only because whether `PlannerLayersMenu` can be reused is unknown until Step 1 is done. Task 27 must complete before Task 26 takes the module live.

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd app && npx vitest run src/modules/telemetry/ui/TelemetryTopbar.test.tsx
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add app/src/modules/telemetry/ui/TelemetryTopbar.tsx app/src/modules/telemetry/ui/TelemetryTopbar.test.tsx
git commit -m "feat(telemetry): add the telemetry topbar"
```

---

## Task 21: Flight loading

**Files:**
- Create: `app/src/modules/telemetry/ui/useFlightLoader.ts`
- Test: `app/src/modules/telemetry/ui/useFlightLoader.test.ts`

The cache-then-fetch-then-decode path, plus the drop-in path. This is where spec section 9's degradation table becomes code.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useFlightLoader } from './useFlightLoader'
import { useTelemetryStore } from '../store/telemetryStore'
import * as cache from '../io/flightCache'
import * as parse from '../io/parseFlight'
import type { FlightMeta, FlightPath } from '../domain/types'

const meta: FlightMeta = {
  id: 'a', file: 'a.txt', version: 14, encrypted: true, hasKeychain: true,
  aircraftName: 'Matrice 400', aircraftSn: 'SN1',
  startTime: '2026-02-17T06:27:04.690Z',
  durationS: 30, distanceKm: 1, maxHeightM: 100, maxSpeedMs: 10,
  recordCount: 1, home: { lon: 48, lat: 28.78 },
}

const path: FlightPath = { meta, samples: [] }

const initial = useTelemetryStore.getState()

beforeEach(() => {
  useTelemetryStore.setState(initial, true)
  vi.restoreAllMocks()
  vi.spyOn(cache, 'getCachedPath').mockResolvedValue(null)
  vi.spyOn(cache, 'putCachedPath').mockResolvedValue()
  vi.spyOn(parse, 'decodeFlight').mockResolvedValue(path)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    json: () => Promise.resolve([{ k: 1 }]),
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('openFlight', () => {
  it('serves a cached path without fetching', async () => {
    vi.mocked(cache.getCachedPath).mockResolvedValue(path)
    const { result } = renderHook(() => useFlightLoader())
    await act(() => result.current.openFlight(meta))
    expect(fetch).not.toHaveBeenCalled()
    expect(useTelemetryStore.getState().path).toBe(path)
  })

  it('fetches the log and its keychain on a cache miss', async () => {
    const { result } = renderHook(() => useFlightLoader())
    await act(() => result.current.openFlight(meta))
    const urls = vi.mocked(fetch).mock.calls.map((c) => c[0] as string)
    expect(urls.some((u) => u.endsWith('flights/a.txt'))).toBe(true)
    expect(urls.some((u) => u.endsWith('flights/a.keychain.json'))).toBe(true)
  })

  it('caches the decoded path', async () => {
    const { result } = renderHook(() => useFlightLoader())
    await act(() => result.current.openFlight(meta))
    expect(cache.putCachedPath).toHaveBeenCalledWith(path)
  })

  it('selects the flight and clears loading on success', async () => {
    const { result } = renderHook(() => useFlightLoader())
    await act(() => result.current.openFlight(meta))
    const s = useTelemetryStore.getState()
    expect(s.selectedId).toBe('a')
    expect(s.loading).toBe(false)
    expect(s.error).toBeNull()
  })

  // An unkeyed v13+ flight is not an error: FramePanel renders the summary
  // and FRAMES LOCKED from the metadata alone (spec section 9).
  it('skips decoding entirely for a flight with no keychain', async () => {
    const { result } = renderHook(() => useFlightLoader())
    await act(() => result.current.openFlight({ ...meta, hasKeychain: false }))
    expect(parse.decodeFlight).not.toHaveBeenCalled()
    const s = useTelemetryStore.getState()
    expect(s.path).toBeNull()
    expect(s.error).toBeNull()
    expect(s.loading).toBe(false)
  })

  it('decodes without a keychain for a pre-v13 log', async () => {
    const { result } = renderHook(() => useFlightLoader())
    await act(() => result.current.openFlight({ ...meta, version: 12, encrypted: false }))
    expect(vi.mocked(parse.decodeFlight).mock.calls[0][1]).toBeNull()
  })

  it('surfaces a decode failure as an error', async () => {
    vi.mocked(parse.decodeFlight).mockRejectedValue(new Error('bad keychain'))
    const { result } = renderHook(() => useFlightLoader())
    await act(() => result.current.openFlight(meta))
    expect(useTelemetryStore.getState().error).toMatch(/bad keychain/)
  })

  it('surfaces a failed log fetch as an error', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 404 } as Response)
    const { result } = renderHook(() => useFlightLoader())
    await act(() => result.current.openFlight(meta))
    expect(useTelemetryStore.getState().error).toBeTruthy()
    expect(useTelemetryStore.getState().loading).toBe(false)
  })
})

describe('openDroppedFile', () => {
  function file(name = 'flight.txt') {
    const f = new File(['abc'], name)
    f.arrayBuffer = () => Promise.resolve(new ArrayBuffer(8))
    return f
  }

  it('adds the dropped flight to the session list and selects it', async () => {
    const { result } = renderHook(() => useFlightLoader())
    await act(() => result.current.openDroppedFile(file()))
    const s = useTelemetryStore.getState()
    expect(s.sessionFlights).toHaveLength(1)
    expect(s.selectedId).toBe(s.sessionFlights[0].id)
  })

  it('reports a file that is not a DJI flight record', async () => {
    vi.mocked(parse.decodeFlight).mockRejectedValue(new Error('not a dji log'))
    const { result } = renderHook(() => useFlightLoader())
    await act(() => result.current.openDroppedFile(file()))
    expect(useTelemetryStore.getState().error).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app && npx vitest run src/modules/telemetry/ui/useFlightLoader.test.ts
```

Expected: FAIL — cannot resolve `./useFlightLoader`.

- [ ] **Step 3: Write the hook**

```ts
// Opening a flight: cache, then fetch, then decode. Every failure path here
// lands in the store as an error string rather than a throw -- spec section
// 9's rule that the library stays usable whatever one flight does.

import { useCallback } from 'react'
import { decodeFlight } from '../io/parseFlight'
import { getCachedPath, putCachedPath } from '../io/flightCache'
import { useTelemetryStore } from '../store/telemetryStore'
import type { FlightMeta } from '../domain/types'

const BASE = import.meta.env.BASE_URL

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`could not load flight log (HTTP ${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}

async function fetchKeychains(url: string): Promise<unknown[] | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return (await res.json()) as unknown[]
  } catch {
    return null
  }
}

// A dropped file has no catalog entry, so it gets a provisional one. The real
// aircraft and totals are unknown until the log is decoded; the worker
// returns the meta it was given, so these placeholders are what the summary
// shows for a drop-in. That is a known, accepted limitation of the drop path.
function provisionalMeta(file: File): FlightMeta {
  return {
    id: `dropped:${file.name}`,
    file: file.name,
    version: 0,
    encrypted: false,
    hasKeychain: false,
    aircraftName: 'DROPPED LOG',
    aircraftSn: file.name,
    startTime: new Date(file.lastModified).toISOString(),
    durationS: 0,
    distanceKm: 0,
    maxHeightM: 0,
    maxSpeedMs: 0,
    recordCount: 0,
    home: { lon: 0, lat: 0 },
  }
}

export function useFlightLoader() {
  const store = useTelemetryStore

  const openFlight = useCallback(
    async (meta: FlightMeta) => {
      const { select, setLoading, setPath, setError } = store.getState()
      select(meta.id)

      const cached = await getCachedPath(meta.id)
      if (cached) return setPath(cached)

      // An encrypted log with no baked keychain is a legitimate resting
      // state, not a failure: FramePanel renders the summary and FRAMES
      // LOCKED from metadata alone.
      if (meta.encrypted && !meta.hasKeychain) {
        setLoading(false)
        return
      }

      setLoading(true)
      try {
        const bytes = await fetchBytes(`${BASE}flights/${meta.file}`)
        const keychains = meta.encrypted
          ? await fetchKeychains(`${BASE}flights/${meta.id}.keychain.json`)
          : null
        const path = await decodeFlight(bytes, keychains, meta)
        setPath(path)
        void putCachedPath(path)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'could not open flight')
      }
    },
    [store],
  )

  const openDroppedFile = useCallback(
    async (file: File) => {
      const { addSessionFlight, select, setLoading, setPath, setError } = store.getState()
      const meta = provisionalMeta(file)
      addSessionFlight(meta)
      select(meta.id)
      setLoading(true)
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        // A dropped log carries no keychain. Pre-v13 logs decode anyway;
        // v13+ ones fail here and surface as an error, which is the honest
        // outcome given DJI's endpoint cannot be reached from the browser.
        const path = await decodeFlight(bytes, null, meta)
        setPath(path)
        void putCachedPath(path)
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        setError(`Could not read ${file.name}: ${reason}`)
      }
    },
    [store],
  )

  return { openFlight, openDroppedFile }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd app && npx vitest run src/modules/telemetry/ui/useFlightLoader.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/modules/telemetry/ui/useFlightLoader.ts app/src/modules/telemetry/ui/useFlightLoader.test.ts
git commit -m "feat(telemetry): open a flight from cache, catalog or a dropped file"
```

---

## Task 22: Playback loop

**Files:**
- Create: `app/src/modules/telemetry/ui/usePlayback.ts`
- Test: `app/src/modules/telemetry/ui/usePlayback.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { usePlayback } from './usePlayback'
import { useTelemetryStore } from '../store/telemetryStore'
import type { FlightMeta, FlightPath } from '../domain/types'

const meta: FlightMeta = {
  id: 'a', file: 'a.txt', version: 14, encrypted: true, hasKeychain: true,
  aircraftName: 'Matrice 400', aircraftSn: 'SN1',
  startTime: '2026-02-17T06:27:04.690Z',
  durationS: 100, distanceKm: 1, maxHeightM: 100, maxSpeedMs: 10,
  recordCount: 2, home: { lon: 48, lat: 28.78 },
}

const path: FlightPath = {
  meta,
  samples: [
    { t: 0, lon: 48, lat: 28.78, alt: 0, height: 0, speedH: 0, speedV: 0, heading: 0, gimbalPitch: 0, battery: 100, voltage: 50, sats: 20, mode: 'GPSAtti' },
    { t: 100, lon: 48.01, lat: 28.79, alt: 90, height: 50, speedH: 5, speedV: 0, heading: 90, gimbalPitch: -30, battery: 80, voltage: 49, sats: 32, mode: 'GPSWaypoint' },
  ],
}

// Drives rAF by hand so the loop is deterministic instead of wall-clock bound.
let frame: ((t: number) => void) | null = null
const initial = useTelemetryStore.getState()

beforeEach(() => {
  useTelemetryStore.setState(initial, true)
  frame = null
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
    frame = cb
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function tick(ms: number) {
  act(() => frame?.(ms))
}

describe('usePlayback', () => {
  it('does not advance the cursor while paused', () => {
    useTelemetryStore.getState().setPath(path)
    renderHook(() => usePlayback())
    tick(0)
    tick(1000)
    expect(useTelemetryStore.getState().cursorT).toBe(0)
  })

  it('advances the cursor in real time at 1x', () => {
    useTelemetryStore.getState().setPath(path)
    useTelemetryStore.getState().togglePlay()
    renderHook(() => usePlayback())
    tick(0)
    tick(2000)
    expect(useTelemetryStore.getState().cursorT).toBeCloseTo(2, 1)
  })

  // A 45-minute survey flight at 1x is unwatchable in a meeting; 16x is what
  // makes the replay demo-length.
  it('advances 16x faster at rate 16', () => {
    useTelemetryStore.getState().setPath(path)
    useTelemetryStore.getState().togglePlay()
    useTelemetryStore.setState({ rate: 16 })
    renderHook(() => usePlayback())
    tick(0)
    tick(1000)
    expect(useTelemetryStore.getState().cursorT).toBeCloseTo(16, 1)
  })

  it('stops at the end of the flight', () => {
    useTelemetryStore.getState().setPath(path)
    useTelemetryStore.getState().togglePlay()
    useTelemetryStore.setState({ rate: 16 })
    renderHook(() => usePlayback())
    tick(0)
    tick(100000)
    const s = useTelemetryStore.getState()
    expect(s.cursorT).toBe(100)
    expect(s.playing).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app && npx vitest run src/modules/telemetry/ui/usePlayback.test.ts
```

Expected: FAIL — cannot resolve `./usePlayback`.

- [ ] **Step 3: Write the hook**

```ts
// Playback clock. Advances the cursor from wall-clock deltas rather than a
// fixed per-frame increment, so a dropped frame does not desynchronise the
// replay from elapsed time -- and so 16x means 16x on any refresh rate.

import { useEffect, useRef } from 'react'
import { useTelemetryStore } from '../store/telemetryStore'

export function usePlayback(): void {
  const playing = useTelemetryStore((s) => s.playing)
  const rate = useTelemetryStore((s) => s.rate)
  const last = useRef<number | null>(null)

  useEffect(() => {
    if (!playing) {
      last.current = null
      return
    }

    let raf = 0
    const step = (now: number) => {
      const prev = last.current
      last.current = now
      if (prev !== null) {
        const deltaS = ((now - prev) / 1000) * rate
        const { cursorT, setCursor } = useTelemetryStore.getState()
        setCursor(cursorT + deltaS)
      }
      // setCursor clears `playing` on reaching the end; re-reading it here
      // stops the loop on the same frame instead of one frame late.
      if (useTelemetryStore.getState().playing) raf = requestAnimationFrame(step)
    }

    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      last.current = null
    }
  }, [playing, rate])
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd app && npx vitest run src/modules/telemetry/ui/usePlayback.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/modules/telemetry/ui/usePlayback.ts app/src/modules/telemetry/ui/usePlayback.test.ts
git commit -m "feat(telemetry): play a flight back against the wall clock"
```

---

## Task 23: Route root

**Files:**
- Create: `app/src/modules/telemetry/ui/Telemetry.tsx`
- Test: `app/src/modules/telemetry/ui/Telemetry.test.tsx`
- Modify: `app/src/App.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { MemoryRouter } from 'react-router-dom'
import Telemetry from './Telemetry'
import { useTelemetryStore } from '../store/telemetryStore'
import * as catalogIo from '../io/catalogIo'
import type { FlightMeta } from '../domain/types'

const meta: FlightMeta = {
  id: 'a', file: 'a.txt', version: 14, encrypted: true, hasKeychain: true,
  aircraftName: 'Matrice 400', aircraftSn: 'SN1',
  startTime: '2026-02-17T06:27:04.690Z',
  durationS: 2722.9, distanceKm: 22.07, maxHeightM: 50, maxSpeedMs: 17,
  recordCount: 27229, home: { lon: 48, lat: 28.78 },
}

// MapView builds a real MapLibre instance, which jsdom cannot host. Mocked to
// render its children immediately, the same approach Planner.test.tsx takes.
vi.mock('@/modules/console/map/MapView', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div data-testid="map">{children}</div>,
}))
vi.mock('@/modules/console/map/MapContext', () => ({
  useMap: () => ({ mapRef: { current: null }, ready: false }),
}))

const initial = useTelemetryStore.getState()

beforeEach(() => {
  useTelemetryStore.setState(initial, true)
  vi.spyOn(catalogIo, 'fetchCatalog').mockResolvedValue({ version: 1, flights: [meta] })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderRoute() {
  render(
    <MemoryRouter>
      <Telemetry />
    </MemoryRouter>,
  )
}

describe('Telemetry', () => {
  it('renders the chrome around the map', () => {
    renderRoute()
    expect(screen.getByTestId('map')).toBeInTheDocument()
    expect(screen.getByText(/load log/i)).toBeInTheDocument()
    expect(screen.getByRole('slider')).toBeInTheDocument()
  })

  it('loads the catalog into the library on mount', async () => {
    renderRoute()
    await waitFor(() => {
      expect(useTelemetryStore.getState().catalog).toHaveLength(1)
    })
    expect(await screen.findByText('2026-02-17 06:27')).toBeInTheDocument()
  })

  it('prompts to select a flight before one is opened', () => {
    renderRoute()
    expect(screen.getByText(/select a flight/i)).toBeInTheDocument()
  })

  // A failed catalog load must leave the module usable, not blank the route.
  it('renders with an empty library when the catalog cannot be loaded', async () => {
    vi.mocked(catalogIo.fetchCatalog).mockResolvedValue({ version: 1, flights: [] })
    renderRoute()
    expect(await screen.findByText(/no flights loaded/i)).toBeInTheDocument()
    expect(screen.getByRole('slider')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app && npx vitest run src/modules/telemetry/ui/Telemetry.test.tsx
```

Expected: FAIL — cannot resolve `./Telemetry`.

- [ ] **Step 3: Write the route root**

```tsx
// Route root. Composes the telemetry chrome around MapView and wires the
// map-bound hook from inside <TelemetryShell>, a child of <MapView>.
// MapView renders `{ready ? children : null}`, so the shell only mounts once
// the map's load event has fired -- the same arrangement Planner.tsx uses.

import { useEffect, useState } from 'react'
import MapView from '@/modules/console/map/MapView'
import { useMap } from '@/modules/console/map/MapContext'
import { useFlightLayers } from '../map/useFlightLayers'
import { buildTelemetryStyle } from '../map/telemetryStyle'
import { fetchCatalog } from '../io/catalogIo'
import { pathBounds } from '../domain/flightPath'
import { useTelemetryStore } from '../store/telemetryStore'
import TelemetryTopbar from './TelemetryTopbar'
import FlightLibrary from './FlightLibrary'
import FramePanel from './FramePanel'
import Scrubber from './Scrubber'
import { useFlightLoader } from './useFlightLoader'
import { usePlayback } from './usePlayback'
import './telemetry.css'

// The logs are Kuwaiti survey grids, not UAE operations (spec section 3.5),
// so there is no meaningful default camera. This frames the region the baked
// catalog sits in; opening a flight immediately fits to its real bounds.
const TELEMETRY_CENTER: [number, number] = [48.0, 28.78]
const TELEMETRY_ZOOM = 9

function TelemetryShell() {
  const { mapRef, ready } = useMap()
  const path = useTelemetryStore((s) => s.path)
  const cursorT = useTelemetryStore((s) => s.cursorT)

  useFlightLayers(mapRef, ready, path, cursorT)

  // Fit to the opened flight. These are 790x710m survey boxes, so the fit
  // lands near z16 -- a regional camera would show a dot.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !path) return
    const bounds = pathBounds(path)
    if (bounds) map.fitBounds(bounds, { padding: 80, duration: 900 })
  }, [mapRef, ready, path])

  return null
}

export default function Telemetry() {
  const [style] = useState(buildTelemetryStyle)
  // Action via getState(), not a selector -- see the conventions section.
  const { openFlight, openDroppedFile } = useFlightLoader()
  usePlayback()

  useEffect(() => {
    let alive = true
    void fetchCatalog(import.meta.env.BASE_URL).then((catalog) => {
      if (alive) useTelemetryStore.getState().setCatalog(catalog.flights)
    })
    return () => {
      alive = false
    }
  }, [])

  return (
    <main className="tm-root">
      <MapView
        initialCenter={TELEMETRY_CENTER}
        initialZoom={TELEMETRY_ZOOM}
        styleSpec={style}
        manageBasemap={false}
      >
        <TelemetryShell />
      </MapView>
      <TelemetryTopbar onLoadFile={(file) => void openDroppedFile(file)} />
      <FlightLibrary onOpen={(meta) => void openFlight(meta)} />
      <FramePanel />
      <Scrubber />
    </main>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd app && npx vitest run src/modules/telemetry/ui/Telemetry.test.tsx
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Point the route at the real module**

In `app/src/App.tsx`, add the lazy import alongside the existing two:

```tsx
const Telemetry = lazy(() => import('./modules/telemetry/ui/Telemetry'))
```

and replace the placeholder route:

```tsx
<Route path="/telemetry" element={<Telemetry />} />
```

`ModulePlaceholder` stays imported — `/compliance` still uses it.

- [ ] **Step 6: Verify the whole suite and the build**

```bash
cd app && npm run verify
```

Expected: lint, typecheck, all tests and the build pass.

- [ ] **Step 7: Commit**

```bash
git add app/src/modules/telemetry/ui/Telemetry.tsx app/src/modules/telemetry/ui/Telemetry.test.tsx app/src/App.tsx
git commit -m "feat(telemetry): mount the telemetry module at /telemetry"
```

---

## Task 24: Integration test

**Files:**
- Create: `app/src/modules/telemetry/telemetry.integration.test.ts`

Mirrors `planner/planner.integration.test.ts`: exercises domain, io and store together with no React tree, over a small hand-written fixture. No test in this repo decodes a real DJI log.

- [ ] **Step 1: Write the test**

```ts
// End-to-end over the pure layers: catalog validation -> filtering ->
// store selection -> path query -> map features. Deliberately no React and
// no WASM; the fixture is a dozen hand-written samples, never a real 9MB log.

import { describe, it, expect, beforeEach } from 'vitest'
import { parseCatalog } from './io/catalogIo'
import { normalizeFrames } from './io/normalizeFrames'
import type { RawFrame } from './io/normalizeFrames'
import { filterFlights, sortFlights } from './domain/filters'
import { sampleAt, pathBounds } from './domain/flightPath'
import { pathFeature, traversedFeature } from './map/telemetryStyle'
import { selectVisibleFlights, useTelemetryStore } from './store/telemetryStore'
import { NO_FILTERS } from './domain/types'

const rawCatalog = {
  version: 1,
  flights: [
    {
      id: 'm400-2026-02-17-0627', file: 'm400-2026-02-17-0627.txt', version: 14,
      encrypted: true, hasKeychain: true, aircraftName: 'Matrice 400',
      aircraftSn: '1581F8DBW258U00A', startTime: '2026-02-17T06:27:04.690Z',
      // maxHeightM is 104, NOT 50: a sample height of 49.9 also renders '50 m',
  // and getByText then matches two elements. The point of this test is that the
  // summary and the readouts show different numbers from different sources.
  durationS: 2722.9, distanceKm: 22.07, maxHeightM: 104, maxSpeedMs: 17.04,
      recordCount: 27229, home: { lon: 48.004, lat: 28.782 },
    },
    {
      id: 'm400-2026-02-17-0846', file: 'm400-2026-02-17-0846.txt', version: 14,
      encrypted: true, hasKeychain: true, aircraftName: 'Matrice 400',
      aircraftSn: '1581F5FKC257P00D', startTime: '2026-02-17T08:46:26.746Z',
      durationS: 1009.6, distanceKm: 6.01, maxHeightM: 50, maxSpeedMs: 15.13,
      recordCount: 5050, home: { lon: 48.004, lat: 28.782 },
    },
    { id: 'broken' },
  ],
}

function frame(secs: number, lon: number, lat: number): RawFrame {
  return {
    custom: { dateTime: new Date(Date.parse('2026-02-17T06:27:04.000Z') + secs * 1000).toISOString() },
    osd: {
      latitude: lat, longitude: lon, altitude: 430 + secs, height: secs,
      xSpeed: 3, ySpeed: 4, zSpeed: 1, yaw: 90, gpsNum: 32, flycState: 'GPSWaypoint',
    },
    gimbal: { pitch: -30 },
    battery: { chargeLevel: 100 - secs, voltage: 50 },
  }
}

const initial = useTelemetryStore.getState()
beforeEach(() => useTelemetryStore.setState(initial, true))

describe('telemetry end to end', () => {
  it('carries a catalog through validation, filtering and selection', () => {
    const catalog = parseCatalog(rawCatalog)
    expect(catalog).not.toBeNull()
    // The malformed third entry is dropped, the two real ones survive.
    expect(catalog?.flights).toHaveLength(2)

    useTelemetryStore.getState().setCatalog(catalog!.flights)
    useTelemetryStore.getState().setFilters({ ...NO_FILTERS, aircraftSn: '1581F5FKC257P00D' })
    const visible = selectVisibleFlights(useTelemetryStore.getState())
    expect(visible.map((f) => f.id)).toEqual(['m400-2026-02-17-0846'])
  })

  it('sorts the real catalog newest first', () => {
    const flights = parseCatalog(rawCatalog)!.flights
    expect(sortFlights(flights, 'newest')[0].id).toBe('m400-2026-02-17-0846')
    expect(sortFlights(flights, 'distance')[0].id).toBe('m400-2026-02-17-0627')
    expect(filterFlights(flights, { ...NO_FILTERS, minDurationS: 2000 })).toHaveLength(1)
  })

  it('normalizes frames and drives the map from the cursor', () => {
    const meta = parseCatalog(rawCatalog)!.flights[0]
    const frames = [
      frame(0, 48.0, 28.78),
      frame(10, 48.005, 28.785),
      frame(20, 48.01, 28.79),
    ]
    const path = normalizeFrames(frames, meta)
    expect(path.samples).toHaveLength(3)

    useTelemetryStore.getState().setPath(path)
    expect(useTelemetryStore.getState().cursorT).toBe(0)

    useTelemetryStore.getState().setCursor(15)
    const s = sampleAt(path, useTelemetryStore.getState().cursorT)
    expect(s?.height).toBeCloseTo(15)
    expect(s?.mode).toBe('GPSWaypoint')

    expect(pathBounds(path)).toEqual([[48.0, 28.78], [48.01, 28.79]])
    expect(pathFeature(path).features).toHaveLength(1)
    // Two of three samples are behind a 15s cursor.
    const traversed = traversedFeature(path, 15).features[0].geometry
    expect(traversed.coordinates).toHaveLength(2)
  })

  it('stops playback when the cursor is driven past the end', () => {
    const meta = parseCatalog(rawCatalog)!.flights[0]
    const path = normalizeFrames([frame(0, 48, 28.78), frame(20, 48.01, 28.79)], meta)
    useTelemetryStore.getState().setPath(path)
    useTelemetryStore.getState().togglePlay()
    expect(useTelemetryStore.getState().playing).toBe(true)
    useTelemetryStore.getState().setCursor(999)
    expect(useTelemetryStore.getState().playing).toBe(false)
    expect(useTelemetryStore.getState().cursorT).toBe(20)
  })
})
```

- [ ] **Step 2: Run it**

```bash
cd app && npx vitest run src/modules/telemetry/telemetry.integration.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 3: Commit**

```bash
git add app/src/modules/telemetry/telemetry.integration.test.ts
git commit -m "test(telemetry): exercise catalog, path and store together"
```

---

## Task 25: Bundle and browser verification

No new files. This is the task that checks the two claims the plan cannot prove with unit tests.

- [ ] **Step 1: Build and confirm the WASM stayed out of the main bundle**

```bash
cd app && npm run build && ls -lS dist/assets/ | head -20
```

Expected: a worker chunk of roughly 700 KB or more (the inlined WASM), and the entry chunk unchanged in size from before this module existed. If `dji-log-parser` bytes landed in the entry chunk, something other than `djiLog.worker.ts` imported the parser — find it with `grep -rn "dji-log-parser-js" src/` and route it through the worker.

- [ ] **Step 2: Serve the production build**

```bash
cd app && npm run preview
```

Open `http://localhost:4173/e-Sentinel/telemetry`.

- [ ] **Step 3: Verify in the browser**

Confirm each, and capture a screenshot of the opened flight:

1. The library lists three flights in THREE aircraft groups (the logs come from three distinct serials). This requires having run the bake tool locally first, since the logs are gitignored. If the library is empty, run `node tools/bake-flights.mjs` and reload.
2. Opening `m400-2026-02-17-0846` (the smallest log, fastest decode) draws a dense lawnmower survey grid and fits the camera to it.
3. The frame panel shows live readouts; scrubbing changes them.
4. Play at 16× replays the flight and stops at the end.
5. Reopening the same flight is instant (IndexedDB hit). Confirm in DevTools that no `.txt` request is made the second time.
6. Filters narrow the list; clearing them restores it.
7. `LOAD LOG` with a non-DJI file shows an error and leaves the library intact.
8. The console shows no errors, and specifically no `WebAssembly.Module is disallowed on the main thread`.

- [ ] **Step 4: Verify navigation away does not throw**

Navigate from `/telemetry` back to `/` mid-playback. Expected: no `Cannot read properties of undefined (reading 'getSource')` in the console — that is the failure `isMapUsable` guards against.

- [ ] **Step 5: Record the result**

If anything above fails, fix it and re-run before proceeding. Do not mark this task complete on partial verification.

---

## Task 26: Module 03 go-live

> **Run this LAST.** Tasks 27 and 28 below build two features spec sections 8.1 and 8.5 require; they are numbered after this one only because they were identified during plan self-review. Do not flip the landing card to ONLINE until both are done — the card claiming only what the module actually does is the whole point of Step 1.

**Files:**
- Modify: `app/src/modules/landing/modules.ts`
- Modify: `README.md`
- Test: `app/src/modules/landing/Landing.test.tsx` (existing, may need updating)

- [ ] **Step 1: Update the landing card**

In `app/src/modules/landing/modules.ts`, replace the `telemetry` entry:

```ts
  {
    num: '03',
    slug: 'telemetry',
    title: 'Telemetry',
    // The old blurb promised "fleet performance analytics", which this module
    // does not do, and used "track replay" -- a word that means detected
    // ground targets everywhere else in this codebase. Both corrected here,
    // on the same principle recorded on the planner card above: the landing
    // page is shown to government clients and partners, so every card claims
    // only what the module actually does today.
    blurb: 'Replay real DJI flight logs: path, altitude, battery and flight mode, frame by frame.',
    status: 'online',
    statusLabel: 'ONLINE',
    enabled: true,
  },
```

- [ ] **Step 2: Run the landing tests**

```bash
cd app && npx vitest run src/modules/landing/Landing.test.tsx
```

If a test asserts the count of online or planned modules, update it to match. Expected: PASS.

- [ ] **Step 3: Document the module in `README.md`**

Add to the Structure list, after the planner entry:

```markdown
- `app/src/modules/telemetry/` flight log review: decodes real DJI TXT flight
  records in a Web Worker, replays the path on the map with a scrubber and
  live telemetry readouts
```

And add a section after Run:

```markdown
## Flight logs

`/telemetry` reads real DJI TXT flight records from `app/public/flights/`.
DJI encrypts records from log version 13 onward, and DJI's keychain endpoint
sends no CORS headers, so keys are fetched offline rather than by the browser:

```bash
node tools/bake-flights.mjs            # needs DJI_API_KEY in .env
node tools/bake-flights.mjs --dry-run  # catalog only, no network, no key
```

This writes `index.json` and one `<id>.keychain.json` per log. The browser
then decodes the logs fully offline. See `.env.example` for the key, which is
never exposed to the client bundle.

The logs, their keychains and the catalog are gitignored. This repository is
public and the Pages workflow publishes `app/public/`, so real flight
coordinates, aircraft serials and decryption keys stay local. A fresh clone
loads `/telemetry` with an empty library and a working drop-in path; see
`app/public/flights/README.md`.
```

- [ ] **Step 4: Full verification**

```bash
cd app && npm run verify
```

Expected: lint, typecheck, every test and the build pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/modules/landing/modules.ts app/src/modules/landing/Landing.test.tsx README.md
git commit -m "feat(telemetry): take module 03 online"
```

---

## Task 27: Basemap LAYERS control

**Files:**
- Modify: `app/src/modules/telemetry/ui/TelemetryTopbar.tsx`
- Modify: `app/src/modules/telemetry/ui/TelemetryTopbar.test.tsx`
- Create (only if needed): `app/src/modules/telemetry/map/useTelemetryBasemap.ts`

Spec section 8.1. The console and planner both put `LAYERS` in the same topbar slot; telemetry must too, so the control lives in one place in the user's memory across all three modules. Identified during plan self-review — run before Task 26.

- [ ] **Step 1: Determine whether the planner's menu and basemap hook are reusable**

```bash
cd app && cat src/modules/planner/ui/PlannerLayersMenu.tsx
cd app && cat src/modules/planner/map/usePlannerBasemap.ts
```

Decide between:

- **Reusable** — `PlannerLayersMenu` takes the current layer and a setter as props and holds no planner state. Import it directly.
- **Planner-bound** — it reads `usePlanStore` or planner-specific layer ids. Copy both files into `modules/telemetry/`, rename to `TelemetryLayersMenu` / `useTelemetryBasemap`, and strip the planner coupling.

Record which, and why, in a comment at the import site.

- [ ] **Step 2: Write the failing test**

Add to `TelemetryTopbar.test.tsx`:

```tsx
  it('offers the basemap layers control', () => {
    renderBar()
    expect(screen.getByRole('button', { name: /layers/i })).toBeInTheDocument()
  })

  it('opens the layers menu on click', () => {
    renderBar()
    fireEvent.click(screen.getByRole('button', { name: /layers/i }))
    expect(screen.getByRole('button', { name: /satellite/i })).toBeInTheDocument()
  })
```

- [ ] **Step 3: Run to verify it fails**

```bash
cd app && npx vitest run src/modules/telemetry/ui/TelemetryTopbar.test.tsx
```

Expected: FAIL — no `layers` button.

- [ ] **Step 4: Render the menu in the topbar**

Place it immediately before the `LOAD LOG` label, matching the planner's ordering (`LAYERS` leads the action row after the spacer):

```tsx
      <div className="tm-sp" />
      <TelemetryLayersMenu layer={layer} onSelect={setLayer} />
      <label className="tm-btn" htmlFor="tm-load">
        LOAD LOG
      </label>
```

Lift `layer` state to `Telemetry.tsx` and pass it down, or read it from the basemap hook — whichever the Step 1 decision implies. Wire the chosen basemap hook inside `TelemetryShell` (it needs a live map instance, like every other map-bound hook).

- [ ] **Step 5: Run to verify it passes**

```bash
cd app && npx vitest run src/modules/telemetry/ui/TelemetryTopbar.test.tsx
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Confirm the basemap actually switches in the browser**

```bash
cd app && npm run dev
```

At `http://localhost:5173/telemetry`, cycle dark, light, satellite and terrain. Expected: the basemap changes and the flight path layers stay drawn on top. A path that disappears on switch means the style rebuild dropped the telemetry sources — re-seed them after `setStyle`.

- [ ] **Step 7: Commit**

```bash
git add app/src/modules/telemetry/
git commit -m "feat(telemetry): switch basemaps from the topbar"
```

---

## Task 28: Scrubber keyboard shortcuts

**Files:**
- Modify: `app/src/modules/telemetry/ui/Scrubber.tsx`
- Modify: `app/src/modules/telemetry/ui/Scrubber.test.tsx`

Spec section 8.5: space toggles play, arrows step, shift-arrow steps further. Identified during plan self-review — run before Task 26.

- [ ] **Step 1: Write the failing test**

Add to `Scrubber.test.tsx`:

```tsx
  it('toggles playback on space', () => {
    useTelemetryStore.getState().setPath(path)
    render(<Scrubber />)
    fireEvent.keyDown(window, { key: ' ' })
    expect(useTelemetryStore.getState().playing).toBe(true)
  })

  it('steps the cursor forward and back with the arrow keys', () => {
    useTelemetryStore.getState().setPath(path)
    useTelemetryStore.getState().setCursor(10)
    render(<Scrubber />)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(useTelemetryStore.getState().cursorT).toBeCloseTo(11)
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(useTelemetryStore.getState().cursorT).toBeCloseTo(10)
  })

  it('takes a larger step with shift held', () => {
    useTelemetryStore.getState().setPath(path)
    useTelemetryStore.getState().setCursor(30)
    render(<Scrubber />)
    fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true })
    expect(useTelemetryStore.getState().cursorT).toBeCloseTo(40)
  })

  // Space is also "activate" for a focused button, and the topbar's search
  // box needs its space bar to type. Shortcuts must stand down for both.
  it('ignores keys while a text field has focus', () => {
    useTelemetryStore.getState().setPath(path)
    render(
      <>
        <input aria-label="search" />
        <Scrubber />
      </>,
    )
    const input = screen.getByLabelText('search')
    input.focus()
    fireEvent.keyDown(input, { key: ' ' })
    expect(useTelemetryStore.getState().playing).toBe(false)
  })

  it('does nothing with no flight loaded', () => {
    render(<Scrubber />)
    fireEvent.keyDown(window, { key: ' ' })
    expect(useTelemetryStore.getState().playing).toBe(false)
  })
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd app && npx vitest run src/modules/telemetry/ui/Scrubber.test.tsx
```

Expected: FAIL — space does not toggle playback.

- [ ] **Step 3: Add the key handler to `Scrubber.tsx`**

Add these imports and the effect, inside the component and before the `return`:

```tsx
import { useEffect } from 'react'

const STEP_S = 1
const BIG_STEP_S = 10

// Window-level rather than on the slider: the operator's hands are on the
// map, not the transport, and requiring focus on a range input before space
// works would make the shortcut useless in practice.
useEffect(() => {
  function onKey(e: KeyboardEvent) {
    // Space activates a focused button and types into a search box. Standing
    // down for form controls keeps both working.
    const target = e.target as HTMLElement | null
    const tag = target?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return

    const { path: current, cursorT: at, setCursor: move, togglePlay: toggle } = useTelemetryStore.getState()
    if (!current || current.samples.length === 0) return

    const step = e.shiftKey ? BIG_STEP_S : STEP_S
    if (e.key === ' ') {
      e.preventDefault()
      toggle()
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      move(at + step)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      move(at - step)
    }
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}, [])
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd app && npx vitest run src/modules/telemetry/ui/Scrubber.test.tsx
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/modules/telemetry/ui/Scrubber.tsx app/src/modules/telemetry/ui/Scrubber.test.tsx
git commit -m "feat(telemetry): drive playback from the keyboard"
```
