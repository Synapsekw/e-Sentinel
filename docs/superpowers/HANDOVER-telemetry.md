# Handover — Telemetry module (module 03)

Paste the section below into a new session. Everything after the `---` is the prompt.

---

## Context

I'm continuing work on the SENTINEL drone console at `/Users/danijeljovanovic/Dev/e&_Sentinel`.
The **Telemetry module (module 03)** is built and complete. I need you to pick up from here.

**Read these two documents first — they hold all the reasoning:**

- `docs/superpowers/specs/2026-07-26-telemetry-module-design.md` — the design, including a
  "Findings that constrain the design" section (§3) recording things established by probing
  real data rather than assumed. Read §3 carefully; several are counterintuitive.
- `docs/superpowers/plans/2026-07-26-telemetry-module.md` — the 28-task implementation plan,
  all tasks checked off, with a progress log and Task 25's browser verification results.

## Current state

- **Merged to `master` on 2026-07-27** (`1500485`). The branch `feat/telemetry-module` is kept
  as the anchor for its 52 commits; master carries them plus 13 commits of planner
  plan-library work that a concurrent session landed in parallel.
- The merge had one conflict, both sides having independently added
  `docs/superpowers/plans/2026-07-27-planner-plan-library.md`. The two copies were the same
  blob; master's had two later amendments and won.
- `npm run verify` passes from `app/` on merged master: **96 test files, 780 tests**, clean
  lint and typecheck, successful build. 208 of those tests are the telemetry module across
  22 files; before the merge the branch alone was 91 files and 717 tests.
- The module is live at `/telemetry` and the landing card is ONLINE.
- Verified end to end in a real browser against the production build.

## What the module does

Decodes **real DJI TXT flight logs** and replays them: a filterable library grouped by
aircraft serial, a MapLibre map drawing the flight path, a scrubber with 1x/4x/16x playback
and keyboard control, and a right-hand panel of live telemetry readouts that follow the cursor.

Architecture, in one line: a Node tool bakes DJI keychains offline → a Web Worker decodes a log
to a compact normalized `FlightPath` → everything above that seam knows only `FlightPath` and
has never heard of DJI. Decoded paths cache in IndexedDB.

## Things that will bite you if you don't know them

1. **The repo path contains `&`.** In zsh always quote it: `cd "/Users/danijeljovanovic/Dev/e&_Sentinel"`.
   Unquoted, the shell backgrounds the command and fails confusingly.

2. **Real flight logs are gitignored and must stay that way.** This repo is **public**
   (`github.com/Synapsekw/e-Sentinel`) and `.github/workflows/deploy.yml` publishes
   `app/public/` to GitHub Pages. Committing the logs would put real survey coordinates,
   aircraft serials and AES frame-decryption keys on a public website and into permanent
   history. Only `app/public/flights/README.md` is tracked. See spec §5.2. The user chose this
   deliberately; do not "helpfully" commit the logs.

3. **The logs exist locally** in `app/public/flights/` (three real Matrice-class survey flights,
   ~19 MB, plus keychains and `index.json`). A fresh clone has none of this and loads with an
   empty library — that is a supported state, not a bug.

4. **`DJI_API_KEY` lives in the repo-root `.env`** (gitignored), read only by
   `tools/bake-flights.mjs` under Node. Never `VITE_`-prefix it — that would inline the secret
   into the client bundle. There is also a redundant `local.env` with the same key; it is
   gitignored but could be deleted.

5. **Never detach a zustand store action from the store object.** Neither
   `const f = useStore((s) => s.f)` nor `const { f } = useStore.getState()`. Both trip
   `@typescript-eslint/unbound-method`, which is an error here (`--max-warnings 0`). Call
   inline: `useStore.getState().f(...)`. Four separate agents rediscovered this.

6. **Vitest defaults to `environment: 'node'`.** Any test rendering React needs
   `// @vitest-environment jsdom` as its literal first line, and must
   `import '@testing-library/jest-dom'` itself (there is no `setupFiles`).

