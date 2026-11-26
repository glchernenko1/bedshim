import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildGrid } from './grid'
import type { Material } from './material'
import { createSurface } from './mesh/interpolate'
import { parseMesh } from './mesh/parse'
import type { Mesh } from './mesh/types'
import { diffAgainstPhysical, plan, quantile, quantize, type PlanOptions } from './plan'
import { buildStrips } from './strips'

const material: Material = { nominal: 0.05, t1: 0.03, ts: 0.03, calibrated: true }
const fixtureText = readFileSync(new URL('../../fixtures/neptune4-mesh.cfg', import.meta.url), 'utf8')

// Historical bilinear table from the first version of Appendix A.
const GOLDEN = [
  [0, 0, 1, 2, 2, 2, 3, 2, 1, 0],
  [0, 0, 1, 1, 1, 2, 2, 2, 1, 0],
  [0, 0, 1, 1, 1, 2, 2, 2, 1, 0],
  [0, 0, 1, 2, 1, 2, 2, 1, 1, 0],
  [0, 0, 1, 2, 1, 2, 2, 1, 1, 0],
  [0, 0, 1, 1, 1, 1, 1, 1, 1, 0],
  [0, 1, 2, 2, 1, 1, 1, 1, 0, 0],
  [1, 1, 2, 2, 2, 2, 1, 1, 1, 0],
  [1, 1, 2, 2, 2, 2, 2, 1, 1, 1],
  [1, 1, 2, 2, 2, 2, 2, 1, 1, 1],
]

function fixturePlan(overrides: Partial<PlanOptions> = {}) {
  const { mesh } = parseMesh(fixtureText)
  const surface = overrides.surface ?? createSurface(mesh)
  const grid = buildGrid({
    plate: { w: 235, h: 235 },
    meshBounds: mesh.bounds!,
    tapeWidth: 20,
    meshXCount: mesh.xCount,
    meshYCount: mesh.yCount,
  })
  return plan({
    surface,
    grid,
    material,
    referencePercentile: 0.85,
    rounding: 'round',
    ...overrides,
  })
}

/** A perfectly level plate: the plan wants no tape at all. */
function flatSurface(value = 0) {
  const bounds = { minX: 10, maxX: 210, minY: 21, maxY: 211 }
  const mesh: Mesh = {
    name: 'flat',
    version: 1,
    xCount: 11,
    yCount: 11,
    points: Array.from({ length: 11 }, () => new Array<number>(11).fill(value)),
    bounds,
    algo: 'bicubic',
    tension: 0.2,
    meshXPps: 4,
    meshYPps: 4,
    source: 'block',
    inferred: { counts: false, bounds: false, algo: false, tension: false, pps: false },
    ignoredKeys: [],
    notices: [],
  }
  return { surface: createSurface(mesh), bounds }
}

describe('quantile', () => {
  it('interpolates linearly, R-7 style', () => {
    expect(quantile([1, 2, 3, 4], 0)).toBe(1)
    expect(quantile([1, 2, 3, 4], 1)).toBe(4)
    expect(quantile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 12)
    expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 12)
    expect(quantile([], 0.5)).toBeNaN()
  })
})

