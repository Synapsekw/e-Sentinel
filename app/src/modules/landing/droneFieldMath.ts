// Pure simulation math for the landing page's drone field (DroneField.tsx),
// kept framework-free and side-effect-free here so it can be unit-tested the
// way globe/globeMath.ts is: the component owns the canvas, the rAF loop and
// the DOM measurements, this file owns every number those need.
//
// The visual brief the numbers encode: on load the fleet ignites behind the
// module grid and propagates outward until it reaches the page edges, then
// settles into a slow ambient drift. The field must stay dimmest directly
// behind the cards so it never competes with the copy, and it must never
// accumulate — see Track below.

/** Rectangle the field yields to for legibility: the landing content block. */
export interface ShelterBox {
  cx: number
  cy: number
  hw: number
  hh: number
}

/** Duration of the outward ignition sweep before the field settles. */
export const WAVE_MS = 2600
/** Samples retained per flight track. */
export const TRAIL = 26
/** Distance flown between track samples, so track length is resolution- and framerate-independent. */
export const TRAIL_STEP_PX = 4
/** Number of alpha tiers the track is drawn in, tail to head. */
export const TRAIL_TIERS = 4

/**
 * A craft's recent positions, as a fixed-capacity ring buffer.
 *
 * This is the whole reason the background cannot saturate. The obvious way to
 * draw motion trails on a canvas is to skip the clear and paint a translucent
 * background over the previous frame, but that decay is exponential and never
 * actually reaches zero, so residue accumulates until the page is a solid
 * haze. Holding a bounded history per craft instead means the canvas is
 * cleared outright every frame and a track is exactly TRAIL * TRAIL_STEP_PX
 * pixels long, however long the page has been open.
 */
export class Track {
  private readonly xs: Float32Array
  private readonly ys: Float32Array
  private head = 0
  private count = 0

  constructor(readonly capacity: number = TRAIL) {
    this.xs = new Float32Array(capacity)
    this.ys = new Float32Array(capacity)
  }

  /** Number of samples currently held (never exceeds capacity). */
  get length(): number {
    return this.count
  }

  /**
   * Drop the history. Called whenever a craft respawns elsewhere on the page:
   * without it the next frame draws one straight line from the old position to
   * the new one, right across the viewport.
   */
  reset(): void {
    this.head = 0
    this.count = 0
  }

  push(x: number, y: number): void {
    this.xs[this.head] = x
    this.ys[this.head] = y
    this.head = (this.head + 1) % this.capacity
    if (this.count < this.capacity) this.count++
  }

  /** Index 0 is the oldest retained sample, `length - 1` the newest. */
  x(i: number): number {
    return this.xs[this.slot(i)]
  }

  y(i: number): number {
    return this.ys[this.slot(i)]
  }

  private slot(i: number): number {
    return (this.head - this.count + i + this.capacity * 2) % this.capacity
  }
}

/** Integer hash in [0,1). */
export function hash2(x: number, y: number): number {
  let n = (x * 374761393 + y * 668265263) | 0
  n = (n ^ (n >> 13)) | 0
  n = Math.imul(n, 1274126177)
  return ((n ^ (n >> 16)) >>> 0) / 4294967295
}

/** Value noise in [0,1], smoothstep-interpolated. The flow field's only input. */
export function noise2(x: number, y: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a = hash2(xi, yi)
  const b = hash2(xi + 1, yi)
  const c = hash2(xi, yi + 1)
  const d = hash2(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

/** Farthest corner distance from the propagation origin: how far the sweep must travel. */
export function maxRadiusFrom(ox: number, oy: number, w: number, h: number): number {
  return Math.max(
    Math.hypot(ox, oy),
    Math.hypot(w - ox, oy),
    Math.hypot(ox, h - oy),
    Math.hypot(w - ox, h - oy),
  )
}

/**
 * Radius of the ignition wavefront. Eases out over WAVE_MS, then returns a
 * radius comfortably past every corner so the settled field covers the page.
 */
export function waveRadius(elapsedMs: number, maxRadius: number): number {
  if (elapsedMs >= WAVE_MS) return maxRadius + 600
  const p = elapsedMs / WAVE_MS
  const eased = 1 - Math.pow(1 - p, 3)
  return eased * (maxRadius + 120)
}

/** How much of a craft is revealed at `distance` from the origin: 0 ahead of the front, 1 behind it. */
export function revealAt(distance: number, waveR: number): number {
  const f = (waveR - distance) / 110
  if (f <= 0) return 0
  if (f >= 1) return 1
  return f
}

/**
 * Legibility multiplier. Bottoms out at 0.12 inside the content block and
 * ramps to full strength 240px outside it, which is what makes the field read
 * as coming from behind the cards rather than across them.
 */
export function shelterAt(x: number, y: number, box: ShelterBox): number {
  const dx = Math.max(0, Math.abs(x - box.cx) - box.hw - 16)
  const dy = Math.max(0, Math.abs(y - box.cy) - box.hh - 16)
  const d = Math.hypot(dx, dy) / 240
  return 0.12 + 0.88 * (d > 1 ? 1 : d)
}

/**
 * Turn `heading` toward `target` by at most `maxTurn` radians, taking the
 * shorter way around. The rate limit is what separates a craft holding a
 * heading from a particle jittering along a noise gradient.
 */
export function steerToward(heading: number, target: number, maxTurn: number): number {
  let d = target - heading
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  if (d > maxTurn) d = maxTurn
  else if (d < -maxTurn) d = -maxTurn
  return heading + d
}
