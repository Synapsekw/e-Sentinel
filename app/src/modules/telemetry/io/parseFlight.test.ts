import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { decodeFlight, __setWorkerFactory, __resetWorkerFactory } from './parseFlight'
import type { FlightMeta } from '../domain/types'

const meta: FlightMeta = {
  id: 'a',
  file: 'a.txt',
  version: 14,
  encrypted: true,
  hasKeychain: true,
  aircraftName: 'Matrice 400',
  aircraftSn: 'SN1',
  startTime: '2026-02-17T06:27:04.690Z',
  durationS: 30,
  distanceKm: 1,
  maxHeightM: 100,
  maxSpeedMs: 10,
  recordCount: 1,
  home: { lon: 48, lat: 28.78 },
}

// Stands in for the Vite-built worker. Records what it was posted and replies
// on the next microtask, mirroring a real worker's async message delivery.
class FakeWorker {
  posted: unknown[] = []
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  terminated = false
  reply: (msg: Record<string, unknown>) => Record<string, unknown> = (m) => ({
    id: m.id,
    ok: true,
    path: { meta, samples: [] },
  })
  postMessage(msg: Record<string, unknown>) {
    this.posted.push(msg)
    queueMicrotask(() => this.onmessage?.({ data: this.reply(msg) }))
  }
  terminate() {
    this.terminated = true
  }
}

let fake: FakeWorker

beforeEach(() => {
  fake = new FakeWorker()
  __setWorkerFactory(() => fake as unknown as Worker)
})
afterEach(() => __resetWorkerFactory())

describe('decodeFlight', () => {
  it('resolves with the decoded path', async () => {
    const path = await decodeFlight(new Uint8Array([1, 2]), null, meta)
    expect(path.meta.id).toBe('a')
  })

  it('posts the bytes, keychains and meta to the worker', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    await decodeFlight(bytes, [{ k: 1 }], meta)
    const sent = fake.posted[0] as Record<string, unknown>
    expect(sent.bytes).toBe(bytes)
    expect(sent.keychains).toEqual([{ k: 1 }])
    expect((sent.meta as FlightMeta).id).toBe('a')
  })

  it('rejects when the worker reports a decode failure', async () => {
    fake.reply = (m) => ({ id: m.id, ok: false, error: 'bad keychain' })
    await expect(decodeFlight(new Uint8Array([1]), null, meta)).rejects.toThrow('bad keychain')
  })

  it('ignores a reply whose id does not match the pending request', async () => {
    fake.reply = (m) => ({ id: (m.id as number) + 999, ok: true, path: { meta, samples: [] } })
    let settled = false
    void decodeFlight(new Uint8Array([1]), null, meta).then(() => (settled = true))
    await new Promise((r) => setTimeout(r, 10))
    expect(settled).toBe(false)
  })

  // Concurrency matters: the library lets a user click a second flight while
  // the first is still decoding, and both replies arrive on one worker.
  it('routes concurrent decodes to the right callers', async () => {
    fake.reply = (m) => ({
      id: m.id,
      ok: true,
      path: { meta: { ...meta, id: `flight-${String(m.id)}` }, samples: [] },
    })
    const [first, second] = await Promise.all([
      decodeFlight(new Uint8Array([1]), null, meta),
      decodeFlight(new Uint8Array([2]), null, meta),
    ])
    expect(first.meta.id).not.toBe(second.meta.id)
  })
})
