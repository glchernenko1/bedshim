import { describe, expect, it } from 'vitest'
import { DEFAULT_MATERIAL, deadbandOf, lift } from './material'

describe('material model', () => {
  it('has no lift without layers', () => {
    expect(lift(DEFAULT_MATERIAL, 0)).toBe(0)
    expect(lift(DEFAULT_MATERIAL, -3)).toBe(0)
  })

  it('compresses the first layer harder than the rest', () => {
    expect(lift(DEFAULT_MATERIAL, 1)).toBeCloseTo(0.03, 12)
    expect(lift(DEFAULT_MATERIAL, 2)).toBeCloseTo(0.06, 12)
    expect(lift(DEFAULT_MATERIAL, 6)).toBeCloseTo(0.18, 12)
    const asymmetric = { nominal: 0.05, t1: 0.02, ts: 0.035, calibrated: true }
    expect(lift(asymmetric, 3)).toBeCloseTo(0.02 + 2 * 0.035, 12)
  })

  it('uses 0.4 ts as the deadband', () => {
    expect(deadbandOf(DEFAULT_MATERIAL)).toBeCloseTo(0.012, 12)
  })
})
