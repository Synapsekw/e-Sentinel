// The ONLY module that imports dji-log-parser-js. Runs off the main thread
// because the parser instantiates its inlined WASM synchronously, which
// Chrome refuses above 4KB on the main thread (spec section 3.4). Decode
// itself is cheap -- 414ms for 27k frames -- so this is about legality, not
// speed.
//
// Nothing here is unit-tested: it is a message shim over normalizeFrames.ts
// (which is fully tested) and the parser (which is third-party). Its real
// verification is Task 20's browser run.

import { DJILog } from 'dji-log-parser-js'
import { normalizeFrames } from './normalizeFrames'
import type { RawFrame } from './normalizeFrames'
import type { FlightMeta } from '../domain/types'

export interface DecodeRequest {
  id: number
  bytes: Uint8Array
  keychains: unknown[] | null
  meta: FlightMeta
}

self.onmessage = (event: MessageEvent<DecodeRequest>) => {
  const { id, bytes, keychains, meta } = event.data
  try {
    const parser = new DJILog(bytes)
    // frames() takes no argument for pre-v13 logs, which need no keychain.
    const frames = (keychains
      ? parser.frames(keychains as never)
      : parser.frames()) as unknown as RawFrame[]
    const path = normalizeFrames(frames, meta)
    self.postMessage({ id, ok: true, path })
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