describe('quantize', () => {
  const options = { deadband: 0.012, maxLayers: 6, rounding: 'round' as const }

  it('does nothing inside the deadband', () => {
    expect(quantize(0, material, options)).toBe(0)
    expect(quantize(0.0119, material, options)).toBe(0)
  })

  it('picks the nearest effective lift', () => {
    expect(quantize(0.02, material, options)).toBe(1)
    expect(quantize(0.07, material, options)).toBe(2)
    expect(quantize(0.9, material, options)).toBe(6)
  })

  it('prefers the smaller count on a tie', () => {
    // lift(1) = 0.03, lift(2) = 0.06; 0.045 is exactly between them.
    expect(quantize(0.045, material, options)).toBe(1)
  })

  it('never exceeds the target with floor', () => {
    const floor = { ...options, rounding: 'floor' as const }
    expect(quantize(0.02, material, floor)).toBe(0)
    expect(quantize(0.045, material, floor)).toBe(1)
    expect(quantize(0.085, material, floor)).toBe(2)
  })

  it('clamps to maxLayers', () => {
    expect(quantize(0.5, material, { ...options, maxLayers: 3 })).toBe(3)
  })

  it('models the compressed first layer', () => {
    const asymmetric: Material = { nominal: 0.05, t1: 0.02, ts: 0.04, calibrated: true }
    expect(quantize(0.025, asymmetric, options)).toBe(1)
    expect(quantize(0.05, asymmetric, options)).toBe(2)
  })
})

describe('plan — Appendix A golden', () => {
  it('reproduces the golden matrix of Appendix A', () => {
    const result = fixturePlan()
    expect(result.layers).toEqual(GOLDEN)
    expect(result.stats.totalLayers).toBe(112)
    expect(result.stats.cellsWithTape).toBe(78)
    expect(result.stats.tapeLengthMM).toBe(2240)
    expect(result.reference).toBeGreaterThan(0.04)
    expect(result.reference).toBeLessThan(0.05)
  })

  it('honours the sign convention: a positive value means the plate is high', () => {
    const high = fixturePlan()
    const low = fixturePlan({ meshSign: 'low' })
    // A1 is measured high (+0.09), so under Klipper's sign it needs no tape.
    expect(high.layers[0]![0]).toBe(0)
    // Reading the same mesh with the inverted sign puts tape there instead.
    expect(low.layers[0]![0]).toBeGreaterThan(0)
    expect(low.stats.totalLayers).not.toBe(high.stats.totalLayers)
  })

  it('adds the remaining correction on top of the measured layer state', () => {
    const base = Array.from({ length: 10 }, () => new Array<number>(10).fill(2))
    const withBase = fixturePlan({ baseLayers: base })
    // Outside the deliberate t1 witness the plan never goes below the stack.
    for (const cell of withBase.cells) {
      if (!cell.unprobed && cell.reference === null) expect(cell.layers).toBeGreaterThanOrEqual(2)
    }
    // Every probed cell carries tape, so a witness had to be carved.
    expect(withBase.referenceZone).not.toBeNull()
    expect(withBase.referenceZone?.zero).not.toBeNull()
    expect(withBase.referenceZone!.peel).toBeGreaterThan(0)
    expect(withBase.warnings.map((warning) => warning.code)).toContain('plan.notice.referenceZonePeel')
  })

  it('keeps the old monotonic stack when the calibration zone is turned off', () => {
    const base = Array.from({ length: 10 }, () => new Array<number>(10).fill(2))
    const withBase = fixturePlan({ baseLayers: base, calibrationZone: false })
    for (const cell of withBase.cells) {
      if (!cell.unprobed) expect(cell.layers).toBeGreaterThanOrEqual(2)
    }
    expect(withBase.stats.totalLayers).toBeGreaterThanOrEqual(200)
    expect(withBase.referenceZone).toBeNull()
  })

  it('is a pure function of its inputs', () => {
    expect(fixturePlan().layers).toEqual(fixturePlan().layers)
  })
})

