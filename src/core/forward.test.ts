import { describe, expect, it } from 'vitest'
import { buildGrid } from './grid'
import { predict, predictPlan, predictedMeshBlock } from './forward'
import type { Material } from './material'
import { createSurface } from './mesh/interpolate'
import { parseMesh } from './mesh/parse'
import type { Mesh } from './mesh/types'
import { plan } from './plan'

const material: Material = { nominal: 0.05, t1: 0.03, ts: 0.03, calibrated: true }
const bounds = { minX: 10, maxX: 210, minY: 21, maxY: 211 }

function syntheticMesh(fn: (x: number, y: number) => number): Mesh {
  const points: number[][] = []
  for (let row = 0; row < 11; row++) {
    const y = bounds.minY + (row / 10) * (bounds.maxY - bounds.minY)
    const line: number[] = []
    for (let col = 0; col < 11; col++) {
      const x = bounds.minX + (col / 10) * (bounds.maxX - bounds.minX)
      line.push(fn(x, y))
    }
    points.push(line)
  }
  return {
    name: 'synthetic',
    version: 1,
    xCount: 11,
    yCount: 11,
    points,
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
}

function grid() {
  return buildGrid({ plate: { w: 235, h: 235 }, meshBounds: bounds, tapeWidth: 20, meshXCount: 11, meshYCount: 11 })
}

function zeros(): number[][] {
  return Array.from({ length: 10 }, () => new Array<number>(10).fill(0))
}

describe('predict — bridging', () => {
  it('keeps a uniform tape field uniform away from the edges', () => {
    const surface = createSurface(syntheticMesh(() => -0.05))
    const layers = Array.from({ length: 10 }, () => new Array<number>(10).fill(2))
    const result = predict({ surface, grid: grid(), layers, material, reference: 0 })
    for (const cell of result.cells) {
      expect(cell.effectiveLift).toBeCloseTo(0.06, 9)
      expect(cell.residual).toBeCloseTo(0.01, 9)
    }
    expect(result.achievable).toBe(1)
  })

  it('spreads a single-cell patch over its neighbours', () => {
    const surface = createSurface(syntheticMesh(() => 0))
    const layers = zeros()
    layers[5]![5] = 1
    const result = predict({ surface, grid: grid(), layers, material, reference: 0 })
    const centre = result.cells.find((cell) => cell.row === 5 && cell.col === 5)!
    // 0.03 mm under one 20×19 cell is mostly bridged by the plate.
    expect(centre.effectiveLift).toBeLessThan(0.01)
    expect(centre.effectiveLift).toBeGreaterThan(0)
    const neighbour = result.cells.find((cell) => cell.row === 5 && cell.col === 6)!
    expect(neighbour.effectiveLift).toBeGreaterThan(0)
    expect(neighbour.effectiveLift).toBeLessThan(centre.effectiveLift)
  })

  it('reaches for achievable > 0.9 on a smooth bowl', () => {
    const bowl = syntheticMesh((x, y) => {
      const u = (x - 110) / 100
      const v = (y - 116) / 95
      return -0.03 + 0.06 * (u * u + v * v)
    })
    const surface = createSurface(bowl)
    const result = plan({ surface, grid: grid(), material, referencePercentile: 0.85, rounding: 'round' })
    const prediction = predictPlan(result, surface)
    expect(prediction.achievable).toBeGreaterThan(0.9)
  })

  it('reports a single-cell plan as not achievable', () => {
    // One deep low spot, a plan that tapes only that cell: the plate bridges it,
    // so almost none of the required lift arrives.
    const dent = syntheticMesh((x, y) => (x >= 110 && x <= 130 && y >= 116 && y <= 135 ? -0.05 : 0))
    const surface = createSurface(dent)
    const layers = zeros()
    layers[5]![5] = 2
    const result = predict({ surface, grid: grid(), layers, material, reference: 0 })
    expect(result.achievable).toBeLessThan(0.4)
    expect(result.warnings.map((warning) => warning.code)).toContain('forward.warn.notAchievable')
  })
})

describe('predict — report', () => {
  it('computes residuals against the reference', () => {
    const surface = createSurface(syntheticMesh(() => 0.02))
    const layers = zeros()
    const result = predict({ surface, grid: grid(), layers, material, reference: 0.02 })
    expect(result.maxAbsResidual).toBeLessThan(1e-9)
    expect(result.rmsResidual).toBeLessThan(1e-9)
    expect(result.achievable).toBe(1) // nothing was taped, nothing to achieve
  })

  it('exports a parseable [bed_mesh] block of the prediction', () => {
    const bowl = syntheticMesh((x, y) => {
      const u = (x - 110) / 100
      const v = (y - 116) / 95
      return -0.03 + 0.06 * (u * u + v * v)
    })
    const surface = createSurface(bowl)
    const result = plan({ surface, grid: grid(), material, referencePercentile: 0.85, rounding: 'round' })
    const prediction = predictPlan(result, surface)
    const block = predictedMeshBlock(prediction, bowl, 'predicted')
    const parsed = parseMesh(block)
    expect(parsed.mesh.xCount).toBe(11)
    expect(parsed.mesh.yCount).toBe(11)
    expect(parsed.mesh.name).toBe('predicted')
    for (let row = 0; row < 11; row++) {
      for (let col = 0; col < 11; col++) {
        expect(parsed.mesh.points[row]![col]).toBeCloseTo(prediction.predictedMesh.points[row]![col]!, 6)
      }
    }
  })
})
