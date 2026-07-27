// Playback transport. A 35-minute survey flight at 1x is unwatchable in a
// meeting, so the rate control is a first-class button rather than a setting:
// 16x replays the longest of these logs in under three minutes.

import { useEffect } from 'react'
import { fmtMMSS } from '@/modules/console/chrome/format'
import { pathDuration, useTelemetryStore } from '../store/telemetryStore'
import { fmtFlightClock } from '../domain/format'
import './telemetry.css'

const STEP_S = 1
const BIG_STEP_S = 10

export default function Scrubber() {
  const path = useTelemetryStore((s) => s.path)
  const cursorT = useTelemetryStore((s) => s.cursorT)
  const playing = useTelemetryStore((s) => s.playing)
  const rate = useTelemetryStore((s) => s.rate)

  const total = pathDuration(path)
  const disabled = total === 0

  // Window-level rather than on the slider: the operator's hands are on the
  // map, not the transport, and requiring focus on a range input before
  // space works would make the shortcut useless in practice. The handler
  // reads everything fresh from getState() on each keypress, so it has no
  // reactive dependencies and is safe to mount once.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Space activates a focused button and types into a search box.
      // Standing down for form controls keeps both working.
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return
      }

      const state = useTelemetryStore.getState()
      if (!state.path || state.path.samples.length === 0) return

      const step = e.shiftKey ? BIG_STEP_S : STEP_S
      if (e.key === ' ') {
        e.preventDefault()
        useTelemetryStore.getState().togglePlay()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        useTelemetryStore.getState().setCursor(state.cursorT + step)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        useTelemetryStore.getState().setCursor(state.cursorT - step)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // Empty deps: onKey closes over no reactive values, reading state fresh
    // via getState() on every keypress instead, so exhaustive-deps has
    // nothing to flag and the listener mounts exactly once.
  }, [])

  return (
    <div className="tm-scrubber">
      <button
        className="tm-btn"
        onClick={() => useTelemetryStore.getState().togglePlay()}
        disabled={disabled}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <button
        className="tm-btn"
        onClick={() => useTelemetryStore.getState().cycleRate()}
        disabled={disabled}
      >
        {rate}×
      </button>
      <input
        className="tm-scrub-track"
        type="range"
        min={0}
        max={total || 1}
        step={0.1}
        value={cursorT}
        disabled={disabled}
        aria-label="Flight position"
        onChange={(e) => useTelemetryStore.getState().setCursor(Number(e.target.value))}
      />
      <div className="tm-clock lbl">
        {fmtFlightClock(cursorT)} / {fmtMMSS(total)}
      </div>
    </div>
  )
}
