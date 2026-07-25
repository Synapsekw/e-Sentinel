# React Foundation (Phase 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `app/` React + TypeScript (Vite) foundation — strict tooling, tests, a React landing page, and placeholder module routes — as a CI gate, without touching the live legacy site.

**Architecture:** A new Vite + React + TypeScript project lives in `app/` alongside the existing vanilla sim. Phase 0 builds only the shell: brand tokens ported into `app/src/shared/`, a React landing page mirroring the current static one, and lazy placeholder routes for the four modules. The legacy `index.html` / `console.html` stay the deployed site; the new app is exercised only by a new CI job (install → lint → typecheck → test → build). The Pages deploy workflow is left untouched so the demo never breaks. Phase 1 (a later plan) ports the sim and flips the deploy.

**Tech Stack:** Vite 6, React 18.3, TypeScript 5 (strict), React Router 6, ESLint 9 flat config + typescript-eslint 8, Prettier 3, Vitest 2, lint-staged via a tracked git hook.

## Global Constraints

- Legacy site must keep working: do **not** edit `.github/workflows/deploy.yml`, `index.html`, `console.html`, `assets/`, or `videos/` in this phase (except adding ignore rules). — from spec §2 "Static landing page is live during the transition."
- All new code lives under `app/`. — spec §3 repo layout.
- Build artifacts are **not** committed (`app/node_modules`, `app/dist`). — spec §3.
- GitHub Pages base path is `/e-Sentinel/` in production, `/` in dev. — repo is `synapsekw.github.io/e-Sentinel`.
- Brand tokens are copied verbatim from `assets/css/console.css` `:root`: `--bg:#0a0b0e`, `--panel:rgba(255,255,255,.035)`, `--panel2:rgba(255,255,255,.06)`, `--line:rgba(255,255,255,.09)`, `--txt:#c9cfda`, `--dim:#7d8697`, `--red:#ff5a5a`, `--redd:#BC0000`, `--amber:#fbbf24`, `--ok:#4ade80`, `--sans:'Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif`, `--mono:ui-monospace,'SF Mono','Cascadia Mono',Consolas,Menlo,monospace`. — spec §3 "Brand tokens live once in `app/src/shared/`."
- Console voice: mono micro-labels 9.5px / .22em / uppercase; no em dashes in UI copy. — project rule.
- TypeScript strict; ESLint type-checked rules; Prettier; pre-commit hook; single simple CI job. — spec §2 "Code quality tooling."
- Node 22 for the app CI job (Node 20 is deprecated on GitHub runners). Existing sim `test` job stays on its current Node.
- This work happens on branch `feature/react-migration` (off `main`), never directly on `main`/`master`.

---

### Task 1: Vite + React + TS scaffold under `app/`

**Files:**
- Create: `app/package.json`
- Create: `app/vite.config.ts`
- Create: `app/tsconfig.json`
- Create: `app/index.html`
- Create: `app/src/main.tsx`
- Create: `app/src/App.tsx`
- Create: `app/src/vite-env.d.ts`
- Modify: `.gitignore` (repo root)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a buildable Vite app. `App.tsx` exports `default function App(): JSX.Element`. `npm run build` in `app/` emits `app/dist/`. `npm run dev` serves at `http://localhost:5173/`.

- [ ] **Step 1: Create the migration branch**

Run:
```bash
git checkout -b feature/react-migration
```
Expected: `Switched to a new branch 'feature/react-migration'`

- [ ] **Step 2: Write `app/package.json`**

```json
{
  "name": "sentinel-app",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "verify": "npm run lint && npm run typecheck && npm run test && npm run build"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.28.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "^5.6.3",
    "vite": "^6.0.3",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 3: Write `app/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Write `app/vite.config.ts`**

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves the project under /e-Sentinel/; local dev serves at /.
// React Router reads import.meta.env.BASE_URL so its basename stays in sync.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/e-Sentinel/' : '/',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
}))
```

- [ ] **Step 5: Write `app/src/vite-env.d.ts`**

```ts
/// <reference types="vite/client" />
```

- [ ] **Step 6: Write `app/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SENTINEL · e& Physical Intelligence</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Write `app/src/App.tsx`**

```tsx
export default function App() {
  return <div>SENTINEL</div>
}
```

