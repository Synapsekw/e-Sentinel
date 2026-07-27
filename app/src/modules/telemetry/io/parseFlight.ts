// Worker client. One long-lived worker for the whole module: spinning one up
// per decode would re-instantiate the inlined WASM every time, and the
// library legitimately allows a second flight to be opened while the first is
// still decoding, so replies are routed by request id.

import type { FlightMeta, FlightPath } from '../domain/types'
import { DECODE_ERROR_MESSAGE } from './djiLogMeta'
import type { DecodeErrorKind } from './djiLogMeta'
import DjiLogWorker from './djiLog.worker?worker'

type WorkerFactory = () => Worker

let factory: WorkerFactory = () => new DjiLogWorker()
let worker: Worker | null = null
let nextId = 1

const pending = new Map<
  number,
  { resolve: (r: DecodeResult) => void; reject: (e: Error) => void }
>()

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
  meta?: FlightMeta
  path?: FlightPath | null
  locked?: boolean
  kind?: DecodeErrorKind
  error?: string
}

// What a decode actually yields. `path` is null when the log parsed fine but
// its frames are encrypted and no keychain was supplied -- a normal resting
// state, not a failure, so it resolves rather than rejects. `meta` is read
// from the log's own unencrypted details block, so it is authoritative even
// when the frames are locked.
export interface DecodeResult {
  meta: FlightMeta
  path: FlightPath | null
  locked: boolean
}

// Carries the classified reason so callers can show a sentence rather than a
// Rust backtrace.
export class DecodeError extends Error {
  readonly kind: DecodeErrorKind
  constructor(kind: DecodeErrorKind, detail: string) {
    super(DECODE_ERROR_MESSAGE[kind])
    this.name = 'DecodeError'
    this.kind = kind
    // Kept for the console; never shown to a user.
    this.cause = detail
  }
}

function ensureWorker(): Worker {
  if (worker) return worker
  const w = factory()
  w.onmessage = (event: MessageEvent<DecodeReply>) => {
    const { id, ok, meta, path, locked, kind, error } = event.data
    const entry = pending.get(id)
    if (!entry) return
    pending.delete(id)
    if (ok && meta) entry.resolve({ meta, path: path ?? null, locked: locked === true })
    else entry.reject(new DecodeError(kind ?? 'unknown', error ?? 'decode failed'))
  }
  w.onerror = () => {
    // A worker-level error has no request id, so every in-flight decode is
    // lost. Fail them all rather than leaving promises hanging forever.
    for (const [, entry] of pending)
      entry.reject(new DecodeError('unknown', 'decode worker crashed'))
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
): Promise<DecodeResult> {
  const w = ensureWorker()
  const id = nextId++
  return new Promise<DecodeResult>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({ id, bytes, keychains, meta })
  })
}
