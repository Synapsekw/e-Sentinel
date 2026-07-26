# Telemetry — Module 03 Design

Date: 2026-07-26
Status: approved (brainstorming round trip with the user, 2026-07-26)
Base: `master` @ `da075e4`

## 1. Purpose

Module 03 (`/telemetry`) exists today only as a landing card marked PLANNED and a route
pointed at `ModulePlaceholder`. This spec defines the module that fills it: a flight
review surface that replays **real DJI flight logs** — the operator picks a flight from a
filterable library, watches the path draw on the map, and scrubs through it reading live
telemetry at any point in the flight.

The rest of SENTINEL is simulated. This module is not: it decodes actual DJI TXT flight
records recorded by a Matrice 400. That is the point of it, and it constrains everything
below.

## 2. Scope

In scope:

1. An offline bake tool that fetches DJI keychains and builds a flight catalog.
2. A Web Worker that decodes DJI TXT logs to a normalized `FlightPath`.
3. A flight library with filters, backed by a committed catalog plus session drop-ins.
4. A map + scrubber + frame-panel review surface.
5. IndexedDB caching of decoded flights.
6. Module 03 landing card to ONLINE, with an honest blurb.

Out of scope, deliberately:

- **Charts.** Considered and rejected in brainstorming; the scrubber plus the frame panel
  carries the review without a charting layer the codebase does not have.
- Side-by-side comparison of two flights.
- KML / GPX / CSV export.
- Extraction of the images embedded in DJI logs (the parser supports it; nothing needs it).
- Cross-flight fleet analytics.
- Live or streaming telemetry.

## 3. Findings that constrain the design

These were established by probing the real logs in `~/Downloads` and the parser package,
not assumed. They are recorded because each one closes off an approach that would
otherwise look reasonable.

### 3.1 The logs are DJI TXT version 14, and encrypted

Header probe of `5_DJIFlightRecord_2026-02-17_[09-27-04].txt`: version 14, detail area
scrambled, record payloads and terminators encrypted. DJI encrypts TXT v13 and later with
AES; decryption requires a per-log **keychain** fetched from DJI's API with a developer
app key. No amount of client-side cleverness parses these files unaided.

### 3.2 The `details` block is NOT encrypted

Confirmed by running `dji-log-parser-js` against all three files with no key at all:

| File | Aircraft | Serial | Start (UTC) | Duration | Distance | Max alt | Records |
|---|---|---|---|---|---|---|---|
| `5_…[09-27-04]` | Matrice 400 | `1581F8DBW258U00A` | 2026-02-17 06:27:04 | 45m 23s | 22.1 km | 50 m | 27,229 |
| `15_…[09-52-28]` | Matrice 400 | `1581F8DBW259400A` | 2026-02-17 06:52:28 | 34m 52s | 10.6 km | 104 m | 20,915 |
| `15_…[11-46-26]` | Matrice 400 | `1581F8DBW259400A` | 2026-02-17 08:46:26 | 16m 50s | 6.0 km | 50 m | 5,050 |

This is load-bearing: **the entire library catalog can be built with no key and no
decryption.** Only opening a flight needs keychains. It is why an unkeyed flight still
renders as a full library row rather than an error.

Two distinct airframes are present (`…258U00A` and `…259400A`), and the first two flights
overlap in time — so grouping the library by aircraft serial carries real meaning rather
than being decoration, and the aircraft filter has something to filter.

Note for implementation: `Details.totalDistance` is documented as metres but reads
`10.586…` for a 35-minute flight at up to 17 m/s. It is kilometres. Verify against decoded
frames during implementation and record the answer in `flightPath.ts`; do not trust the
upstream doc comment.

### 3.3 DJI's keychain endpoint does not support CORS

