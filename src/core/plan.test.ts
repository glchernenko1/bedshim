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
    // A plan computed on an already-taped bed is never below the existing stack.
    for (const cell of withBase.cells) {
      if (!cell.unprobed) expect(cell.layers).toBeGreaterThanOrEqual(2)
    }
    expect(withBase.stats.totalLayers).toBeGreaterThanOrEqual(200)
  })

  it('is a pure function of its inputs', () => {
    expect(fixturePlan().layers).toEqual(fixturePlan().layers)
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
