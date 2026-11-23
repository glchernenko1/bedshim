import { describe, expect, it } from 'vitest'
import { DEFAULT_MATERIAL, deadbandOf, lift } from './material'

describe('material model', () => {
  it('has no lift without layers', () => {
    expect(lift(DEFAULT_MATERIAL, 0)).toBe(0)
    expect(lift(DEFAULT_MATERIAL, -3)).toBe(0)
  })

  it('uses t1 for further layers while ts is unknown', () => {
    expect(DEFAULT_MATERIAL.ts).toBeNull()
    expect(lift(DEFAULT_MATERIAL, 1)).toBeCloseTo(0.03, 12)
    expect(lift(DEFAULT_MATERIAL, 2)).toBeCloseTo(0.06, 12)
    expect(lift(DEFAULT_MATERIAL, 6)).toBeCloseTo(0.18, 12)
    const asymmetric = { nominal: 0.05, t1: 0.02, ts: 0.035, calibrated: true }
    expect(lift(asymmetric, 3)).toBeCloseTo(0.02 + 2 * 0.035, 12)
  })

  it('uses 0.4 ts (or 0.4 t1 while ts is unknown) as the deadband', () => {
    expect(deadbandOf(DEFAULT_MATERIAL)).toBeCloseTo(0.012, 12)
    expect(deadbandOf({ nominal: 0.05, t1: 0.02, ts: 0.05, calibrated: true })).toBeCloseTo(0.02, 12)
  })
})
