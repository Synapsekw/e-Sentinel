// Ported (Phase 1D / Task 7) from assets/js/ui/panels.js:437-464
// (fpvVideoTag / fpvFrameHTML) and :469-511 (syncFpvFeed / wireFpvFeed).
//
// Legacy mounted/unmounted the <video> imperatively (insertAdjacentHTML /
// .remove()) each time the drone crossed into or out of a cruising state,
// and wired 'ended'/'error' listeners once per mount to chain a
// multi-segment mission video. The React port keeps the same shape —
// `{live ? <video/> : null}` mounts/unmounts exactly like syncFpvFeed did —
// but with one deliberate departure from a literal transcription: the
// video's `src` is set imperatively inside the effect below (via
// `sourcesRef`, a ref read fresh on every 'ended'/'error' firing) rather
// than as a JSX `src=` prop. A JSX `src` prop would be an easy way to
// re-introduce the class of bug legacy didn't have to worry about: this
// component's parent (DronePanel) re-renders on every 500ms telemetry
// tick, which recomputes a brand-new `sources` array each time (same
// content, new reference) — if that array's [0] were wired straight to
// `src=`, every tick would reset the video back to clip 1, breaking the
// clip-chaining wireFpvFeed exists to do. Reading through a ref sidesteps
// it while keeping the effect's own dependency array (just `[live]`)
// exhaustive-deps-clean.

import { useEffect, useRef, useState } from 'react'
import type { Drone } from '@/modules/console/domain'
import { nowClockStr, padHeading } from '@/modules/console/chrome/format'
import { fpvCruising } from './dronePanel'

export interface FpvFrameProps {
  drone: Drone
  sources: string[]
}

// HTMLMediaElement.play() returns a Promise in real browsers (rejected if
// autoplay is blocked) but jsdom — used by this component's tests — doesn't
// implement media playback at all and returns undefined. This guard covers
// both: a real rejection is swallowed (the standby frame already covers
// autoplay being blocked visually), and a missing return value is a no-op.
function safePlay(v: HTMLVideoElement): void {
  const result: unknown = v.play()
  if (result && typeof (result as Promise<void>).catch === 'function') {
    ;(result as Promise<void>).catch(() => {})
  }
}

export default function FpvFrame({ drone, sources }: FpvFrameProps) {
  // DELIBERATE ADDITION beyond legacy. panels.js:506-510 advanced to the next
  // clip on 'error', which silently degrades to a black frame once every clip
  // in the playlist is unreachable — and today only the `security` mission
  // type has its videos shipped (the other six still show the PENDING
  // GENERATION placeholder in the legacy debrief), so an unreachable playlist
  // is the COMMON case, not an edge case. Once every entry has failed, fall
  // back to the standby frame ("ACQUIRING DOWNLINK") instead, which is the
  // state the frame was designed to show when there is no usable feed.
  const playlistKey = sources.join(',')
  const [feedFailed, setFeedFailed] = useState(false)
  useEffect(() => {
    setFeedFailed(false)
  }, [playlistKey, drone.id])

  const live = fpvCruising(drone) && sources.length > 0 && !feedFailed
  const videoRef = useRef<HTMLVideoElement | null>(null)
  // Updated synchronously on every render (not inside an effect), so the
  // 'ended'/'error' handlers below always see the current playlist without
  // needing `sources` itself in their effect's dependency array.
  const sourcesRef = useRef<string[]>(sources)
  sourcesRef.current = sources

  // panels.js:477-483 (the video-insertion half of syncFpvFeed) + :495-511
  // (wireFpvFeed). Runs once per false->true `live` transition, i.e. once
  // per mounted <video> element.
  useEffect(() => {
    if (!live) return
    const v = videoRef.current
    if (!v) return
    let idx = 0
    const list = sourcesRef.current
    if (list.length === 0) return
    v.src = list[0]
    safePlay(v)

    const advance = () => {
      const current = sourcesRef.current
      idx = (idx + 1) % current.length
      v.src = current[idx]
      safePlay(v)
    }

    // Every distinct clip that failed to load. Once that covers the whole
    // playlist there is no usable feed left, so stop cycling and hand the
    // frame back to the standby overlay (see the feedFailed note above).
    const failed = new Set<string>()
    const onError = () => {
      failed.add(sourcesRef.current[idx])
      if (failed.size >= sourcesRef.current.length) {
        setFeedFailed(true)
        return
      }
      advance()
    }

    // 'ended' only fires for a multi-clip playlist: a single clip carries the
    // `loop` attribute (panels.js:441-442), which suppresses the event.
    if (list.length > 1) v.addEventListener('ended', advance)
    v.addEventListener('error', onError)
    return () => {
      v.removeEventListener('ended', advance)
      v.removeEventListener('error', onError)
    }
  }, [live])

  return (
    <div
      className={'fpv-frame' + (live ? ' live' : '')}
      id="fpv-frame"
      data-playlist={sources.join(',')}
    >
      {live ? (
        <video
          ref={videoRef}
          className="fpv-video"
          id="fpv-video"
          autoPlay
          muted
          playsInline
          preload="auto"
          loop={sources.length <= 1}
          data-playlist={sources.join(',')}
        />
      ) : null}
      <span className="fpv-standby" id="fpv-standby" hidden={live}>
        ACQUIRING DOWNLINK
      </span>
      <span className="fpv-rec">
        <i />
        REC
      </span>
      <span className="fpv-eo">EO 1X</span>
      <div className="fpv-reticle">
        <span className="cross h" />
        <span className="cross v" />
      </div>
      <span className="fpv-hdg" id="fpv-hdg">
        {padHeading(drone.heading)}°
      </span>
      <span className="fpv-alt" id="fpv-alt">
        {Math.round(drone.alt)}M
      </span>
      <span className="fpv-clock" id="fpv-clock">
        {nowClockStr()}
      </span>
      <span className="fpv-foot">SENTINEL EO · CH-1 · SIMULATED FEED</span>
    </div>
  )
}
