// Ported (Phase 1E / Task 4) from assets/js/ui/control.js:774-847
// (buildMissionsMenu / openMissionsMenu / closeMissionsMenu / wireMissionsMenu).
// Reuses Phase 1D's generic <TopMenu/> shell (chrome/TopMenu.tsx), which
// already owns the open/close-on-outside-click/Escape machinery legacy hand
// rolled per menu (control.js:790-847) -- see that file's header comment.
// The `.missions-menu`/`.mm-*` CSS shipped with Phase 1D (chrome/chrome.css)
// since TopMenu.tsx already applies the `missions-menu` class name to every
// menu instance it renders; no new CSS is added here.

import TopMenu from '@/modules/console/chrome/TopMenu'
import { MISSIONS_CONFIG } from '@/modules/console/domain'
import { useAppStore } from '@/shared/store'
import { presetTypes } from './presets'
import { useLaunchPreset } from './useLaunchPreset'

export default function MissionsMenu() {
  const setOpenMenu = useAppStore((s) => s.setOpenMenu)
  const { launchPreset } = useLaunchPreset()
  const types = presetTypes(MISSIONS_CONFIG)

  return (
    <TopMenu name="missions" buttonId="btn-missions" extraClass="" align="right">
      <div className="mm-head lbl">Launch predefined mission</div>
      {types.map((type) => {
        const config = MISSIONS_CONFIG[type]
        return (
          <button
            key={type}
            type="button"
            className="mm-item"
            role="menuitem"
            data-type={type}
            onClick={() => {
              setOpenMenu(null)
              launchPreset(type)
            }}
          >
            <span className="mm-label">{config ? config.label : type.toUpperCase()}</span>
            <span className="mm-pat lbl">{config ? config.pattern : ''}</span>
          </button>
        )
      })}
    </TopMenu>
  )
}