- [ ] **Step 8: Write `app/src/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('root element missing')
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 9: Add ignore rules for build artifacts**

Append to the repo-root `.gitignore` (after the existing `node_modules/` line):

```gitignore
# React app (Phase 0+) build + local env
app/dist/
dist/
.env
.env.local
```
(Note: `node_modules/` already present in `.gitignore` covers `app/node_modules/`.)

- [ ] **Step 10: Install and build**

Run (from repo root):
```bash
cd app && npm install && npm run build
```
Expected: `npm install` completes and writes `app/package-lock.json`; `vite build` prints `✓ built in …` and creates `app/dist/index.html`.

- [ ] **Step 11: Commit**

```bash
git add app/package.json app/package-lock.json app/vite.config.ts app/tsconfig.json app/index.html app/src/main.tsx app/src/App.tsx app/src/vite-env.d.ts .gitignore
git commit -m "chore: scaffold Vite + React + TS app under app/"
```

---

### Task 2: Lint, format, and editor config

**Files:**
- Create: `app/eslint.config.js`
- Create: `app/.prettierrc.json`
- Create: `app/.prettierignore`
- Create: `.editorconfig` (repo root)
- Modify: `app/package.json` (add ESLint/Prettier devDependencies)

**Interfaces:**
- Consumes: the `app/` scaffold from Task 1.
- Produces: `npm run lint`, `npm run format:check`, and `npm run typecheck` all pass on the scaffold.

- [ ] **Step 1: Add tooling devDependencies**

Run (from `app/`):
```bash
npm install -D eslint@^9.17.0 @eslint/js@^9.17.0 typescript-eslint@^8.18.0 eslint-plugin-react-hooks@^5.1.0 eslint-plugin-react-refresh@^0.4.16 globals@^15.13.0 prettier@^3.4.2 eslint-config-prettier@^9.1.0
```
Expected: installs succeed; `app/package.json` devDependencies updated.

- [ ] **Step 2: Write `app/eslint.config.js`**

```js
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // Config files run in Node and are not part of the app tsconfig project.
    files: ['*.{js,ts}'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
)
```

- [ ] **Step 3: Write `app/.prettierrc.json`**

```json
{
  "semi": false,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100
}
```

- [ ] **Step 4: Write `app/.prettierignore`**

```gitignore
dist
package-lock.json
```

- [ ] **Step 5: Write `.editorconfig` at repo root**

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = space
indent_size = 2
```

- [ ] **Step 6: Format, then verify lint + typecheck pass**

Run (from `app/`):
```bash
npm run format && npm run lint && npm run typecheck
```
Expected: Prettier writes files with no error; `eslint .` exits 0 with no problems; `tsc --noEmit` exits 0.

- [ ] **Step 7: Commit**

```bash
git add app/eslint.config.js app/.prettierrc.json app/.prettierignore app/package.json app/package-lock.json app/src .editorconfig
git commit -m "chore: ESLint (type-checked) + Prettier + EditorConfig"
```

---

### Task 3: Vitest wired up with a first passing test

**Files:**
- Create: `app/src/shared/env.ts`
- Create: `app/src/shared/env.test.ts`

**Interfaces:**
- Consumes: the Vitest config from Task 1 (`vite.config.ts` `test` block).
- Produces: `export function routerBasename(baseUrl: string): string` in `app/src/shared/env.ts` — strips a single trailing slash so a Vite `BASE_URL` of `/e-Sentinel/` yields router basename `/e-Sentinel`, and `/` yields `''`. Consumed by Task 4's router.

- [ ] **Step 1: Write the failing test**

