// Filter controls over the flight library. Every control here reads a field
// that comes from a log's unencrypted details block, so filtering works
// identically whether or not a keychain was baked.

import { useId } from 'react'
import { aircraftOptions } from '../domain/filters'
import { useTelemetryStore } from '../store/telemetryStore'
import type { CatalogSort } from '../domain/types'
import './telemetry.css'

const SORTS: { value: CatalogSort; label: string }[] = [
  { value: 'newest', label: 'NEWEST FIRST' },
  { value: 'oldest', label: 'OLDEST FIRST' },
  { value: 'duration', label: 'LONGEST' },
  { value: 'distance', label: 'FURTHEST' },
]

export default function LibraryFilters() {
  const catalog = useTelemetryStore((s) => s.catalog)
  const sessionFlights = useTelemetryStore((s) => s.sessionFlights)
  const filters = useTelemetryStore((s) => s.filters)
  const sort = useTelemetryStore((s) => s.sort)
  // Actions via getState(), not selectors -- see the conventions section.
  const store = useTelemetryStore

  const ids = useId()
  const aircraft = aircraftOptions([...sessionFlights, ...catalog])

  return (
    <div className="tm-filters">
      <div>
        <label className="lbl" htmlFor={`${ids}-search`}>
          SEARCH
        </label>
        <input
          id={`${ids}-search`}
          type="search"
          placeholder="aircraft, serial, file"
          value={filters.text}
          onChange={(e) => store.getState().setFilters({ ...filters, text: e.target.value })}
        />
      </div>

      <div>
        <label className="lbl" htmlFor={`${ids}-aircraft`}>
          AIRCRAFT
        </label>
        <select
          id={`${ids}-aircraft`}
          value={filters.aircraftSn ?? ''}
          onChange={(e) =>
            store.getState().setFilters({ ...filters, aircraftSn: e.target.value || null })
          }
        >
          <option value="">ALL AIRCRAFT</option>
          {aircraft.map((a) => (
            <option key={a.sn} value={a.sn}>
              {a.name} · {a.sn.slice(-6)}
            </option>
          ))}
        </select>
      </div>

      <div className="tm-filter-row">
        <div style={{ flex: 1 }}>
          <label className="lbl" htmlFor={`${ids}-from`}>
            FROM
          </label>
          <input
            id={`${ids}-from`}
            type="date"
            value={filters.from ?? ''}
            onChange={(e) =>
              store.getState().setFilters({ ...filters, from: e.target.value || null })
            }
          />
        </div>
        <div style={{ flex: 1 }}>
          <label className="lbl" htmlFor={`${ids}-to`}>
            TO
          </label>
          <input
            id={`${ids}-to`}
            type="date"
            value={filters.to ?? ''}
            onChange={(e) =>
              store.getState().setFilters({ ...filters, to: e.target.value || null })
            }
          />
        </div>
      </div>

      <div className="tm-filter-row">
        <div style={{ flex: 1 }}>
          {/* Minutes in the UI, seconds in the model: nobody filters flights
              by the second, and FlightMeta.durationS is seconds. */}
          <label className="lbl" htmlFor={`${ids}-dur`}>
            MIN DURATION (MIN)
          </label>
          <input
            id={`${ids}-dur`}
            type="number"
            min={0}
            value={filters.minDurationS === 0 ? '' : Math.round(filters.minDurationS / 60)}
            onChange={(e) =>
              store.getState().setFilters({
                ...filters,
                minDurationS: Math.max(0, Number(e.target.value) || 0) * 60,
              })
            }
          />
        </div>
        <div style={{ flex: 1 }}>
          <label className="lbl" htmlFor={`${ids}-sort`}>
            SORT
          </label>
          <select
            id={`${ids}-sort`}
            value={sort}
            onChange={(e) => store.getState().setSort(e.target.value as CatalogSort)}
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
