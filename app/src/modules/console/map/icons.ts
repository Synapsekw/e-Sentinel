// Ported (Phase 1B / Task 2) verbatim from assets/js/ui/map.js:135-187
// (droneIconImage / trackIconImage). Only the module wiring and typing
// changed (the `ctx` null-check is new — legacy JS had no strict-null
// checking — everything else, including the exact canvas drawing calls and
// magic numbers, is transcribed byte-for-byte). These run in the browser at
// map-load; jsdom cannot exercise canvas 2d fully, so they are exercised
// via browser verification in Task 3, not unit-tested here.

// Air-track chevron (NATO-ish friendly-air read, not a gamer triangle):
// narrow arrowhead with a notched tail so the heading is unambiguous at a
// glance. Neutral white — drones are own assets, never alert-red.
export function droneIconImage(): ImageData {
  const size = 24
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  ctx.clearRect(0, 0, size, size)
  ctx.beginPath()
  ctx.moveTo(size / 2, 2) // nose
  ctx.lineTo(size / 2 + 6, size - 4) // right wingtip
  ctx.lineTo(size / 2, size - 9) // tail notch
  ctx.lineTo(size / 2 - 6, size - 4) // left wingtip
  ctx.closePath()
  ctx.fillStyle = '#e8ecf4'
  ctx.fill()
  ctx.strokeStyle = '#0a0b0e'
  ctx.lineWidth = 1.5
  ctx.lineJoin = 'round'
  ctx.stroke()
  return ctx.getImageData(0, 0, size, size)
}

// Detection-track symbol: hollow rotated-square diamond (unknown/attention
// object read) with a subtle center dot. Two variants, selected data-driven
// by track status: amber for active detections (attention family — red
// stays reserved for faults/alerts/brand), steel for tasked ones already
// being handled. A dark under-stroke keeps the hollow outline legible over
// the satellite basemap, same trick as the chevron's dark edge.
export function trackIconImage(color: string): ImageData {
  const size = 26
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  const c = size / 2,
    r = c - 3
  ctx.clearRect(0, 0, size, size)
  ctx.beginPath()
  ctx.moveTo(c, c - r) // top
  ctx.lineTo(c + r, c) // right
  ctx.lineTo(c, c + r) // bottom
  ctx.lineTo(c - r, c) // left
  ctx.closePath()
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#0a0b0e'
  ctx.lineWidth = 4
  ctx.stroke()
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(c, c, 1.6, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  return ctx.getImageData(0, 0, size, size)
}
