import { describe, it, expect } from 'vitest'
import { buildStyle } from './style'

describe('buildStyle composition', () => {
  it('still produces the same layer id sequence after the base/console split', () => {
    const style = buildStyle()
    const layerIds = style.layers.map((l) => l.id)
    // 34 layers, exact order matters: MapLibre paints in array order.
    expect(layerIds).toMatchSnapshot()
    expect(Object.keys(style.sources).sort()).toMatchSnapshot()
  })
})
