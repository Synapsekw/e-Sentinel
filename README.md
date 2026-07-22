# SENTINEL · Global Command & Control

Simulated national drone command & control console for the UAE, built for e& Physical Intelligence. A DJI FlightHub 2 class experience: orbital globe entry, 104 dock stations across all seven emirates, 19 live tower sites, an autonomous fleet simulation, point-and-click mission creation, manual drone control, and AI mission-video debriefs.

## Run

No build, no server. Double-click `index.html` (or serve statically). Internet enables the map raster layers (dark, light, satellite, terrain); without it the console falls back to an embedded vector map automatically.

## Structure

- `index.html` single page, classic scripts, `file://` safe
- `assets/js/sim/` pure simulation logic (router, engine), Node-testable
- `assets/js/ui/` map, globe entry, panels, interaction modes
- `assets/js/data/` docks, live sites, geo data, mission types, video manifest
- `videos/` drop pre-generated mission videos here (see `videos/README.md`)
- `tests/` run with `node --test tests/*.test.js`

## CI/CD

GitHub Actions run the test suite and syntax checks on every push and PR (`.github/workflows/ci.yml`), and deploy the console to GitHub Pages on pushes to `master` (`.github/workflows/deploy.yml`). Enable Pages with source "GitHub Actions" in the repository settings for the deployment to go live.

© 2026 e&. Simulated environment; all operational data is synthetic except live tower site locations.
