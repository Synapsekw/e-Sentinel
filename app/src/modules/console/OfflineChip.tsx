// Ported (Phase 1B / Task 5) from the legacy `#offline-chip` usage
// (console.html:33, `.chip.warn` in assets/css/console.css:50-62, toggled
// by EC2.setOffline at assets/js/ui/map.js:923). Only the module wiring
// changed: legacy created one `.chip.warn` div in the real topbar and
// toggled its `hidden` attribute from EC2.setOffline; here the chip reads
// the store's `offline` field directly (useOffline.ts is the single place
// that now calls setOffline) and hides itself declaratively. Task 5's
// console chrome has no real topbar yet (Phase 1D owns that), so this
// renders as a small fixed pill rather than sitting inline among topbar
// chips — the copy and warn styling are transcribed, the layout is new.

import { useAppStore } from '@/shared/store'

export default function OfflineChip() {
  const offline = useAppStore((s) => s.offline)

  if (!offline) return null

  return (
    <div
      id="offline-chip"
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 900,
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        fontFamily: 'var(--mono)',
        fontSize: 10,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'var(--amber)',
        background: 'rgba(251, 191, 36, 0.08)',
        border: '1px solid rgba(251, 191, 36, 0.4)',
        borderRadius: 99,
        padding: '6px 12px',
        whiteSpace: 'nowrap',
      }}
    >
      OFFLINE &middot; CACHED VIEW
    </div>
  )
}