describe('plan — layer ceiling headroom', () => {
  it('suggests raising the ceiling when the plan fills it', () => {
    const result = fixturePlan({ maxLayers: 3 })
    expect(result.stats.idealMax).toBe(3)
    expect(result.stats.clamped).toBe(0)
    expect(result.warnings).toContainEqual({
      code: 'plan.notice.headroom',
      params: { used: 3, max: 3, suggest: 6 },
    })
  })

  it('reports the real need and a ceiling with reserve when cells are clamped', () => {
    const result = fixturePlan({ maxLayers: 2 })
    expect(result.stats.clamped).toBeGreaterThan(0)
    expect(result.stats.idealMax).toBe(3)
    const warning = result.warnings.find((item) => item.code === 'plan.notice.clamped')
    expect(warning?.params).toEqual({ count: result.stats.clamped, max: 2, needed: 3, suggest: 6 })
    expect(result.warnings.map((item) => item.code)).not.toContain('plan.notice.headroom')
  })

  it('stays quiet when there is enough reserve', () => {
    const result = fixturePlan({ maxLayers: 6 })
    expect(result.stats.idealMax).toBe(3)
    const codes = result.warnings.map((item) => item.code)
    expect(codes).not.toContain('plan.notice.headroom')
    expect(codes).not.toContain('plan.notice.clamped')
  })
})

describe('plan — physics guards', () => {
  it('never plans tape outside the probed area', () => {
    const { mesh } = parseMesh(fixtureText)
    const surface = createSurface(mesh)
    const grid = buildGrid({
      plate: { w: 235, h: 235 },
      meshBounds: mesh.bounds!,
      tapeWidth: 15,
      meshXCount: mesh.xCount,
      meshYCount: mesh.yCount,
    })
    const result = plan({ surface, grid, material, rounding: 'round' })
    for (const cell of result.cells) {
      if (cell.unprobed) expect(cell.layers).toBe(0)
    }
  })

  it('does not shim a flat bed', () => {
    const flat: Mesh = {
      name: 'flat',
      version: 1,
      xCount: 3,
      yCount: 3,
      points: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
      bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
      algo: 'bicubic',
      tension: 0.2,
      meshXPps: 2,
      meshYPps: 2,
      source: 'block',
      inferred: { counts: false, bounds: false, algo: false, tension: false, pps: false },
      ignoredKeys: [],
      notices: [],
    }
    const grid = buildGrid({ plate: { w: 100, h: 100 }, meshBounds: flat.bounds!, tapeWidth: 20, meshXCount: 3, meshYCount: 3 })
    const result = plan({ surface: createSurface(flat), grid, material, rounding: 'round' })
    expect(result.stats.totalLayers).toBe(0)
  })

  it('smoothing the target removes tape (the optional §1.2 reading)', () => {
    const raw = fixturePlan({ smoothTarget: false })
    const smoothed = fixturePlan({ smoothTarget: true, sigma: 22 })
    expect(smoothed.stats.totalLayers).toBeLessThan(raw.stats.totalLayers)
  })
})

