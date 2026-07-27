// The ONLY module that imports dji-log-parser-js. Runs off the main thread
// because the parser instantiates its inlined WASM synchronously, which
// Chrome refuses above 4KB on the main thread (spec section 3.4). Decode
// itself is cheap -- 414ms for 27k frames -- so this is about legality, not
// speed.
//
// Nothing here is unit-tested: it is a message shim over normalizeFrames.ts
// (which is fully tested), metaFromDetails.ts (also tested) and the parser
// (third-party). Its real verification is the browser run.

import { DJILog } from 'dji-log-parser-js'
import { normalizeFrames } from './normalizeFrames'
import type { RawFrame } from './normalizeFrames'
import { classifyDecodeError, metaFromDetails } from './djiLogMeta'
import type { FlightMeta } from '../domain/types'

export interface DecodeRequest {
  id: number
  bytes: Uint8Array
  keychains: unknown[] | null
  meta: FlightMeta
}

self.onmessage = (event: MessageEvent<DecodeRequest>) => {
  const { id, bytes, keychains, meta } = event.data

  // Stage 1: parse the container. A failure here means the file is not a DJI
  // TXT flight record at all, which is a different thing from a log we cannot
  // decrypt, and the two must not report the same way.
  let parser: DJILog
  let real: FlightMeta
  try {
    parser = new DJILog(bytes)
    // The details block is NOT encrypted, so this succeeds even for a v13+ log
    // with no keychain. That is what lets a dropped log show its real aircraft,
    // duration and distance instead of the placeholder the caller guessed.
    real = metaFromDetails(meta, parser.version, parser.details)
  } catch (err) {
    self.postMessage({ id, ok: false, kind: classifyDecodeError(err), error: String(err) })
    return
  }

  // Stage 2: decrypt the frames. Failing here is recoverable: we still know
  // everything the details block told us.
  try {
    // frames() takes no argument for pre-v13 logs, which need no keychain.
    const frames = (keychains
      ? parser.frames(keychains as never)
      : parser.frames()) as unknown as RawFrame[]
    self.postMessage({ id, ok: true, meta: real, path: normalizeFrames(frames, real) })
  } catch (err) {
    const kind = classifyDecodeError(err)
    if (kind === 'needs-keychain') {
      // Spec section 9: an encrypted log with no keychain is a normal resting
      // state, not an error. Report the metadata and let the panel show
      // FRAMES LOCKED over it.
      self.postMessage({ id, ok: true, meta: real, path: null, locked: true })
      return
    }
    self.postMessage({ id, ok: false, kind, error: String(err) })
  }
}
