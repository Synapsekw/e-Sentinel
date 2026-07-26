// Ported from the legacy `#offline-chip` usage (console.html:33, `.chip.warn`
// in assets/css/console.css:50-62, toggled by EC2.setOffline at
// assets/js/ui/map.js:923).
//
// Phase 1D / Task 4 rewrite: this now renders inline as one of the real
// topbar chips (Topbar.tsx places it between #c-alerts and the `.sp`
// spacer, exactly where console.html:33 puts it), instead of the fixed-pill
// standalone placeholder Phase 1B shipped before the real topbar existed.
// The `.chip`/`.chip.warn` look now comes entirely from chrome/chrome.css
// (Task 2); no inline `style` object is needed here anymore. The chip stays
// mounted (matching legacy's real DOM node) and toggles the `hidden`
// attribute rather than unmounting, so chrome.css's `.chip[hidden]` selector
// does the hiding exactly as legacy's `chip.hidden = ...` did.

import { useAppStore } from '@/shared/store'

export interface OfflineChipProps {
  // The planner does not import chrome.css (see planner.css's header), so it
  // supplies its own pl-* classes. Default reproduces the console's markup
  // exactly, so every existing call site is unaffected.
  className?: string
}

export default function OfflineChip({ className = 'chip warn' }: OfflineChipProps) {
  const offline = useAppStore((s) => s.offline)

  return (
    <div className={className} id="offline-chip" hidden={!offline}>
      OFFLINE MODE · VECTOR MAP
    </div>
  )
}
