// PHASE 1F / Task: code-splitting fallback shown while a lazy route chunk
// (currently just `/console`) is still downloading. Deliberately quiet —
// full-viewport `--bg` plus the same `.lbl` mono micro-label treatment used
// everywhere else in the shell (ModulePlaceholder, landing footer/sub) — no
// spinner, so it reads as "the console shell itself is a beat slow" rather
// than a distinct loading UI bolted on top of the brand.
export default function RouteFallback() {
  return (
    <main
      style={{
        minHeight: '100%',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
      }}
    >
      <span className="lbl">INITIALISING CONSOLE</span>
    </main>
  )
}
