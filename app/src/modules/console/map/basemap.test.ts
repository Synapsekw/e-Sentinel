import { describe, it, expect } from 'vitest'
import { effectiveLayer, LAYER_LABELS, LAYER_ORDER, layerButtonLabel } from './basemap'

describe('effectiveLayer', () => {
  it('always shows satellite in the globe scene regardless of layer', () => {
    expect(effectiveLayer('globe', 'dark')).toBe('sat')
    expect(effectiveLayer('globe', 'terrain')).toBe('sat')
  })
  it('uses the operator layer in the console scene', () => {
    expect(effectiveLayer('console', 'dark')).toBe('dark')
    expect(effectiveLayer('console', 'light')).toBe('light')
  })
})

describe('basemap layer labels', () => {
  it('labels every basemap the store can hold', () => {
    expect(LAYER_LABELS).toEqual({
      dark: 'DARK',
      light: 'LIGHT',
      sat: 'SATELLITE',
      terrain: 'TERRAIN',
    })
  })

  it('orders the picker rows dark, light, satellite, terrain', () => {
    expect(LAYER_ORDER).toEqual(['dark', 'light', 'sat', 'terrain'])
  })

  it('every ordered layer has a label', () => {
    for (const l of LAYER_ORDER) expect(LAYER_LABELS[l]).toBeTruthy()
  })

  it('builds the trigger label both topbars show', () => {
    expect(layerButtonLabel('dark')).toBe('LAYERS · DARK')
    expect(layerButtonLabel('sat')).toBe('LAYERS · SATELLITE')
  })
})
