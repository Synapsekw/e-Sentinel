// Static flight summary above cursor-following readouts. Both halves come
// from different sources on purpose: the summary reads FlightMeta, which is
// available with no keychain, so an undecryptable flight still shows
// everything the log's details block knows.

import { useTelemetryStore } from '../store/telemetryStore'
import { distanceFromHomeM, sampleAt } from '../domain/flightPath'
import {
  fmtDate,
  fmtDuration,
  fmtHeading,
  fmtKm,
  fmtMeters,
  fmtPitch,
  fmtSpeed,
} from '../domain/format'
import type { FlightMeta } from '../domain/types'
import './telemetry.css'

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="lbl">{label}</div>
      <div className="tm-readout-val">{value}</div>
    </div>
  )
}

function Summary({ meta }: { meta: FlightMeta }) {
  return (
    <div className="tm-summary">
      <div className="lbl">AIRCRAFT</div>
      <div className="tm-readout-val">{meta.aircraftName}</div>
      <div className="tm-readout-val" style={{ fontSize: 12, opacity: 0.7 }}>
        {meta.aircraftSn}
      </div>
      <div className="tm-readouts" style={{ marginTop: 12 }}>
        <Readout label="START" value={fmtDate(meta.startTime)} />
        <Readout label="DURATION" value={fmtDuration(meta.durationS)} />
        <Readout label="DISTANCE" value={fmtKm(meta.distanceKm)} />
        <Readout label="MAX ALT" value={fmtMeters(meta.maxHeightM)} />
        <Readout label="MAX SPEED" value={fmtSpeed(meta.maxSpeedMs)} />
        <Readout label="FRAMES" value={String(meta.recordCount)} />
      </div>
    </div>
  )
}

export default function FramePanel() {
  const path = useTelemetryStore((s) => s.path)
  const cursorT = useTelemetryStore((s) => s.cursorT)
  const loading = useTelemetryStore((s) => s.loading)
  const error = useTelemetryStore((s) => s.error)
  const selectedId = useTelemetryStore((s) => s.selectedId)
  const catalog = useTelemetryStore((s) => s.catalog)
  const sessionFlights = useTelemetryStore((s) => s.sessionFlights)

  const selectedMeta =
    path?.meta ?? [...sessionFlights, ...catalog].find((f) => f.id === selectedId) ?? null

  // Nothing to show at all: no selection, no in-flight decode, no error.
  // Loading/error can legitimately fire before a matching FlightMeta is
  // resolvable (e.g. a decode kicked off for an id not yet in the catalog),
  // so those must be able to render even when selectedMeta is still null.
  if (!selectedId && !path && !loading && !error) {
    return (
      <aside className="tm-panel">
        <div className="tm-empty lbl">SELECT A FLIGHT</div>
      </aside>
    )
  }

  const sample = path ? sampleAt(path, cursorT) : null

  return (
    <aside className="tm-panel">
      {selectedMeta && <Summary meta={selectedMeta} />}

      {loading && <div className="lbl">DECODING FLIGHT…</div>}
      {error && <div className="tm-error lbl">{error}</div>}

      {!loading && !error && !path && selectedMeta && (
        <div className="tm-locked">
          <div className="lbl">FRAMES LOCKED</div>
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
            No keychain baked for this log, so the recorded track cannot be decrypted. Everything
            above reads from the log&apos;s unencrypted details block.
          </div>
        </div>
      )}

      {path && sample && (
        <div className="tm-readouts">
          <Readout label="ALT AGL" value={fmtMeters(sample.height)} />
          <Readout label="ALT ASL" value={fmtMeters(sample.alt)} />
          <Readout label="GROUND SPD" value={fmtSpeed(sample.speedH)} />
          <Readout label="VERT SPD" value={fmtSpeed(sample.speedV)} />
          <Readout label="HEADING" value={fmtHeading(sample.heading)} />
          <Readout label="GIMBAL" value={fmtPitch(sample.gimbalPitch)} />
          <Readout label="BATTERY" value={`${Math.round(sample.battery)}%`} />
          <Readout label="VOLTAGE" value={`${sample.voltage.toFixed(1)} V`} />
          <Readout label="SATS" value={String(Math.round(sample.sats))} />
          <Readout label="MODE" value={sample.mode} />
          <Readout label="FROM HOME" value={fmtMeters(distanceFromHomeM(sample, path.meta.home))} />
        </div>
      )}
    </aside>
  )
}
