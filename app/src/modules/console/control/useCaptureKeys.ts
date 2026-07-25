// Ported (Phase 1E / Task 1) from assets/js/ui/control.js:703-709
// (wireKeys): a single document-level Escape handler that exits whichever
// capture mode is currently active, checking `control.mode` at the moment
// the key fires (not a value captured at wire-up time).
//
// Takes the two exit callbacks as arguments rather than importing
// useManualControl/useWizard directly, so this hook (called once from
// Console.tsx in Task 8) has no import cycle with Task 2's control/
// useManualControl.ts or Task 3's control/useWizard.ts.

import { useEffect } from 'react'
import { useAppStore } from '@/shared/store'

export function useCaptureKeys(exitManual: () => void, exitWizard: () => void): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return
      const mode = useAppStore.getState().controlMode
      if (mode === 'manual') exitManual()
      else if (mode === 'wizard') exitWizard()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [exitManual, exitWizard])
}
