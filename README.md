# SENTINEL · Global Command & Control

Simulated national drone command & control console for the UAE, built for e& Physical Intelligence. A DJI FlightHub 2 class experience: orbital globe entry, 104 dock stations across all seven emirates, 19 live tower sites, an autonomous fleet simulation, point-and-click mission creation, manual drone control, and AI mission-video debriefs.

## Run

```bash
cd app && npm install && npm run dev
```

Then open `http://localhost:5173/` for the module landing page, or go straight to `http://localhost:5173/console`. Note the dev server serves from `/`, while the production build (and `npm run preview`, port 4173) serves under `/e-Sentinel/` to match the GitHub Pages project path.

Internet enables the map raster layers (dark, light, satellite, terrain); without it the console falls back to an embedded vector map automatically.

## Structure

The app is a React + TypeScript SPA under `app/`:

- `app/src/modules/landing/` module landing page (Simulation, Deployment Planner, Telemetry, Compliance)
- `app/src/modules/console/domain/` framework-free simulation core (router, engine, docks, sites, geo, mission types, video manifest) — pure TypeScript, unit-tested
- `app/src/modules/console/map/` MapLibre style, layers, live feature builders, basemap and offline handling
- `app/src/modules/console/globe/` orbital globe entry scene
- `app/src/modules/console/engine/` the sim tick loop and the engine-to-map render binding
- `app/src/modules/console/chrome/` topbar, dropdowns, dock list, sidebar, request board
- `app/src/modules/console/panels/` right-panel modes (ops digest, dock, site, drone telemetry, debrief, media, request review, track review)
- `app/src/modules/console/control/` manual drone control, the mission wizard, the predefined-mission menu
- `videos/` pre-generated mission videos, served at `/videos/` in dev, preview and production (see `videos/README.md`)

Tests: `cd app && npm run test` (Vitest). Also `npm run typecheck`, `npm run lint`, `npm run build`.

The original vanilla-JS implementation is still in the tree (`index.html`, `console.html`, `assets/`, `tests/`) as a reference for the port and an independent check on the simulation logic — `node --test tests/*.test.js` from the repo root still passes — but it is no longer deployed.

## CI/CD

GitHub Actions run both test suites, typecheck, lint and build on every push and PR (`.github/workflows/ci.yml`), and deploy the React app to GitHub Pages on pushes to `master` (`.github/workflows/deploy.yml`): it builds `app/` and publishes `app/dist` plus the repo-root `videos/` directory. `app/public/404.html` is a redirect shim so deep links like `/e-Sentinel/console` survive a cold load or a refresh on Pages, which has no server-side rewrite. Enable Pages with source "GitHub Actions" in the repository settings for the deployment to go live.

© 2026 e&. Simulated environment; all operational data is synthetic except live tower site locations.
