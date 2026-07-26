# SENTINEL app (React migration)

Vite + React + TypeScript. This is the deployed product. The original vanilla
sim that once lived at the repo root has been removed; it survives only in git
history, which the port's provenance comments still cite by path and line.

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

GitHub Pages publishes `app/dist` on every push to `master`
(`.github/workflows/deploy.yml`), staged alongside the repo-root `videos/`
directory. The production build serves under `/e-Sentinel/`.
