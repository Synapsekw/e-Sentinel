// Playback transport. A 35-minute survey flight at 1x is unwatchable in a
// meeting, so the rate control is a first-class button rather than a setting:
// 16x replays the longest of these logs in under three minutes.

import { fmtMMSS } from '@/modules/console/chrome/format'
import { pathDuration, useTelemetryStore } from '../store/telemetryStore'
import { fmtFlightClock } from '../domain/format'
import './telemetry.css'

export default function Scrubber() {
  const path = useTelemetryStore((s) => s.path)
  const cursorT = useTelemetryStore((s) => s.cursorT)
  const playing = useTelemetryStore((s) => s.playing)
  const rate = useTelemetryStore((s) => s.rate)

  const total = pathDuration(path)
  const disabled = total === 0

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