`app/src/shared/env.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { routerBasename } from './env'

describe('routerBasename', () => {
  it('strips the trailing slash from a subpath base', () => {
    expect(routerBasename('/e-Sentinel/')).toBe('/e-Sentinel')
  })

  it('maps the dev root base to an empty basename', () => {
    expect(routerBasename('/')).toBe('')
  })

  it('leaves a slashless base unchanged', () => {
    expect(routerBasename('/e-Sentinel')).toBe('/e-Sentinel')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `app/`):
```bash
npm test
```
Expected: FAIL — cannot resolve `./env` (module not found).

- [ ] **Step 3: Write the minimal implementation**

`app/src/shared/env.ts`:
```ts
// Vite's import.meta.env.BASE_URL always carries a trailing slash ('/' in dev,
// '/e-Sentinel/' in a Pages build). React Router's basename wants no trailing
// slash, and '' for the root. This bridges the two.
export function routerBasename(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '')
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `app/`):
```bash
npm test
```
Expected: PASS — 3 passing tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/shared/env.ts app/src/shared/env.test.ts
git commit -m "test: wire up Vitest with routerBasename helper"
```

---

### Task 4: React landing page and placeholder module routes

**Files:**
- Create: `app/src/shared/tokens.css`
- Create: `app/src/shared/index.css`
- Create: `app/src/modules/landing/Landing.tsx`
- Create: `app/src/modules/landing/Landing.css`
- Create: `app/src/modules/landing/modules.ts`
- Create: `app/src/shared/ModulePlaceholder.tsx`
- Modify: `app/src/App.tsx`
- Modify: `app/src/main.tsx`

**Interfaces:**
- Consumes: `routerBasename` from Task 3 (`app/src/shared/env.ts`).
- Produces: a `<BrowserRouter>` app. Route `/` renders `Landing`; routes `/console`, `/planner`, `/telemetry`, `/compliance` render `ModulePlaceholder`. `MODULES` array (in `modules.ts`) is the single source of truth for the four cards.

- [ ] **Step 1: Write `app/src/shared/tokens.css` (brand tokens, verbatim from console.css)**

```css
:root {
  --bg: #0a0b0e;
  --panel: rgba(255, 255, 255, 0.035);
  --panel2: rgba(255, 255, 255, 0.06);
  --line: rgba(255, 255, 255, 0.09);
  --txt: #c9cfda;
  --dim: #7d8697;
  --red: #ff5a5a;
  --redd: #bc0000;
  --amber: #fbbf24;
  --ok: #4ade80;
  --sans: 'Segoe UI', system-ui, -apple-system, Roboto, Arial, sans-serif;
  --mono: ui-monospace, 'SF Mono', 'Cascadia Mono', Consolas, Menlo, monospace;
}
```

- [ ] **Step 2: Write `app/src/shared/index.css` (reset + base + the shared mono label)**

```css
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}
html,
body,
#root {
  height: 100%;
}
body {
  background: var(--bg);
  color: var(--txt);
  font-family: var(--sans);
}
button {
  font-family: inherit;
  cursor: pointer;
}
a {
  color: inherit;
  text-decoration: none;
}
.lbl {
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--dim);
}
```

- [ ] **Step 3: Write `app/src/modules/landing/modules.ts`**

```ts
export type ModuleStatus = 'online' | 'dev' | 'planned'

export interface ModuleCard {
  num: string
  slug: string
  title: string
  blurb: string
  status: ModuleStatus
  statusLabel: string
  enabled: boolean
}

// Single source of truth for the landing cards. Mirrors the legacy index.html
// copy exactly (no em dashes; middot separators).
export const MODULES: ModuleCard[] = [
  {
    num: '01',
    slug: 'console',
    title: 'Simulation',
    blurb: 'NATIONAL GRID C2 · 104 DOCKS · LIVE FLEET · MISSION VIDEO DEBRIEFS',
    status: 'online',
    statusLabel: 'ONLINE',
    enabled: true,
  },
  {
    num: '02',
    slug: 'planner',
    title: 'Deployment Planner',
    blurb: 'CUSTOMER AOI · DOCK PLACEMENT · COVERAGE & OVERLAP · AI CO-PLANNER',
    status: 'dev',
    statusLabel: 'IN DEVELOPMENT',
    enabled: true,
  },
  {
    num: '03',
    slug: 'telemetry',
    title: 'Telemetry',
    blurb: 'FLIGHT HISTORY · TRACK REPLAY · PERFORMANCE ANALYTICS',
    status: 'planned',
    statusLabel: 'PLANNED',
    enabled: false,
  },
  {
    num: '04',
    slug: 'compliance',
    title: 'Compliance',
    blurb: 'DRONE LOGBOOK · APPROVALS · REGULATORY AUDIT TRAIL',
    status: 'planned',
    statusLabel: 'PLANNED',
    enabled: false,
  },
]
```

- [ ] **Step 4: Write `app/src/modules/landing/Landing.css`**

```css
.landing {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 40px;
  padding: 48px 24px;
}
.landing-brand {
  text-align: center;
}
.landing-brand h1 {
  font-size: 34px;
  letter-spacing: 0.32em;
  font-weight: 700;
  color: #fff;
  margin: 16px 0 10px;
}
.landing-sub {
  margin-top: 4px;
}
.modules {
  display: grid;
  grid-template-columns: repeat(2, minmax(220px, 260px));
  gap: 16px;
}
.mcard {
  display: block;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 18px 20px;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}