`https://dev.dji.com/openapi/v1/flight-records/keychains` sends no CORS headers
([dji-sdk/FlightRecordParsingLib#31](https://github.com/dji-sdk/FlightRecordParsingLib/issues/31)).
A browser cannot fetch keychains. The upstream README suggests a public CORS proxy; that
was rejected — it puts the API key in client code and makes a client demo depend on a
third-party proxy and DJI's uptime. Keychains are baked offline instead.

### 3.4 The WASM must run in a Web Worker

`dji_log_parser_js.mjs` base64-inlines its WASM and instantiates it with a synchronous
`new WebAssembly.Module(bytes)`. Chrome forbids synchronous WASM compilation of buffers
larger than 4 KB **on the main thread**. So the worker is mandatory, not an optimisation.
It is also where we would have put it anyway: decoding 20,915 frames must not stall the
map.

The upside of base64 inlining is that there is no separate `.wasm` asset, so nothing
breaks under the `/e-Sentinel/` production base path.

### 3.5 The flights are not in the UAE

Home point is 28.782 N, 48.004 E — Kuwait. Every other SENTINEL surface is UAE-bound.
Telemetry frames wherever the log says; it has no UAE default camera when a flight is
open.

They are also **survey grids, not transits**: 22.1 km of path inside a 790 × 710 m
bounding box, flown in `GPSWaypoint` mode with 683 photos captured. Fit-to-bounds
therefore lands around z16, and the rendered path is a dense lawnmower pattern rather than
a long line. That reads well on a large screen — it looks like the real survey work it is
— but the path layer must stay legible at that density, so the traversed/untraversed
distinction carries more weight here than a line width would.

### 3.6 Decode is cheap; raw frames are enormous

Measured on the 27,229-record log, Node 24, M-series Mac:

| | |
|---|---|
| Keychain fetch (one-time, offline) | 1.29 s |
| `frames(keychains)` decode | **414 ms** |
| Frames with valid coordinates | 27,228 / 27,228 |
| Raw `Frame[]` as JSON | **65.2 MB** |

Two consequences. Decode speed is a non-issue, so the Web Worker is justified purely by
section 3.4's main-thread restriction and not by performance. And the 65.2 MB figure is
what makes section 6's normalization seam load-bearing rather than tidy: a 9 MB log
inflates roughly sevenfold if DJI's 100-field frame shape is retained. Nothing caches raw
frames.

Flight modes observed across the log — `GPSAtti`, `EngineStart`, `AutoTakeoff`,
`GPSWaypoint`, `ConfirmLanding` — are real enum values, so `FlightSample.mode` displays
directly without a synthesised label.

### 3.7 "Track" is already taken

`modules/console/panels/TrackPanel.tsx` and `domain/tracks` use *track* for detected
ground targets. This module uses **flight** (a log), **flight path** (the geometry), and
**frame** (one sample). Never "track".

## 4. Secrets and environment

Root `.env` (already gitignored, alongside `.env.local`) carries:

```
DJI_API_KEY=<developer.dji.com app key>
```

A committed `.env.example` documents it. Read **only** by `tools/bake-flights.mjs` under
Node. It is deliberately not `VITE_`-prefixed: that prefix would inline the key into the
client bundle, which is precisely the exposure this design avoids.

**Verified 2026-07-26.** The key on hand was described as a DJI *Cloud API* key, and the
keychain endpoint documents the *Open API* "SDK key" — so whether the two are the same
credential was the single risk the whole design rested on. Tested against
`5_DJIFlightRecord_2026-02-17_[09-27-04].txt`: HTTP 200, `result.code 0`, real AES
keychains returned, and `frames(keychains)` decoded 27,228 frames with valid coordinates
on every one. The risk is retired; sections 5 and 6 stand as written. See section 3.6 for
the measurements.

## 5. Data pipeline

Two stages: bake offline, decode online.

### 5.1 Offline — `tools/bake-flights.mjs`

Recreates the repo-root `tools/` directory (precedent: the removed `tools/bake-geo.mjs`).

```
reads   app/public/flights/*.txt
writes  app/public/flights/<id>.keychain.json    keychains for one log
        app/public/flights/index.json            the catalog
```

For each log: construct `DJILog`, read `version` and `details` (no key needed), then for
v13+ call `parser.keychainsRequest()` and POST it to the DJI endpoint with the
`Api-Key` header. Emit the catalog entry from `details` regardless of whether the
keychain call succeeded.

`--dry-run` writes only `index.json` and never touches the network, which is what makes
the catalog half of the tool exercisable without a key.

If the DJI API fails, the tool still writes `index.json`, prints which flights have no
keychain, and exits non-zero. A partial bake must never leave the module with no catalog.

Logs are copied into `app/public/flights/` under URL-safe slugs by hand, once, before the
tool ever runs — `m400-2026-02-17-0927.txt`, not
`5_DJIFlightRecord_2026-02-17_[09-27-04].txt`. Brackets in asset URLs are avoidable
trouble. The tool does not rename anything; it reads whatever `.txt` files it finds and
uses each filename stem as the flight id.

### 5.2 Asset location

`app/public/flights/`, which Vite copies into `dist/` automatically.

This deliberately differs from `videos/`, which sits at the repo root behind a dev-server
plugin and an explicit deploy-workflow step. That arrangement exists because 241 MB would
be duplicated into every build. The three logs total 19 MB; paying that copy on each build
buys us no dev-server middleware, no range-request handling, and no deploy-workflow
change. Revisit only if the catalog grows past roughly 100 MB.

### 5.3 Online

```
/telemetry (lazy route chunk)
  → fetch flights/index.json                    ~2 KB — library renders immediately
  → user opens a flight
      → IndexedDB hit?  → FlightPath, instant
      → miss:
          fetch <id>.txt + <id>.keychain.json
          → Worker: new DJILog(bytes).frames(keychains)
          → normalize → FlightPath
          → store in IndexedDB, keyed by flight id + normalizer version
  → drop-in: identical, bytes come from the File instead of a fetch
```

Nothing but static asset fetches cross the network at runtime. The module works offline
once cached, which is the condition it will actually be demoed in.

The IndexedDB key includes a normalizer version so that changing `flightPath.ts` in a
later build invalidates stale cached paths instead of silently serving them.

## 6. The normalization seam

The single most important boundary in the module. The worker converts DJI `Frame[]` into:

```ts
interface FlightSample {
  t: number          // seconds since takeoff
  lon: number
  lat: number
  alt: number        // ASL, metres
  height: number     // AGL, metres
  speedH: number     // m/s
  speedV: number     // m/s
  heading: number    // degrees
  gimbalPitch: number
  battery: number    // percent
  voltage: number
  sats: number
  mode: string       // flight mode label
}

interface FlightPath {
  meta: FlightMeta   // the catalog entry
  samples: FlightSample[]
}
```

Everything above this line — map layers, scrubber, frame panel, filters — knows only
`FlightPath` and has never heard of DJI. Three things follow:

- The UI is unit-testable against a small fixture with no WASM in the test run.
- A second log format later means one new producer, not a rewrite.
- The 100-field DJI `Frame` shape stays quarantined in `io/`.

## 7. Module layout

Mirrors the planner's domain / io / map / store / ui split.

```
app/src/modules/telemetry/
  domain/
    types.ts          FlightMeta, FlightSample, FlightPath, filter types
    flightPath.ts     sample lookup at t, derived values (distance from home, bounds)
    filters.ts        pure catalog filtering + sorting
    format.ts         telemetry-specific formatting not covered by chrome/format
  io/
    djiLog.worker.ts  the only file that imports dji-log-parser-js
    parseFlight.ts    worker client — post bytes, await FlightPath
    flightCache.ts    IndexedDB get/put, normalizer-versioned
    catalogIo.ts      fetch + validate index.json
  map/
    telemetryStyle.ts   style spec, planner's plannerStyle.ts as precedent
    useFlightLayers.ts  path, traversed path, home, position marker
  store/
    telemetryStore.ts   zustand: selectedFlightId, cursorT, playing, rate, filters
  ui/
    Telemetry.tsx  TelemetryTopbar.tsx  FlightLibrary.tsx  LibraryFilters.tsx
    FramePanel.tsx  Scrubber.tsx  telemetry.css
```

`vite.config.ts` gains one `manualChunks` line pinning `dji-log-parser-js` to its own
chunk, so 703 KB never reaches the entry bundle. `App.tsx` swaps `ModulePlaceholder` for
a `lazy()` `Telemetry`, matching how `/console` and `/planner` are loaded.

## 8. UI surface

### 8.1 Shell

Reuses the console's `MapView` with `manageBasemap={false}` and its own style spec —
exactly the arrangement `Planner.tsx` uses, and for the same reason (`useBasemap` drives
operational-layer visibility off the console's `scene`).

Topbar, left to right: e& brand home link and `OfflineChip` (every map surface carries
them), spacer, `LAYERS ▾` basemap menu in the same slot the console and planner put it,
then `LOAD LOG`.

Camera fits the selected flight's bounds. With nothing selected it frames the catalog's
home points.

### 8.2 Flight library (left)

Rows grouped by aircraft. Each row: start time, duration, distance, max altitude.
Session-dropped flights carry a distinct marker and a clear action.

### 8.3 Filters

Every filter is driven by metadata that costs nothing to read (section 3.2):

- aircraft (distinct `aircraftName` / `aircraftSn`)
- date range
- minimum duration
- free-text over aircraft name, serial and filename

Sort defaults to newest-first, switchable to duration or distance. All of it lives in
`domain/filters.ts` as pure functions over the catalog, fully unit-tested. That is the
whole filter set; each entry earns its place from data already in hand.

### 8.4 Frame panel (right)

A static summary block — aircraft, serial, start, duration, distance, max altitude and
speed — above live readouts that follow the cursor: altitude AGL and ASL, horizontal and
vertical speed, heading, gimbal pitch, battery percent and voltage, satellites, GPS level,
flight mode, distance from home.

### 8.5 Scrubber (bottom)

Play/pause, draggable cursor, `T+14:22 / 34:52`. Playback at 1× / 4× / 16×: a 35-minute
flight at 1× is unwatchable in a meeting, and 16× replays it in a little over two minutes.
Space toggles play; arrow keys step frames, shift-arrow steps further.

Playback advances the cursor from a `requestAnimationFrame` loop against wall-clock delta
times the rate, so a dropped frame does not desynchronise playback from elapsed time.

### 8.6 Map layers

Full flight path drawn dim; the traversed portion up to the cursor drawn bright; home
point marker; heading-aware position marker reusing the console's existing
`droneIconImage`.

## 9. Degradation

Every failure keeps the module usable. None of these is a crash or an empty screen.

| Situation | Behaviour |
|---|---|
| v13+ flight with no baked keychain | Library row shows full metadata; opening shows the summary and home point with `FRAMES LOCKED`. Not an error state. |
| Pre-v13 log dropped in | Decodes fully; no keychain needed. |
| Corrupt or non-DJI file | "Not a DJI flight record"; library untouched. |
| Worker crash or decode failure | Error surfaced in the panel; library stays live and other flights still open. |
| IndexedDB unavailable (private browsing) | Skip the cache, decode on each open. Never fatal. |
| `index.json` missing or malformed | Empty library with an explanatory state; drop-in still works. |
| DJI API down during bake | Catalog still written, missing keychains reported, non-zero exit. |

Dropped flights persist as normalized `FlightPath` records in IndexedDB, not as raw log
bytes — a decoded path is a fraction of the size and re-decoding is never needed.

## 10. Testing

The weight sits in `domain/`, which is pure and needs no browser, no worker and no WASM:

- `flightPath.test.ts` — sample lookup at arbitrary `t`, interpolation at boundaries,
  derived distance-from-home, bounds computation.
- `filters.test.ts` — each filter alone, filters in combination, every sort order, the
  empty-result case.
- `format.test.ts` — formatting edge cases.

Above that:

- `parseFlight.test.ts` against a mocked worker, covering success, decode failure and the
  no-keychain path.
- UI tests with `@testing-library/react` fed a fixture `FlightPath`.
- `useFlightLayers.test.ts` following `usePlannerLayers.test.ts`.
- `telemetry.integration.test.ts` mirroring `planner.integration.test.ts`.

The committed fixture is a small hand-written `FlightPath` JSON — a few dozen samples —
**not** a 9 MB log. No test decodes a real DJI file.

`tools/bake-flights.mjs` is not unit-tested; it needs both network and a secret. Its
`--dry-run` catalog path is exercised manually.

Real-browser verification (the drop zone, the file picker, scrubber drag, playback) is
done in the browser pane, per the project's established practice for file-input paths.

## 11. Landing card

Flip `telemetry` from `planned` to `online` in `modules/landing/modules.ts`.

The current blurb — "Flight history, track replay, and fleet performance analytics" —
must change. It promises fleet analytics this module does not do, and it uses the word
*track* in the sense section 3.7 forbids. `modules.ts` already records a deliberate
decision that every card claims only what the module does today, because the landing page
is shown to government clients and partners. Replace with:

> Replay real DJI flight logs: path, altitude, battery and flight mode, frame by frame.

## 12. Implementation order

1. ~~Verify `DJI_API_KEY` against a real log.~~ **Done 2026-07-26** — see section 4.
2. `tools/bake-flights.mjs` + `.env.example`; bake the three M400 logs into
   `app/public/flights/`.
3. `domain/` types, `flightPath.ts`, `filters.ts`, `format.ts` with their tests.
4. `io/` worker, client, cache, catalog loader.
5. Route, shell, topbar, library and filters — a flight list that opens nothing yet.
6. Map layers, scrubber, frame panel.
7. Drop-in path and the degradation table.
8. Landing card to ONLINE; `npm run verify`.
