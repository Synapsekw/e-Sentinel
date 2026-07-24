import { describe, it, expect } from 'vitest'
import { routerBasename } from './env'

describe('routerBasename', () => {
  it('strips the trailing slash from a subpath base', () => {
    expect(routerBasename('/e-Sentinel/')).toBe('/e-Sentinel')
  })

  it('maps the dev root base to an empty basename', () => {
    expect(routerBasename('/')).toBe('')
  })

  it('leaves a slashless base unchanged', () => {
    expect(routerBasename('/e-Sentinel')).toBe('/e-Sentinel')
  })
})
