// The landing page's animated background: a fleet of drones flying a flow
// field, each trailing a finite flight track. Owns the canvas, the rAF loop
// and the DOM measurements; every number it works from lives in
// droneFieldMath.ts — named for its contents rather than `droneField.ts`,
// which on a case-insensitive filesystem collides with this file's own import.
//
// Three properties are load-bearing and should survive any future edit:
//
//  1. The canvas is CLEARED every frame. Trails come from each craft's bounded
//     Track, not from painting a translucent wash over the previous frame. The
//     wash approach hazes the whole page over time (see Track's comment).
//  2. The field yields to the copy. Every craft's alpha is scaled by
//     shelterAt(), so density is lowest behind the content block.
//  3. It stops when it cannot be seen — on tab hide, and entirely under
//     prefers-reduced-motion, which gets one settled static frame instead.

import { useEffect, useRef, type RefObject } from 'react'
import {
  Track,
  WAVE_MS,
  TRAIL,
  TRAIL_STEP_PX,
  TRAIL_TIERS,
  noise2,
  waveRadius,
  revealAt,
  shelterAt,
  steerToward,
  maxRadiusFrom,
  type ShelterBox,
} from './droneFieldMath'

export interface DroneFieldProps {
  /** The content block the field dims behind, for legibility. */
  contentRef: RefObject<HTMLElement | null>
  /** The module grid, whose centre is where the fleet ignites. */
  gridRef: RefObject<HTMLElement | null>
}

interface Craft {
  x: number
  y: number
  /** Heading in radians. */
  h: number
  life: number
  max: number
  /** Cruise speed, px/s. */
  sp: number
  /** Turn rate limit, rad/s. */
  turn: number
  heavy: boolean
  red: boolean
  lastX: number
  lastY: number
  track: Track
}

