import { describe, expect, it } from 'vitest'
import { bedMeshSnippet, idealProbeCount, probeAdvice, probeEstimate, probeMismatch, probeVerdict } from './probe'

const bounds = { minX: 10, maxX: 210, minY: 21, maxY: 211 }

describe('idealProbeCount', () => {
  it('derives the count from the tape width (SPEC §5.4)', () => {
    expect(idealProbeCount(bounds, 20)).toEqual({ x: 11, y: 11 })
    expect(idealProbeCount(bounds, 10)).toEqual({ x: 21, y: 20 })
    expect(idealProbeCount(bounds, 50)).toEqual({ x: 5, y: 5 })
  })

  it('never goes below Klipper’s 3 points per axis', () => {
    expect(idealProbeCount(bounds, 400)).toEqual({ x: 3, y: 3 })
  })

  it('estimates probe time from the point count, not a hardcoded total', () => {
    expect(probeEstimate(bounds, 20).points).toBe(121)
    expect(probeEstimate(bounds, 20).minutes).toBeCloseTo((121 * 2) / 60, 6)
    expect(probeEstimate(bounds, 20, 3).minutes).toBeCloseTo((121 * 3) / 60, 6)
  })
})

describe('probeAdvice', () => {
  it('says the current 11×11 mesh is over-measuring for 50 mm tape', () => {
    const codes = probeAdvice({ bounds, tapeWidth: 50, xCount: 11, yCount: 11 }).map((m) => m.code)
    expect(codes).toContain('probe.notice.overMeasuring')
  })

  it('says a coarse mesh cannot resolve a narrow tape', () => {
    const messages = probeAdvice({ bounds, tapeWidth: 10, xCount: 5, yCount: 5 })
    expect(messages.map((m) => m.code)).toContain('probe.notice.coarserThanTape')
    const notice = messages.find((m) => m.code === 'probe.notice.coarserThanTape')
    expect(notice?.params?.probeCount).toBe('21, 20')
  })

  it('warns above 25×25 but still shows the number', () => {
    const messages = probeAdvice({ bounds, tapeWidth: 5, xCount: 11, yCount: 11 })
    const warning = messages.find((m) => m.code === 'probe.warn.tooMany')
    expect(warning).toBeDefined()
    expect(warning?.params?.points).toBe(41 * 39)
    expect(Number(warning?.params?.minutes)).toBeGreaterThan(25)
  })
})

describe('probeVerdict', () => {
  const current = probeEstimate(bounds, 20).points

  it('calls the tape in use good, never fine', () => {
    expect(probeVerdict(current, current)).toBe('good')
  })

  it('keeps the SPEC §5.4 ordering around the current tape', () => {
    expect(probeVerdict(probeEstimate(bounds, 50).points, current)).toBe('coarse')
    expect(probeVerdict(probeEstimate(bounds, 15).points, current)).toBe('fine')
    expect(probeVerdict(probeEstimate(bounds, 10).points, current)).toBe('slow')
  })

  it('does not label the owner’s 12×12 Qidi mesh fine for a 20 mm tape', () => {
    // 210 × 214.97 mm: the round-to-one-probe-per-cell count is exactly 12×12.
    const qidi = { minX: 20, maxX: 230, minY: 15, maxY: 229.97 }
    const ideal = probeEstimate(qidi, 20)
    expect(ideal.idealX).toBe(12)
    expect(ideal.idealY).toBe(12)
    expect(probeVerdict(ideal.points, ideal.points)).toBe('good')
    expect(probeVerdict(probeEstimate(qidi, 15).points, ideal.points)).toBe('fine')
    expect(probeVerdict(probeEstimate(qidi, 10).points, ideal.points)).toBe('slow')
  })
})

describe('probeMismatch', () => {
  const qidi = { minX: 20, maxX: 230, minY: 15, maxY: 229.97 }

  it('flags the owner’s 8×8 mesh for a 20 mm tape', () => {
    expect(probeMismatch(qidi, 20, 8, 8)).toEqual({
      idealX: 12,
      idealY: 12,
      points: 144,
      currentX: 8,
      currentY: 8,
    })
  })

  it('accepts a mesh within one probe of the ideal', () => {
    expect(probeMismatch(qidi, 20, 12, 12)).toBeNull()
    expect(probeMismatch(qidi, 20, 11, 13)).toBeNull()
    expect(probeMismatch(bounds, 20, 11, 11)).toBeNull()
  })

  it('flags a mismatch on either axis, finer or coarser', () => {
    expect(probeMismatch(qidi, 20, 8, 12)).not.toBeNull()
    expect(probeMismatch(qidi, 20, 12, 16)).not.toBeNull()
  })
})

describe('bedMeshSnippet', () => {
  it('changes only the probe count and keeps the mesh bounds', () => {
    expect(bedMeshSnippet(bounds, 11, 11)).toBe(
      ['[bed_mesh]', 'mesh_min: 10, 21', 'mesh_max: 210, 211', 'probe_count: 11, 11', 'algorithm: bicubic'].join('\n'),
    )
  })

  it('keeps fractional bounds exact instead of rounding them', () => {
    const qidi = { minX: 20, maxX: 230, minY: 15, maxY: 229.97 }
    expect(bedMeshSnippet(qidi, 12, 12)).toContain('mesh_max: 230, 229.97')
  })
})