describe('plan — extended margin', () => {
  function extendedSetup() {
    const { mesh } = parseMesh(fixtureText)
    const surface = createSurface(mesh)
    const grid = buildGrid({
      plate: { w: 235, h: 235 },
      meshBounds: mesh.bounds!,
      tapeWidth: 20,
      meshXCount: mesh.xCount,
      meshYCount: mesh.yCount,
      extendToPlate: true,
    })
    return { surface, grid }
  }

  it('plans the margin from the nearest edge and warns about it', () => {
    const { surface, grid } = extendedSetup()
    const result = plan({ surface, grid, material, referencePercentile: 0.85, rounding: 'round' })
    expect(result.stats.extrapolated).toBe(36)
    expect(result.warnings.map((warning) => warning.code)).toContain('plan.notice.extrapolated')
    expect(result.warnings.map((warning) => warning.code)).not.toContain('plan.notice.unprobed')
    expect(result.stats.totalLayers).toBeGreaterThan(112)
    expect(result.stats.cellsWithTape).toBeGreaterThan(78)
    expect(result.layers[0]![3]).toBeGreaterThan(0)
    expect(result.cells.find((cell) => cell.row === 0 && cell.col === 3)?.extrapolated).toBe(true)
  })

  it('never puts the t1 witness in the extrapolated margin', () => {
    const { surface, grid } = extendedSetup()
    const base = Array.from({ length: grid.rows }, () => new Array<number>(grid.cols).fill(2))
    const result = plan({
      surface,
      grid,
      material,
      referencePercentile: 0.85,
      rounding: 'round',
      baseLayers: base,
    })
    expect(result.referenceZone).not.toBeNull()
    for (const cell of result.cells) {
      if (!cell.reference) continue
      expect(cell.unprobed).toBe(false)
      expect(cell.extrapolated).toBe(false)
      expect(cell.partial).toBe(false)
    }
  })

  it('mixes rows and columns so the cut width stays at the tape width', () => {
    const { surface, grid } = extendedSetup()
    const result = plan({ surface, grid, material, referencePercentile: 0.85, rounding: 'round' })
    const strips = buildStrips(result)
    // Interior columns are exactly 20 mm wide, so they are cut front→back;
    // the stretched rows A/J are just part of the strip's length.
    expect(strips.pieces.find((piece) => piece.label === 'A3–J3')).toMatchObject({
      orient: 'column',
      width: 20,
      length: 223,
      acrossCount: 1,
    })
    // The stretched left/right columns are wider than the roll, so their cells
    // are cut across the row instead (a normal row is one tape width tall).
    expect(strips.pieces.find((piece) => piece.label === 'I1')).toMatchObject({
      orient: 'row',
      width: 20,
      length: 24,
    })
    expect(strips.pieces.find((piece) => piece.label === 'I10')).toMatchObject({
      orient: 'row',
      width: 20,
      length: 39,
    })
    // Only the corners change width: the back row is 37 mm tall.
    expect(strips.pieces.find((piece) => piece.label === 'J1 (1/2)')).toMatchObject({
      width: 18.5,
      length: 24,
      acrossCount: 2,
    })
    expect(strips.pieces.find((piece) => piece.label === 'J10 (1/2)')).toMatchObject({
      width: 18.5,
      length: 39,
      acrossCount: 2,
    })
    expect(
      strips.pieces
        .filter((piece) => piece.width !== 20)
        .every((piece) => piece.label.startsWith('J1') || piece.label.startsWith('J10')),
    ).toBe(true)
    expect(strips.pieces.length).toBe(32)
  })
})

