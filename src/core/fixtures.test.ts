import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fitMaterial } from './calibrate'
import { buildGrid } from './grid'
import { DEFAULT_MATERIAL, type Material } from './material'
import { createSurface } from './mesh/interpolate'
import { parseMesh } from './mesh/parse'
import type { Mesh } from './mesh/types'
import { plan } from './plan'

const TRUE_TS = 0.04
const TRUE: Material = { nominal: 0.05, t1: 0.025, ts: TRUE_TS, calibrated: true }

function read(name: string): string {
  return readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8')
}

function gridFor(mesh: Mesh) {
  return buildGrid({
    plate: { w: 235, h: 235 },
    meshBounds: mesh.bounds!,
    tapeWidth: 20,
    meshXCount: mesh.xCount,
    meshYCount: mesh.yCount,
  })
}

/**
 * The two synthetic "after taping" files are generated with known material
 * (t1 = 0.025, ts = 0.040) and documented settings; this test keeps them honest.
 */
describe('test measurements (fixtures/test-after-pass*.cfg)', () => {
  const { mesh: m1 } = parseMesh(read('neptune4-mesh.cfg'))
  const { mesh: m2 } = parseMesh(read('test-after-pass1.cfg'))
  const { mesh: m3 } = parseMesh(read('test-after-pass2.cfg'))
  const grid = gridFor(m1)
  const zero = Array.from({ length: grid.rows }, () => new Array<number>(grid.cols).fill(0))

  const p1 = plan({
    surface: createSurface(m1),
    grid,
    material: DEFAULT_MATERIAL,
    referencePercentile: 0.85,
    rounding: 'floor',
    baseLayers: zero,
  })

  it('parses as the same 11×11 mesh with the same geometry', () => {
    for (const mesh of [m2, m3]) {
      expect(mesh.xCount).toBe(11)
      expect(mesh.yCount).toBe(11)
      expect(mesh.bounds).toEqual(m1.bounds)
    }
  })

  it('pass 1 recovers t1 and ts from the difference', () => {
    const fit = fitMaterial({
      oldSurface: createSurface(m1),
      newSurface: createSurface(m2),
      oldLayers: zero,
      newLayers: p1.layers,
      grid,
    })
    expect(fit.t1).toBeCloseTo(TRUE.t1, 3)
    expect(fit.ts).toBeCloseTo(TRUE_TS, 3)
    expect(fit.r2).toBeGreaterThan(0.99)
  })

  it('pass 2 recovers ts with t1 taken from the material', () => {
    const p2 = plan({
      surface: createSurface(m2),
      grid,
      material: TRUE,
      referencePercentile: 0.85,
      rounding: 'floor',
      baseLayers: p1.layers,
    })
    let changes = 0
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        if ((p1.layers[row]?.[col] ?? 0) !== (p2.layers[row]?.[col] ?? 0)) changes++
      }
    }
    expect(changes).toBe(5)

    const fit = fitMaterial({
      oldSurface: createSurface(m2),
      newSurface: createSurface(m3),
      oldLayers: p1.layers,
      newLayers: p2.layers,
      grid,
      fixedT1: TRUE.t1,
    })
    expect(fit.t1).toBeCloseTo(TRUE.t1, 3)
    expect(fit.ts).toBeCloseTo(TRUE_TS, 3)
    expect(fit.r2).toBeGreaterThan(0.99)
  })
})
