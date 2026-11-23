import { describe, expect, it } from 'vitest'
import { fitMaterial } from './calibrate'
import { buildGrid } from './grid'
import type { Material } from './material'
import { createSurface } from './mesh/interpolate'
import type { Mesh } from './mesh/types'

const bounds = { minX: 10, maxX: 210, minY: 21, maxY: 211 }
const trueMaterial: Material = { nominal: 0.05, t1: 0.025, ts: 0.04, calibrated: true }

function grid() {
  return buildGrid({ plate: { w: 235, h: 235 }, meshBounds: bounds, tapeWidth: 20, meshXCount: 11, meshYCount: 11 })
}

function flatMesh(value: number): Mesh {
  return {
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
}

function meshFromPoints(points: number[][]): Mesh {
  const base = flatMesh(0)
  return { ...base, points: points.map((row) => [...row]) }
}

/** Nested bands: 1 layer across the middle, 2 in a narrower band, 3 in the centre. */
function layerPattern(): number[][] {
  const layers = Array.from({ length: 10 }, () => new Array<number>(10).fill(0))
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 10; col++) {
      if (col >= 2 && col <= 7) layers[row]![col] = 1
      if (col >= 3 && col <= 6) layers[row]![col] = 2
      if (col >= 4 && col <= 5) layers[row]![col] = 3
    }
  }
  return layers
}

function noisy(points: number[][], amplitude: number): number[][] {
  return points.map((row, r) => row.map((value, c) => value + amplitude * Math.sin(r * 12.9898 + c * 78.233)))
}

/** Independent gaussian evaluation of the tape field at an arbitrary point. */
function blurredLiftAt(x: number, y: number, layers: number[][], sigma: number): number {
  const g = grid()
  const inv = 1 / (2 * sigma * sigma)
  let sum = 0
  let weight = 0
  for (const cell of g.cells) {
    const cx = (cell.x0 + cell.x1) / 2
    const cy = (cell.y0 + cell.y1) / 2
    const dx = cx - x
    const dy = cy - y
    const w = Math.exp(-(dx * dx + dy * dy) * inv)
    const n = layers[cell.row]?.[cell.col] ?? 0
    const lift = n === 0 ? 0 : trueMaterial.t1 + (n - 1) * trueMaterial.ts
    sum += w * lift
    weight += w
  }
  return weight > 0 ? sum / weight : 0
}

function meshFromField(layers: number[][], sigma: number, offset = 0): Mesh {
  const points: number[][] = []
  for (let row = 0; row < 11; row++) {
    const y = bounds.minY + (row / 10) * (bounds.maxY - bounds.minY)
    const line: number[] = []
    for (let col = 0; col < 11; col++) {
      const x = bounds.minX + (col / 10) * (bounds.maxX - bounds.minX)
      line.push(offset + blurredLiftAt(x, y, layers, sigma))
    }
    points.push(line)
  }
  return meshFromPoints(points)
}

describe('fitMaterial', () => {
  it('recovers t1 and ts from a clean synthetic loop', () => {
    const layers = layerPattern()
    const oldSurface = createSurface(flatMesh(0))
    const zero = Array.from({ length: 10 }, () => new Array<number>(10).fill(0))
    const newSurface = createSurface(meshFromField(layers, 22))
    const fit = fitMaterial({
      oldSurface,
      newSurface,
      oldLayers: zero,
      newLayers: layers,
      grid: grid(),
      sigma: 22,
    })
    expect(Math.abs(fit.t1 - trueMaterial.t1) / trueMaterial.t1).toBeLessThan(0.02)
    expect(Math.abs(fit.ts - trueMaterial.ts) / trueMaterial.ts).toBeLessThan(0.02)
    expect(fit.r2).toBeGreaterThan(0.99)
    expect(fit.conclusive).toBe(true)
  })

  it('recovers within 5% from a noisy mesh', () => {
    const layers = layerPattern()
    const oldSurface = createSurface(flatMesh(0))
    const zero = Array.from({ length: 10 }, () => new Array<number>(10).fill(0))
    const clean = meshFromField(layers, 22)
    const newSurface = createSurface(meshFromPoints(noisy(clean.points, 0.002)))
    const fit = fitMaterial({
      oldSurface,
      newSurface,
      oldLayers: zero,
      newLayers: layers,
      grid: grid(),
      sigma: 22,
    })
    expect(Math.abs(fit.t1 - trueMaterial.t1) / trueMaterial.t1).toBeLessThan(0.05)
    expect(Math.abs(fit.ts - trueMaterial.ts) / trueMaterial.ts).toBeLessThan(0.05)
    expect(fit.noise).toBeGreaterThan(0)
  })

  it('ignores a global shift between the two meshes', () => {
    const layers = layerPattern()
    const oldSurface = createSurface(flatMesh(0))
    const zero = Array.from({ length: 10 }, () => new Array<number>(10).fill(0))
    const clean = meshFromField(layers, 22, 0.12)
    const newSurface = createSurface(clean)
    const fit = fitMaterial({
      oldSurface,
      newSurface,
      oldLayers: zero,
      newLayers: layers,
      grid: grid(),
      sigma: 22,
    })
    expect(fit.t1).toBeCloseTo(trueMaterial.t1, 2)
    expect(fit.ts).toBeCloseTo(trueMaterial.ts, 2)
  })

  it('refuses to fit when no cell changed layers', () => {
    const layers = layerPattern()
    const surface = createSurface(flatMesh(0))
    const fit = fitMaterial({
      oldSurface: surface,
      newSurface: surface,
      oldLayers: layers,
      newLayers: layers,
      grid: grid(),
      sigma: 22,
    })
    expect(fit.warnings.map((warning) => warning.code)).toContain('calibrate.error.noChanges')
    expect(fit.conclusive).toBe(false)
  })

  it('falls back to one parameter when only the first layer changed', () => {
    const layers = layerPattern().map((row) => row.map((value) => (value > 0 ? 1 : 0)))
    const zero = Array.from({ length: 10 }, () => new Array<number>(10).fill(0))
    const oldSurface = createSurface(flatMesh(0))
    const newSurface = createSurface(meshFromField(layers, 22))
    const fit = fitMaterial({
      oldSurface,
      newSurface,
      oldLayers: zero,
      newLayers: layers,
      grid: grid(),
      sigma: 22,
    })
    expect(fit.singleParameter).toBe(true)
    expect(fit.ts).toBe(fit.t1)
    expect(fit.t1).toBeCloseTo(trueMaterial.t1, 2)
  })
})