describe('plan — t1 reference zone', () => {
  it('leaves a plan with 0 and taped cells alone', () => {
    const result = fixturePlan()
    expect(result.referenceZone).toBeNull()
    expect(
      result.warnings.some((warning) => warning.code.startsWith('plan.notice.reference')),
    ).toBe(false)
  })

  it('does not invent tape on a level bare plate', () => {
    const { surface, bounds } = flatSurface()
    const grid = buildGrid({
      plate: { w: 235, h: 235 },
      meshBounds: bounds,
      tapeWidth: 20,
      meshXCount: 11,
      meshYCount: 11,
    })
    const result = plan({ surface, grid, material, rounding: 'round' })
    expect(result.stats.totalLayers).toBe(0)
    expect(result.referenceZone).toBeNull()
  })

  it('does not bump a stable bed that already has an untaped cell', () => {
    const { surface, bounds } = flatSurface()
    const grid = buildGrid({
      plate: { w: 235, h: 235 },
      meshBounds: bounds,
      tapeWidth: 20,
      meshXCount: 11,
      meshYCount: 11,
    })
    const base = Array.from({ length: grid.rows }, () => new Array<number>(grid.cols).fill(1))
    base[5]![5] = 0
    const result = plan({ surface, grid, material, rounding: 'round', baseLayers: base })
    expect(result.stats.totalLayers).toBe(99)
    expect(result.referenceZone).toBeNull()
  })

  it('reserves a witness on a fully taped bed when t1 is still unknown', () => {
    const { surface, bounds } = flatSurface()
    const grid = buildGrid({
      plate: { w: 235, h: 235 },
      meshBounds: bounds,
      tapeWidth: 20,
      meshXCount: 11,
      meshYCount: 11,
    })
    const base = Array.from({ length: grid.rows }, () => new Array<number>(grid.cols).fill(2))
    const result = plan({
      surface,
      grid,
      material: { ...material, calibrated: false },
      rounding: 'round',
      baseLayers: base,
    })
    expect(result.stats.totalLayers).toBeLessThan(200)
    expect(result.referenceZone).not.toBeNull()
    expect(result.referenceZone!.peel).toBeGreaterThan(0)
  })

  it('reserves a witness on a level bed when t1 is still unknown', () => {
    const { surface, bounds } = flatSurface()
    const grid = buildGrid({
      plate: { w: 235, h: 235 },
      meshBounds: bounds,
      tapeWidth: 20,
      meshXCount: 11,
      meshYCount: 11,
    })
    const base = Array.from({ length: grid.rows }, () => new Array<number>(grid.cols).fill(1))
    const result = plan({
      surface,
      grid,
      material: { ...material, calibrated: false },
      rounding: 'floor',
      baseLayers: base,
    })
    expect(result.referenceZone).not.toBeNull()
    expect(result.referenceZone!.peel).toBeGreaterThan(0)
  })

  it('keeps the witness at 0 and 1 layer, never below zero', () => {
    const base = Array.from({ length: 10 }, () => new Array<number>(10).fill(2))
    const result = fixturePlan({ baseLayers: base })
    expect(result.referenceZone).not.toBeNull()
    for (const cell of result.cells) {
      expect(cell.layers).toBeGreaterThanOrEqual(0)
      if (cell.reference === 'zero') expect(cell.layers).toBe(0)
      if (cell.reference === 'first') expect(cell.layers).toBe(1)
    }
  })

  it('keeps every step around the witness within one layer', () => {
    const base = Array.from({ length: 10 }, () => new Array<number>(10).fill(2))
    const result = fixturePlan({ baseLayers: base })
    const layers = result.layers
    for (const cell of result.cells) {
      if (!cell.reference) continue
      for (const [dr, dc] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const) {
        const value = layers[cell.row + dr]?.[cell.col + dc]
        if (value === undefined) continue
        expect(Math.abs(cell.layers - value), cell.id).toBeLessThanOrEqual(1)
      }
    }
  })

  it('shows the carving as peel in the physical diff', () => {
    const base = Array.from({ length: 10 }, () => new Array<number>(10).fill(2))
    const result = fixturePlan({ baseLayers: base })
    const diff = diffAgainstPhysical(result, base)
    // All peel comes from the witness; the rest of the bed still gets its
    // remaining correction on top of the existing stack.
    expect(diff.peel).toBe(result.referenceZone!.peel)
    expect(diff.add).toBeGreaterThan(0)
  })
})

describe('diffAgainstPhysical', () => {
  const result = fixturePlan()
  const zero = Array.from({ length: 10 }, () => new Array<number>(10).fill(0))

  it('asks for additions on a bare plate', () => {
    const diff = diffAgainstPhysical(result, zero)
    expect(diff.add).toBe(result.stats.totalLayers)
    expect(diff.peel).toBe(0)
    expect(diff.unchanged).toBe(100 - result.stats.cellsWithTape)
  })

  it('is empty when the plate already matches the plan', () => {
    const diff = diffAgainstPhysical(result, result.layers)
    expect(diff.add).toBe(0)
    expect(diff.peel).toBe(0)
    expect(diff.unchanged).toBe(100)
  })

  it('can peel tape that is already there, never below zero', () => {
    const tooMuch = result.layers.map((row) => row.map((value) => value + 2))
    const diff = diffAgainstPhysical(result, tooMuch)
    expect(diff.add).toBe(0)
    expect(diff.peel).toBe(200)
    for (const cell of diff.cells) {
      expect(cell.physical + cell.delta).toBeGreaterThanOrEqual(0)
      expect(cell.planned).toBeGreaterThanOrEqual(0)
    }
  })
})
