// Playback clock. Advances the cursor from wall-clock deltas rather than a
// fixed per-frame increment, so a dropped frame does not desynchronise the
// replay from elapsed time -- and so 16x means 16x on any refresh rate.

import { useEffect, useRef } from 'react'
import { useTelemetryStore } from '../store/telemetryStore'

export function usePlayback(): void {
  const playing = useTelemetryStore((s) => s.playing)
  const rate = useTelemetryStore((s) => s.rate)
  const last = useRef<number | null>(null)

  useEffect(() => {
    if (!playing) {
      last.current = null
      return
    }

    let raf = 0
    const step = (now: number) => {
      const prev = last.current
      last.current = now
      if (prev !== null) {
        const deltaS = ((now - prev) / 1000) * rate
        const cursorT = useTelemetryStore.getState().cursorT
        useTelemetryStore.getState().setCursor(cursorT + deltaS)
      }
      // setCursor clears `playing` on reaching the end; re-reading it here
      // stops the loop on the same frame instead of one frame late.
      if (useTelemetryStore.getState().playing) raf = requestAnimationFrame(step)
    }

    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      last.current = null
    }
  }, [playing, rate])
}
