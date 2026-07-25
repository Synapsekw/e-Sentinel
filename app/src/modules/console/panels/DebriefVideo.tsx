// Ported (Phase 1E / Task 5) from assets/js/ui/panels.js:697-718
// (debriefVideoHTML), :874-943 (stopDebriefAnim / drawDebriefFrame /
// startDebriefPlaceholder) and :945-991 (wireDebriefPanel — the
// video-element half).
//
// REUSE NOTE: this mirrors panels/FpvFrame.tsx's chain-on-'ended'/'error'
// playlist pattern (a per-clip failure Set that falls back once every
// playlist entry has failed) rather than importing a shared helper from
// it — this task's file scope is limited to the seven files listed in its
// header comment set, and FpvFrame.tsx is not one of them, so factoring a
// shared hook out of it is out of bounds here. The two differences from
// FpvFrame's live downlink, both load-bearing and both transcribed from
// panels.js:697-718/945-991: (1) legacy's debrief <video> carries no `loop`
// attribute, so a single-clip mission plays once and freezes on its last
// frame instead of looping forever; and (2) the "no usable feed" fallback
// here is the animated canvas placeholder (drawDebriefFrame), not FpvFrame's
// static "ACQUIRING DOWNLINK" standby text — a debrief always has *some*
// footage to show, even if it's simulated, because the mission already
// happened. Per this phase's reality check, only the `security` mission
// type ships real clips; every other type's manifest entries 404 on the
// first frame, so the placeholder is the common path for six of seven
// mission types, not an edge case.

import { useEffect, useRef, useState } from 'react'
import type { Mission } from '@/modules/console/domain'
import { fmtMMSS } from '@/modules/console/chrome/format'
import { debriefVideoSources } from './debriefModel'

export interface DebriefVideoProps {
  mission: Mission
}

// panels.js:938 (HTMLMediaElement.play() rejects if autoplay is blocked;
// jsdom, used by this app's component tests, returns undefined instead of
// a Promise at all). Mirrors FpvFrame.tsx's safePlay exactly.
function safePlay(v: HTMLVideoElement): void {
  const result: unknown = v.play()
  if (result && typeof (result as Promise<void>).catch === 'function') {
    ;(result as Promise<void>).catch(() => {})
  }
}

const PLACEHOLDER_CAPTION = 'AI MISSION VIDEO · PENDING GENERATION'

// panels.js:882-917 (drawDebriefFrame), verbatim canvas 2D drawing.
function drawDebriefFrame(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  ts: number,
): void {
  const w = canvas.width
  const h = canvas.height
  if (!w || !h) return
  ctx.fillStyle = '#0a0b0e'
  ctx.fillRect(0, 0, w, h)

  const drift = Math.sin(ts / 4000) * h * 0.05
  const horizonY = h * 0.52 + drift
  const grad = ctx.createLinearGradient(0, 0, 0, h)
  grad.addColorStop(0, '#12151a')
  grad.addColorStop(Math.max(0, Math.min(1, horizonY / h)), '#0e1013')
  grad.addColorStop(1, '#07080a')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)

  ctx.strokeStyle = 'rgba(255,90,90,.28)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, horizonY)
  ctx.lineTo(w, horizonY)
  ctx.stroke()

  const cx = w / 2
  const cy = h / 2
  const r = Math.min(w, h) * 0.11
  ctx.strokeStyle = 'rgba(255,90,90,.35)'
  ctx.strokeRect(cx - r, cy - r, r * 2, r * 2)
  ctx.beginPath()
  ctx.moveTo(cx - r - 13, cy)
  ctx.lineTo(cx + r + 13, cy)
  ctx.moveTo(cx, cy - r - 13)
  ctx.lineTo(cx, cy + r + 13)
  ctx.strokeStyle = 'rgba(255,90,90,.3)'
  ctx.stroke()

  ctx.font = '700 9px ui-monospace, "SF Mono", Consolas, monospace'
  ctx.fillStyle = 'rgba(255,255,255,.34)'
  ctx.textAlign = 'center'
  ctx.fillText(PLACEHOLDER_CAPTION, w / 2, h - 12)
}