.mcard[data-enabled='true']:hover {
  border-color: rgba(255, 255, 255, 0.22);
  background: var(--panel2);
}
.mcard[data-enabled='false'] {
  opacity: 0.55;
  cursor: default;
}
.m-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.mcard h2 {
  font-size: 18px;
  font-weight: 600;
  color: #fff;
  margin-bottom: 8px;
}
.m-status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  border: 1px solid var(--line);
  border-radius: 99px;
  padding: 4px 10px;
}
.m-status .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.m-status.online {
  color: var(--ok);
}
.m-status.online .dot {
  background: var(--ok);
}
.m-status.dev {
  color: var(--amber);
}
.m-status.dev .dot {
  background: var(--amber);
}
.m-status.planned {
  color: var(--dim);
}
.m-status.planned .dot {
  background: var(--dim);
}
.landing-foot {
  margin-top: 8px;
}
```

- [ ] **Step 5: Write `app/src/modules/landing/Landing.tsx`**

```tsx
import { Link } from 'react-router-dom'
import { MODULES, type ModuleCard } from './modules'
import './Landing.css'

function Card({ mod }: { mod: ModuleCard }) {
  const inner = (
    <>
      <div className="m-head">
        <span className="m-num lbl">{mod.num}</span>
        <span className={`m-status ${mod.status}`}>
          <span className="dot" />
          {mod.statusLabel}
        </span>
      </div>
      <h2>{mod.title}</h2>
      <p className="lbl">{mod.blurb}</p>
    </>
  )
  if (!mod.enabled) {
    return (
      <div className="mcard" data-enabled="false" aria-disabled="true">
        {inner}
      </div>
    )
  }
  return (
    <Link className="mcard" data-enabled="true" to={`/${mod.slug}`}>
      {inner}
    </Link>
  )
}

export default function Landing() {
  return (
    <main className="landing">
      <div className="landing-brand">
        <h1>SENTINEL</h1>
        <div className="lbl landing-sub">PHYSICAL INTELLIGENCE · UNIFIED DRONE OPERATIONS</div>
      </div>
      <nav className="modules" aria-label="Modules">
        {MODULES.map((mod) => (
          <Card key={mod.slug} mod={mod} />
        ))}
      </nav>
      <footer className="lbl landing-foot">
        © 2026 e& · SIMULATED ENVIRONMENT · ALL OPERATIONAL DATA SYNTHETIC
      </footer>
    </main>
  )
}
```

- [ ] **Step 6: Write `app/src/shared/ModulePlaceholder.tsx`**

```tsx
import { Link, useLocation } from 'react-router-dom'

export default function ModulePlaceholder() {
  const { pathname } = useLocation()
  const name = pathname.replace('/', '').toUpperCase() || 'MODULE'
  return (
    <main
      style={{
        minHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: 24,
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: 24, letterSpacing: '0.2em', color: '#fff' }}>{name}</h1>
      <div className="lbl">MODULE PORT IN PROGRESS</div>
      <Link className="lbl" to="/" style={{ color: 'var(--txt)' }}>
        ← BACK TO MODULES
      </Link>
    </main>
  )
}
```

- [ ] **Step 7: Rewrite `app/src/App.tsx` with routing**

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { routerBasename } from './shared/env'
import Landing from './modules/landing/Landing'
import ModulePlaceholder from './shared/ModulePlaceholder'

export default function App() {
  return (
    <BrowserRouter basename={routerBasename(import.meta.env.BASE_URL)}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/console" element={<ModulePlaceholder />} />
        <Route path="/planner" element={<ModulePlaceholder />} />
        <Route path="/telemetry" element={<ModulePlaceholder />} />
        <Route path="/compliance" element={<ModulePlaceholder />} />
      </Routes>
    </BrowserRouter>
  )
}
```

- [ ] **Step 8: Import the shared styles in `app/src/main.tsx`**

Add these two imports below the existing `import App from './App'` line:
```tsx
import './shared/tokens.css'
import './shared/index.css'
```

- [ ] **Step 9: Verify build, lint, typecheck, and tests all pass**

Run (from `app/`):
```bash
npm run verify
```
Expected: lint 0 problems, typecheck clean, 3 tests pass, `vite build` succeeds.

- [ ] **Step 10: Visually confirm in the dev server**

Run (from `app/`):
```bash
npm run dev
```
Then open `http://localhost:5173/`. Expected: the SENTINEL landing with four module cards (Simulation ONLINE, Deployment Planner IN DEVELOPMENT, Telemetry/Compliance PLANNED). Clicking Simulation or Deployment Planner navigates to a "MODULE PORT IN PROGRESS" placeholder with a working back link. Stop the server with Ctrl+C when done.

- [ ] **Step 11: Commit**

```bash
git add app/src
git commit -m "feat: React landing page and placeholder module routes"
```

---

### Task 5: Pre-commit hook and app CI job

**Files:**
- Create: `.githooks/pre-commit` (repo root, tracked)
- Modify: `app/package.json` (add `lint-staged` devDependency + config)
- Modify: `.github/workflows/ci.yml` (add an `app` job)
- Create: `app/README.md`

