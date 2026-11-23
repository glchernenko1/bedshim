import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CoreError } from '../errors'
import { createSurface } from './interpolate'
import { parseMesh } from './parse'
import type { Mesh } from './types'

function fixture(name: string): string {
  return readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), 'utf8')
}

const mesh = parseMesh(fixture('neptune4-mesh.cfg')).mesh
const surface = createSurface(mesh)

// Reference values computed by an independent Python implementation of Klipper's
// ZMesh._sample_bicubic + calc_z (klippy/extras/bed_mesh.py) on the same fixture.
const REFERENCE: ReadonlyArray<readonly [number, number, number]> = [
  [10, 21, 0.09],
  [110, 116, 0.015],
  [37.5, 88.2, 0.040875710653],
  [205, 60, 0.061910784421],
  [230, 230, 0.0275],
]

function node(mesh: Mesh, row: number, col: number): { x: number; y: number } {
  const bounds = mesh.bounds!
  return {
    x: bounds.minX + ((bounds.maxX - bounds.minX) * col) / (mesh.xCount - 1),
    y: bounds.minY + ((bounds.maxY - bounds.minY) * row) / (mesh.yCount - 1),
  }
}

describe('createSurface — bicubic', () => {
  it('samples into a mesh_pps grid, like Klipper', () => {
    expect(surface.algo).toBe('bicubic')
    expect(surface.sampledX).toBe(51)
    expect(surface.sampledY).toBe(51)
  })

  it('reproduces the probe nodes exactly', () => {
    for (let row = 0; row < mesh.yCount; row++) {
      for (let col = 0; col < mesh.xCount; col++) {
        const { x, y } = node(mesh, row, col)
        expect(surface.at(x, y)).toBeCloseTo(mesh.points[row]![col]!, 12)
      }
    }
  })

  it('matches the independent Klipper reference at five sample points', () => {
    for (const [x, y, expected] of REFERENCE) {
      expect(surface.at(x, y), `at(${x}, ${y})`).toBeCloseTo(expected, 9)
    }
  })

  it('matches the reference sampled grid', () => {
    expect(surface.sampled[0]?.[0]).toBeCloseTo(0.09, 12)
    expect(surface.sampled[25]?.[25]).toBeCloseTo(0.015, 12)
    expect(surface.sampled[7]?.[13]).toBeCloseTo(0.0203712064, 10)
    expect(surface.sampled[13]?.[7]).toBeCloseTo(0.058691296, 12)
    expect(surface.sampled[50]?.[50]).toBeCloseTo(0.0275, 12)
  })

  it('holds the edge value outside the mesh bounds (Klipper clamps)', () => {
    expect(surface.at(-100, -100)).toBeCloseTo(0.09, 12)
    expect(surface.at(1e6, 1e6)).toBeCloseTo(0.0275, 12)
    expect(surface.at(-5, 116)).toBeCloseTo(surface.at(10, 116), 12)
  })

  it('does not mutate the parsed mesh', () => {
    const before = JSON.stringify(mesh.points)
    createSurface(mesh)
    expect(JSON.stringify(mesh.points)).toBe(before)
  })
})

describe('createSurface — other algorithms', () => {
  const plane: Mesh = {
    name: 'plane',
    version: 1,
    xCount: 3,
    yCount: 3,
    points: [
      [0, 10, 20],
      [20, 30, 40],
      [40, 50, 60],
    ],
    bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
    algo: 'bilinear',
    tension: 0.2,
    meshXPps: 2,
    meshYPps: 2,
    source: 'block',
    inferred: { counts: false, bounds: false, algo: false, tension: false, pps: false },
    ignoredKeys: [],
    notices: [],
  }

  it('is exact on a plane with bilinear', () => {
    const flat = createSurface(plane)
    expect(flat.algo).toBe('bilinear')
    expect(flat.at(50, 50)).toBeCloseTo(30, 12)
    expect(flat.at(33, 77)).toBeCloseTo(0.2 * 33 + 0.4 * 77, 12)
  })

  it('approximates lagrange and direct with bicubic and says so', () => {
    for (const algo of ['lagrange', 'direct'] as const) {
      const approximated = createSurface({ ...mesh, algo })
      expect(approximated.algo).toBe('bicubic')
      expect(approximated.notices.map((notice) => notice.code)).toContain('surface.notice.algoApproximated')
      expect(approximated.at(37.5, 88.2)).toBeCloseTo(surface.at(37.5, 88.2), 12)
    }
  })

  it('falls back to bilinear below three nodes on an axis', () => {
    const coarse: Mesh = { ...plane, algo: 'bicubic', xCount: 2, yCount: 2, points: [[0, 10], [20, 30]] }
    const fallback = createSurface(coarse)
    expect(fallback.algo).toBe('bilinear')
    expect(fallback.notices.map((notice) => notice.code)).toContain('surface.notice.bilinearFallback')
  })

  it('refuses to build a surface without bounds', () => {
    expect(() => createSurface({ ...plane, bounds: null })).toThrowError(CoreError)
    try {
      createSurface({ ...plane, bounds: null })
    } catch (error) {
      expect((error as CoreError).code).toBe('surface.error.noBounds')
    }
  })
})
