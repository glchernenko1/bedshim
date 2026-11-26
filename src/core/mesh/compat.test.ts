import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { meshMismatches, sameBounds, type ComparableMesh } from './compat'
import { parseMesh } from './parse'
import type { MeshBounds } from './types'

const BOUNDS: MeshBounds = { minX: 20, maxX: 230, minY: 15, maxY: 229.97 }

function mesh(patch: Partial<ComparableMesh> = {}): ComparableMesh {
  return { xCount: 8, yCount: 8, bounds: BOUNDS, algo: 'bicubic', ...patch }
}

function stored(label: string, value: ComparableMesh = mesh()) {
  return { label, mesh: value }
}

function fixture(name: string): string {
  return readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), 'utf8')
}

describe('sameBounds', () => {
  it('accepts identical bounds', () => {
    expect(sameBounds(BOUNDS, { ...BOUNDS })).toBe(true)
  })

  it('ignores differences below the tolerance (text formatting only)', () => {
    expect(sameBounds(BOUNDS, { ...BOUNDS, maxY: BOUNDS.maxY + 1e-7 })).toBe(true)
  })

  it('rejects a real difference on any edge', () => {
    for (const key of ['minX', 'maxX', 'minY', 'maxY'] as const) {
      expect(sameBounds(BOUNDS, { ...BOUNDS, [key]: BOUNDS[key] + 0.01 }), key).toBe(false)
    }
  })
})

describe('meshMismatches', () => {
  it('accepts a mesh with the same grid, bounds and algo', () => {
    expect(meshMismatches(mesh(), [stored('M1')])).toEqual([])
  })

  it('reports a probe-count change with both grids', () => {
    const differences = meshMismatches(mesh({ xCount: 11, yCount: 11 }), [stored('M1')])
    expect(differences).toEqual([
      {
        field: 'grid',
        label: 'M1',
        stored: { x: 8, y: 8 },
        incoming: { x: 11, y: 11 },
      },
    ])
  })

  it('reports a bounds change with both areas', () => {
    const moved: MeshBounds = { minX: 25, maxX: 230, minY: 15, maxY: 229.97 }
    const differences = meshMismatches(mesh({ bounds: moved }), [stored('M1')])
    expect(differences).toEqual([
      { field: 'bounds', label: 'M1', stored: BOUNDS, incoming: moved },
    ])
  })

  it('reports an algorithm change', () => {
    const differences = meshMismatches(mesh({ algo: 'lagrange' }), [stored('M1')])
    expect(differences).toEqual([
      { field: 'algo', label: 'M1', stored: 'bicubic', incoming: 'lagrange' },
    ])
  })

  it('lists every differing field once, in grid → bounds → algo order', () => {
    const moved: MeshBounds = { minX: 10, maxX: 210, minY: 21, maxY: 211 }
    const differences = meshMismatches(mesh({ xCount: 11, bounds: moved, algo: 'lagrange' }), [
      stored('M1'),
    ])
    expect(differences.map((difference) => difference.field)).toEqual(['grid', 'bounds', 'algo'])
  })

  it('names the first stored measurement that differs in each field', () => {
    const differences = meshMismatches(mesh({ xCount: 11, yCount: 11 }), [
      stored('M1'),
      stored('M2', mesh({ xCount: 11, yCount: 11, algo: 'lagrange' })),
    ])
    expect(differences).toEqual([
      {
        field: 'grid',
        label: 'M1',
        stored: { x: 8, y: 8 },
        incoming: { x: 11, y: 11 },
      },
      { field: 'algo', label: 'M2', stored: 'lagrange', incoming: 'bicubic' },
    ])
  })

  it('accepts a probe count that only differs below the tolerance', () => {
    // Counts are integers: a difference of one is always a mismatch, never noise.
    expect(meshMismatches(mesh({ xCount: 9 }), [stored('M1')])).toHaveLength(1)
    expect(
      meshMismatches(mesh({ bounds: { ...BOUNDS, maxY: BOUNDS.maxY + 1e-7 } }), [stored('M1')]),
    ).toEqual([])
  })

  it('skips bounds when either mesh has none (bare-number shape)', () => {
    expect(meshMismatches(mesh({ bounds: null }), [stored('M1')])).toEqual([])
    expect(meshMismatches(mesh(), [stored('M1', mesh({ bounds: null }))])).toEqual([])
    // A null bounds mesh still has to match the grid.
    expect(meshMismatches(mesh({ bounds: null, xCount: 11 }), [stored('M1')])).toHaveLength(1)
  })

  it('handles an empty history: the first mesh is always accepted', () => {
    expect(meshMismatches(mesh({ xCount: 11, algo: 'lagrange' }), [])).toEqual([])
  })

  it('separates the 8×8 Qidi mesh from the 11×11 Neptune mesh', () => {
    const qidi = parseMesh(fixture('qidi-q1pro-mesh.cfg')).mesh
    const neptune = parseMesh(fixture('neptune4-mesh.cfg')).mesh
    const differences = meshMismatches(neptune, [{ label: 'M1', mesh: qidi }])
    expect(differences.map((difference) => difference.field)).toEqual(['grid', 'bounds'])
  })
})
