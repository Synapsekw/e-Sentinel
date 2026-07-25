// Ported (Phase 1E / Task 2) from assets/js/ui/control.js:26-46
// (ensureBanner / showBanner / hideBanner). Legacy lazily created and
// imperatively toggled a single `<div id="manual-banner">` appended to
// `document.body`; here it is a normal component reading the same
// `controlMode`/`controlActiveId` store fields (Phase 1E / Task 1) that
// useManualControl.ts's enterManual/exitManual set, so no imperative
// show/hide call is needed — mounting it once (Console.tsx, Task 8) is
// equivalent to legacy's ensureBanner() running once at first use.

import { useAppStore } from '@/shared/store'
import { manualBannerText } from './manualModel'
import './control.css'

export default function ManualBanner() {
  const controlMode = useAppStore((s) => s.controlMode)
  const controlActiveId = useAppStore((s) => s.controlActiveId)
  const droneId = controlMode === 'manual' ? controlActiveId : null

  return (
    <div id="manual-banner" className="manual-banner" hidden={!droneId}>
      {droneId ? manualBannerText(droneId) : null}
    </div>
  )
}
