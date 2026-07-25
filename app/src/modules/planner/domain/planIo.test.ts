import { describe, it, expect } from 'vitest'
import { serializePlan, parsePlan } from './planIo'
import { createPlan, addDock } from './plan'
import type { PlannedDock } from './types'

const dock: PlannedDock = {
  id: 'd1',
  name: 'D1',
  position: [54.6, 24.3],
  dockModel: 'DOCK3',
  droneModel: 'M4TD',
  environment: 'urban',
  source: 'manual',
}

describe('plan JSON round-trip', () => {
  it('survives serialize then parse unchanged', () => {
    const plan = addDock(createPlan({ name: 'ACME', customer: 'ACME CORP' }), dock)
    const out = parsePlan(serializePlan(plan))
    if (!out.ok) throw new Error(out.message)
    expect(out.plan).toEqual(plan)
  })

  it('rejects JSON that is not a plan', () => {
    const out = parsePlan('{"hello":true}')
    expect(out.ok).toBe(false)
  })

  it('rejects a future schema version', () => {
    const plan = { ...createPlan(), schemaVersion: 99 }
    const out = parsePlan(JSON.stringify(plan))
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.message).toContain('99')
  })

  it('rejects malformed JSON without throwing', () => {
    expect(() => parsePlan('{not json')).not.toThrow()
    expect(parsePlan('{not json').ok).toBe(false)
  })
})
