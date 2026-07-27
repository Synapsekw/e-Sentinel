// Worker client. One long-lived worker for the whole module: spinning one up
// per decode would re-instantiate the inlined WASM every time, and the
// library legitimately allows a second flight to be opened while the first is
// still decoding, so replies are routed by request id.

import type { FlightMeta, FlightPath } from '../domain/types'
import DjiLogWorker from './djiLog.worker?worker'

type WorkerFactory = () => Worker

let factory: WorkerFactory = () => new DjiLogWorker()
let worker: Worker | null = null
let nextId = 1

const pending = new Map<number, { resolve: (p: FlightPath) => void; reject: (e: Error) => void }>()

// Test seams. Vite rewrites the ?worker import at build time, so a unit test
// cannot construct the real thing; these let a fake stand in.
export function __setWorkerFactory(next: WorkerFactory): void {
  __resetWorkerFactory()
  factory = next
}

export function __resetWorkerFactory(): void {
  worker?.terminate()
  worker = null
  pending.clear()
  factory = () => new DjiLogWorker()
}

interface DecodeReply {
  id: number
  ok: boolean
  path?: FlightPath
  error?: string
}

function ensureWorker(): Worker {
  if (worker) return worker
  const w = factory()
  w.onmessage = (event: MessageEvent<DecodeReply>) => {
    const { id, ok, path, error } = event.data
    const entry = pending.get(id)
    if (!entry) return
    pending.delete(id)
    if (ok && path) entry.resolve(path)
    else entry.reject(new Error(error ?? 'decode failed'))
  }
  w.onerror = () => {
    // A worker-level error has no request id, so every in-flight decode is
    // lost. Fail them all rather than leaving promises hanging forever.
    for (const [, entry] of pending) entry.reject(new Error('decode worker crashed'))
    pending.clear()
    worker = null
  }
  worker = w
  return w
}

export function decodeFlight(
  bytes: Uint8Array,
  keychains: unknown[] | null,
  meta: FlightMeta,
): Promise<FlightPath> {
  const w = ensureWorker()
  const id = nextId++
  return new Promise<FlightPath>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({ id, bytes, keychains, meta })
  })
}