**Interfaces:**
- Consumes: the `app/` scripts from Tasks 1-2 (`lint`, `typecheck`, `test`, `build`).
- Produces: a committed git hook that runs `lint-staged` over staged `app/` files; a CI `app` job gating install/lint/typecheck/test/build; contributor setup docs.

- [ ] **Step 1: Add lint-staged**

Run (from `app/`):
```bash
npm install -D lint-staged@^15.2.11
```

- [ ] **Step 2: Add the `lint-staged` config to `app/package.json`**

Add this top-level key (sibling of `"scripts"`):
```json
"lint-staged": {
  "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
  "*.{json,css,md}": ["prettier --write"]
}
```

- [ ] **Step 3: Write `.githooks/pre-commit`**

```sh
#!/bin/sh
# Lints/format-fixes only staged files under app/. The legacy vanilla sim is
# not covered here. Enable once per clone: git config core.hooksPath .githooks
cd app || exit 0
npx --no-install lint-staged
```

- [ ] **Step 4: Make the hook executable and enable it**

Run (from repo root):
```bash
chmod +x .githooks/pre-commit
git config core.hooksPath .githooks
```
Expected: no output; `git config --get core.hooksPath` prints `.githooks`.

- [ ] **Step 5: Verify the hook fires**

Use a Markdown probe so only Prettier runs (avoids ESLint's no-unused-vars
rejecting a throwaway `.ts`, which would abort the commit).

Run (from repo root):
```bash
printf '# probe\n\n\ntext\n' > app/HOOKPROBE.md && git add app/HOOKPROBE.md && git commit -m "test: hook probe"
```
Expected: lint-staged runs (Prettier collapses the blank lines in `HOOKPROBE.md`) and the commit succeeds. Then undo the probe:
```bash
git rm -f app/HOOKPROBE.md && git commit -m "chore: remove hook probe"
```

- [ ] **Step 6: Add the `app` job to `.github/workflows/ci.yml`**

Append this job under the existing `jobs:` map (as a sibling of `test:`, same indentation):
```yaml
  app:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: app
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: app/package-lock.json
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test
      - run: npm run build
```

- [ ] **Step 7: Write `app/README.md`**

```markdown
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
```

- [ ] **Step 8: Commit**

```bash
git add .githooks/pre-commit app/package.json app/package-lock.json .github/workflows/ci.yml app/README.md
git commit -m "ci: app build/lint/test job and pre-commit hook"
```

- [ ] **Step 9: Push the branch and confirm CI is green**

```bash
git push -u origin feature/react-migration
```
Then check the run:
```bash
gh run list --branch feature/react-migration --limit 2
```
Expected: the CI workflow's `test` and `app` jobs both conclude `success`. The deploy workflow does not run (it triggers only on `master`), so the live site is untouched.

---

## Self-Review

**Spec coverage (Phase 0 bullet, spec §8.0):**
- `app/` scaffold Vite + React + TS (strict) → Task 1 (tsconfig `strict:true` + strict flags).
- ESLint type-checked flat config → Task 2 (`recommendedTypeChecked`, `projectService`).
- Prettier → Task 2. EditorConfig → Task 2.
- Vitest → Tasks 1 (config) + 3 (first test).
- Pre-commit hook → Task 5.
- CI job → Task 5.
- React landing page + placeholder module routes → Task 4.
- Repo layout `app/src/shared` for brand tokens → Task 4 (`shared/tokens.css`), spec §3 satisfied.
- Legacy site stays live (spec §2, §7 "now") → Global Constraints + deploy workflow untouched (Task 5 adds a job, does not edit deploy.yml).
- Base path `/e-Sentinel/` (spec §7) → Task 1 vite `base`, Task 3/4 router basename.

**Deferred to later phases (correctly out of Phase 0 scope):** the sim port (Phase 1), Zustand/state (not needed for a static landing), MapLibre/terra-draw/turf deps (Phases 2-3), Anthropic AI client (Phase 5), flipping the Pages deploy to `app/dist` (Phase 1). No Phase 0 requirement is unaddressed.

**Placeholder scan:** No TBD/TODO/"add error handling"/"similar to Task N" left; every code and config step shows full content.

**Type consistency:** `routerBasename(baseUrl: string): string` defined in Task 3, consumed in Task 4 Step 7 with the same name and signature. `ModuleCard` interface defined and exported in Task 4 Step 3, imported in Step 5. `MODULES` name consistent across Steps 3 and 5. `App` default export consistent across Tasks 1 and 4.