// panels.js:919-943 (startDebriefPlaceholder), ~30fps rAF loop. React's
// mount/unmount lifecycle replaces legacy's `canvas.isConnected` guards
// (needed there because startDebriefPlaceholder/stopDebriefAnim managed a
// single long-lived canvas element toggled via the `hidden` attribute);
// this component instead only exists in the tree while the placeholder is
// actually the visible fallback (see DebriefVideo's render below), so a
// plain cleanup-cancels-the-rAF effect is the exact behavioral equivalent.
function DebriefCanvasPlaceholder() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = canvas.clientWidth || 300
    canvas.height = canvas.clientHeight || 169
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let last = 0
    let rafId = 0
    let cancelled = false
    const frame = (ts: number) => {
      if (cancelled) return
      if (ts - last >= 33) {
        // cap ~30fps
        last = ts
        drawDebriefFrame(ctx, canvas, ts)
      }
      rafId = requestAnimationFrame(frame)
    }
    rafId = requestAnimationFrame(frame)

    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
    }
  }, [])

  return <canvas id="debrief-canvas" ref={canvasRef} />
}

export default function DebriefVideo({ mission }: DebriefVideoProps) {
  const sources = debriefVideoSources(mission)
  const playlistKey = sources.join(',')

  // Tracks only "every clip in the playlist has failed to load" — the "no
  // clip to begin with" half of the fallback condition is folded into
  // `showVideo` below instead of into this state, so resetting it on a
  // mission change (mirroring FpvFrame.tsx's identical reset effect) never
  // needs `sources` itself in the dependency array.
  const [feedFailed, setFeedFailed] = useState(false)
  useEffect(() => {
    setFeedFailed(false)
  }, [playlistKey, mission.id])

  const showVideo = sources.length > 0 && !feedFailed
  const videoRef = useRef<HTMLVideoElement | null>(null)
  // Read fresh on every 'ended'/'error' firing without needing `sources`
  // itself in the effect's dependency array — see FpvFrame.tsx's identical
  // sourcesRef pattern and its header comment for why.
  const sourcesRef = useRef<string[]>(sources)
  sourcesRef.current = sources

  // panels.js:951-986 (wireDebriefPanel's video branch). Runs once per
  // false->true `showVideo` transition, i.e. once per mounted <video>.
  useEffect(() => {
    if (!showVideo) return
    const v = videoRef.current
    if (!v) return
    let idx = 0
    const list = sourcesRef.current
    if (list.length === 0) return
    v.src = list[0]
    safePlay(v)

    // panels.js:963-967: roll into the next segment when one ends, wrapping
    // back to the first so a multi-clip mission plays the full patrol on
    // loop. Only wired for a multi-clip playlist — legacy's single-clip
    // <video> carries no 'ended' listener (and no `loop` attribute either),
    // so it simply plays once and stops.
    const advance = () => {
      const current = sourcesRef.current
      idx = (idx + 1) % current.length
      v.src = current[idx]
      safePlay(v)
    }

    // panels.js:974-986: skip past a clip that fails to load; only fall
    // back to the placeholder once every distinct clip in the playlist has
    // failed.
    const failed = new Set<string>()
    const onError = () => {
      failed.add(sourcesRef.current[idx])
      if (failed.size >= sourcesRef.current.length) {
        setFeedFailed(true)
        return
      }
      advance()
    }

    if (list.length > 1) v.addEventListener('ended', advance)
    v.addEventListener('error', onError)
    return () => {
      v.removeEventListener('ended', advance)
      v.removeEventListener('error', onError)
    }
  }, [showVideo])

  return (
    <>
      <div className="lbl" style={{ marginTop: 16 }}>
        Mission video
      </div>
      <div className="debrief-video">
        {showVideo ? (
          <video
            ref={videoRef}
            id="debrief-video"
            controls
            autoPlay
            muted
            playsInline
            preload="auto"
            data-playlist={sources.join(',')}
          />
        ) : null}
        {!showVideo ? (
          <div className="debrief-canvas-wrap" id="debrief-canvas-wrap">
            <DebriefCanvasPlaceholder />
          </div>
        ) : null}
      </div>
      <div className="debrief-video-foot lbl">
        SENTINEL EO · MISSION RECORD · {fmtMMSS(mission.durationS)}
      </div>
    </>
  )
}
