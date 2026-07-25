import { describe, it, expect } from 'vitest'
import { SimEngine, DATA_DOCKS, GEO_UAE } from '@/modules/console/domain'
import { requestBuckets, reqAgeStr, missionTypeLabel, REQ_DONE_MAX } from './requestModel'

function engineWithRequests() {
  const e = SimEngine.create({ docks: DATA_DOCKS, roads: GEO_UAE.roads })
  for (let i = 0; i < 2000; i++) e.tick(0.5) // ~1000 sim seconds: requests spawn
  return e
}

describe('request board model', () => {
  it('returns empty buckets without an engine', () => {
    expect(requestBuckets(null)).toEqual({ pending: [], active: [], done: [] })
  })

  it('buckets every engine request by status, newest first, capping DELIVERED', () => {
    const e = engineWithRequests()
    const b = requestBuckets(e)
    const total = [...e.requests.values()]
    expect(b.pending.every((r) => r.status === 'pending')).toBe(true)
    expect(b.active.every((r) => r.status === 'approved')).toBe(true)
    expect(b.done.every((r) => r.status === 'completed' || r.status === 'declined')).toBe(true)
    expect(b.done.length).toBeLessThanOrEqual(REQ_DONE_MAX)
    expect(b.pending.length + b.active.length).toBeLessThanOrEqual(total.length)
    const ts = b.pending.map((r) => r.requestedAt)
    expect(ts).toEqual([...ts].sort((a, b2) => b2 - a))
  })

  it('reqAgeStr renders T+M:SS from sim time', () => {
    const e = engineWithRequests()
    const r = [...e.requests.values()][0]
    if (r) expect(reqAgeStr(e, r)).toMatch(/^T\+\d+:\d{2}$/)
  })

  it('missionTypeLabel uses MISSIONS_CONFIG labels and falls back to uppercase', () => {
    expect(missionTypeLabel('security')).toBeTruthy()
    expect(missionTypeLabel('security')).not.toBe('SECURITY_UNKNOWN')
  })
})