export default function DroneField({ contentRef, gridRef }: DroneFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // jsdom provides no 2D context, so this is also what keeps the landing
    // page's render tests working: no context, no animation, page unaffected.
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false

    let w = 0
    let h = 0
    let maxR = 1
    let originX = 0
    let originY = 0
    let box: ShelterBox = { cx: 0, cy: 0, hw: 0, hh: 0 }
    let fleet: Craft[] = []
    let elapsed = 0
    let last = 0
    let raf: number | null = null

    const measure = () => {
      const gridEl = gridRef.current
      const contentEl = contentRef.current
      if (gridEl) {
        const g = gridEl.getBoundingClientRect()
        originX = g.left + g.width / 2
        originY = g.top + g.height / 2
      } else {
        originX = w / 2
        originY = h / 2
      }
      if (contentEl) {
        const b = contentEl.getBoundingClientRect()
        box = {
          cx: b.left + b.width / 2,
          cy: b.top + b.height / 2,
          hw: b.width / 2,
          hh: b.height / 2,
        }
      }
      maxR = maxRadiusFrom(originX, originY, w, h)
    }

    const spawn = (c: Craft) => {
      c.x = Math.random() * w
      c.y = Math.random() * h
      c.h = Math.random() * Math.PI * 2
      c.life = 0
      c.max = 5000 + Math.random() * 5500
      c.lastX = c.x
      c.lastY = c.y
      c.track.reset()
    }

    const build = () => {
      const n = Math.min(260, Math.max(90, Math.round((w * h) / 8000)))
      fleet = []
      for (let i = 0; i < n; i++) {
        const heavy = Math.random() < 0.28
        const c: Craft = {
          x: 0,
          y: 0,
          h: 0,
          life: 0,
          max: 1,
          sp: heavy ? 40 + Math.random() * 18 : 66 + Math.random() * 32,
          turn: heavy ? 0.8 : 1.15,
          heavy,
          red: Math.random() < 0.05,
          lastX: 0,
          lastY: 0,
          track: new Track(TRAIL),
        }
        spawn(c)
        c.life = Math.random() * c.max
        fleet.push(c)
      }
    }

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = window.innerWidth
      h = window.innerHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      measure()
      build()
    }

    const step = (ts: number, dt: number) => {
      ctx.clearRect(0, 0, w, h)
      const wr = waveRadius(elapsed, maxR)
      const entering = elapsed < WAVE_MS + 400
      const tt = ts / 1000

      for (const c of fleet) {
        c.life += dt
        if (c.life > c.max || c.x < -60 || c.x > w + 60 || c.y < -60 || c.y > h + 60) {
          spawn(c)
          continue
        }

        // Steer toward the flow field, biased outward from the ignition point
        // so the fleet reads as spreading from behind the cards.
        const fa = noise2(c.x / 330, c.y / 330 + tt * 0.028) * Math.PI * 2 * 1.7
        const ox = c.x - originX
        const oy = c.y - originY
        const od = Math.hypot(ox, oy) || 1
        const target = Math.atan2(
          Math.sin(fa) * 0.86 + (oy / od) * 0.3,
          Math.cos(fa) * 0.86 + (ox / od) * 0.3,
        )
        c.h = steerToward(c.h, target, c.turn * (dt / 1000))

        const sp = c.sp * (dt / 1000)
        c.x += Math.cos(c.h) * sp
        c.y += Math.sin(c.h) * sp
        if (Math.hypot(c.x - c.lastX, c.y - c.lastY) >= TRAIL_STEP_PX) {
          c.track.push(c.x, c.y)
          c.lastX = c.x
          c.lastY = c.y
        }

        const r = Math.hypot(c.x - originX, c.y - originY)
        const reveal = revealAt(r, wr)
        if (reveal <= 0) continue
        const fade = Math.min(1, c.life / 700) * Math.min(1, (c.max - c.life) / 1200)
        let al = reveal * shelterAt(c.x, c.y, box) * fade * (c.heavy ? 0.95 : 0.7)
        if (entering) al *= 1 + 1.2 * Math.max(0, 1 - Math.abs(r - wr) / 80)
        if (al <= 0.01) continue
        const col = c.red ? '255,90,90' : '174,198,232'

        // Flight track, tail to head, brightening across TRAIL_TIERS bands.
        const n = c.track.length
        if (n > 3) {
          const per = n / TRAIL_TIERS
          for (let t = 0; t < TRAIL_TIERS; t++) {
            const from = Math.floor(t * per)
            const to = Math.min(n - 1, Math.floor((t + 1) * per))
            if (to <= from) continue
            const k = (t + 1) / TRAIL_TIERS
            ctx.lineWidth = (c.heavy ? 1.15 : 0.85) * (0.55 + 0.45 * k)
            ctx.strokeStyle = `rgba(${col},${(al * 0.1 * Math.pow(k, 2.1) * TRAIL_TIERS).toFixed(3)})`
            ctx.beginPath()
            for (let i = from; i <= to; i++) {
              if (i === from) ctx.moveTo(c.track.x(i), c.track.y(i))
              else ctx.lineTo(c.track.x(i), c.track.y(i))
            }
            if (t === TRAIL_TIERS - 1) ctx.lineTo(c.x, c.y)
            ctx.stroke()
          }
        }

        // The craft: a bright point with a short nose vector along its heading.
        const ca = Math.cos(c.h)
        const sa = Math.sin(c.h)
        const nose = c.heavy ? 3.4 : 2.4
        ctx.strokeStyle = `rgba(${col},${(al * 0.55).toFixed(3)})`
        ctx.lineWidth = c.heavy ? 1.1 : 0.8
        ctx.beginPath()
        ctx.moveTo(c.x, c.y)
        ctx.lineTo(c.x + ca * nose, c.y + sa * nose)
        ctx.stroke()
        ctx.fillStyle = `rgba(${col},${Math.min(0.98, al).toFixed(3)})`
        ctx.beginPath()
        ctx.arc(c.x, c.y, c.heavy ? 1.5 : 1.1, 0, Math.PI * 2)
        ctx.fill()
      }

      if (entering && wr < maxR + 120) {
        const cf = 1 - elapsed / (WAVE_MS + 400)
        ctx.strokeStyle = `rgba(176,196,226,${(0.1 * cf).toFixed(3)})`
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.arc(originX, originY, wr, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    const frame = (ts: number) => {
      let dt = last ? ts - last : 16.7
      last = ts
      if (dt > 50) dt = 50
      elapsed += dt
      step(ts, dt)
      raf = requestAnimationFrame(frame)
    }
    const start = () => {
      if (raf === null) {
        last = 0
        raf = requestAnimationFrame(frame)
      }
    }
    const stop = () => {
      if (raf !== null) {
        cancelAnimationFrame(raf)
        raf = null
      }
    }
    // Reduced motion: fast-forward to the settled state and paint one frame.
    // Enough steps for tracks to exist, then nothing is ever scheduled.
    const still = () => {
      elapsed = WAVE_MS + 2000
      for (let i = 0; i < 130; i++) step(i * 16.7, 16.7)
    }

    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const onResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        resize()
        if (reduced) still()
      }, 150)
    }
    const onVisibility = () => {
      if (document.hidden) stop()
      else start()
    }

    resize()
    window.addEventListener('resize', onResize)
    if (reduced) {
      still()
    } else {
      document.addEventListener('visibilitychange', onVisibility)
      start()
    }

    return () => {
      stop()
      if (resizeTimer) clearTimeout(resizeTimer)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [contentRef, gridRef])

  return <canvas ref={canvasRef} className="landing-field" aria-hidden="true" />
}