7. **A pre-commit hook** runs `eslint . --max-warnings 0` and `prettier --check .` from `app/`.
   Never `--no-verify`. Generated assets under `app/public/flights/` are exempted in
   `app/.prettierignore`.

8. **`tools/bake-flights.mjs --dry-run` writes nothing** and needs no key. The real run skips
   any log whose keychain is already on disk; `--force` refetches.

## Open items

**Needs a product decision (not a code question):**

- **The `ALT ASL` readout label is probably wrong.** It shows 92 m where `ALT AGL` shows 50 m,
  and reads 0 at takeoff — but the log's own `takeOffAltitude` is ~431 m. DJI documents
  `osd.altitude` as "above sea level"; the data says it is relative to takeoff. Picking the
  right label (`ALT REL`? `ALT BARO`?) is a domain call. Recorded in the plan's Task 25 section.

**Known defect, deliberately out of scope:**

- **`padHeading` in `app/src/modules/console/chrome/format.ts` can render `360°`**, which is not
  a valid compass bearing. It rounds *after* the modulo, so anything in [359.5, 360) wraps
  wrong. The telemetry module's `fmtHeading` rounds first and is correct; there is a comment in
  `telemetry/domain/format.ts` explaining why the two must not be consolidated until this is
  fixed. Fixing it touches console code and belongs in its own change.

**Repo hygiene:**

- ~~Commit `04be1c9` is a planner document another session committed onto this branch.~~
  **Resolved in the merge.** It turned out to be the same blob master already had as
  `d5de2a3`; master's amended copy won the conflict, so no history rewrite was needed.
- ~~The branch is unmerged.~~ **Merged 2026-07-27.**
- **Still unpushed.** `origin/master` is 70 commits behind local `master`. The remote is
  reachable again (`git fetch origin` succeeds), so the original blocker looks gone, but
  pushing is the user's call — this repo is public, so read constraint 2 above first.
- The redundant `local.env` is **still on disk**; deleting it was blocked by a permission
  classifier rather than declined on the merits. `tools/bake-flights.mjs` reads repo-root
  `.env` only (`tools/bake-flights.mjs:27`), and nothing reads `local.env`, so `rm local.env`
  is safe whenever someone wants it gone.

## How to run and verify

```bash
cd "/Users/danijeljovanovic/Dev/e&_Sentinel/app"
npm run dev        # http://localhost:5173/telemetry
npm run verify     # lint + typecheck + tests + build, what CI gates on
npm run preview    # production build at http://localhost:4173/e-Sentinel/telemetry
```

To rebake the flight catalog after adding a log to `app/public/flights/`:

```bash
cd "/Users/danijeljovanovic/Dev/e&_Sentinel"
node tools/bake-flights.mjs --dry-run   # no network, no key, writes nothing
node tools/bake-flights.mjs             # needs DJI_API_KEY in .env
```

**Browser verification:** the Chrome extension was not connected in the previous session, so
verification ran through Playwright installed into a scratchpad directory (not the project),
driving the cached Chromium at
`~/Library/Caches/ms-playwright/chromium-1228/…/Google Chrome for Testing`
with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`. **The SwiftShader
flags are required** — `chrome-headless-shell` has no WebGL, so MapLibre throws and the
ErrorBoundary blanks the route, which looks exactly like a catalog bug and is not one.

## What I'd want from you

Nothing is outstanding. If you are picking this up to extend it, the obvious next moves are the
two open items above, or features the spec explicitly put out of scope (§2): charts,
side-by-side flight comparison, KML/GPX export, embedded log-image extraction, cross-flight
fleet analytics, live streaming telemetry. All were considered and cut deliberately — read that
section before building any of them.

**A note on how this went.** Every genuine bug found during implementation came from contact
with real data or a real browser, never from the unit tests. Corrupt clocks in the logs (frames
stamped 2095 and 2012), a `--dry-run` that silently destroyed a good catalog, a CSS token that
did not exist, a gimbal pitch rendered as a compass bearing, a raw Rust backtrace shown to the
user. The test suite was green through all of them. If you change anything in the decode path,
run a real log through it and look at the screen.
