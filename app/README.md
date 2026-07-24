# SENTINEL app (React migration)

Vite + React + TypeScript. This is the Phase 0 foundation; the vanilla sim in
the repo root (`index.html`, `console.html`, `assets/`) is still the deployed
site until the Phase 1 port reaches parity.

## Setup

```bash
cd app
npm install
git config core.hooksPath .githooks   # once per clone: enable the pre-commit hook
```

## Scripts

- `npm run dev` — dev server at http://localhost:5173/
- `npm run build` — type-check then production build to `app/dist/`
- `npm run lint` / `npm run typecheck` / `npm run test`
- `npm run verify` — lint + typecheck + test + build (what CI runs)

## Deployment

Not deployed yet. CI builds the app as a gate; GitHub Pages still publishes the
legacy static site. Phase 1 flips the Pages deploy to `app/dist`.
