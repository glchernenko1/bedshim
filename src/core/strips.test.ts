import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildGrid } from './grid'
import type { Material } from './material'
import { createSurface } from './mesh/interpolate'
import { parseMesh } from './mesh/parse'
import { plan } from './plan'
import { batchCut, buildStrips, type StripPiece } from './strips'

const material: Material = { nominal: 0.05, t1: 0.03, ts: 0.03, calibrated: true }
const fixture = readFileSync(new URL('../../fixtures/neptune4-mesh.cfg', import.meta.url), 'utf8')

function fixturePlan() {
  const { mesh } = parseMesh(fixture)
  const grid = buildGrid({
    plate: { w: 235, h: 235 },
    meshBounds: mesh.bounds!,
    tapeWidth: 20,
    meshXCount: mesh.xCount,
    meshYCount: mesh.yCount,
  })
  return plan({
    surface: createSurface(mesh),
    grid,
    material,
    referencePercentile: 0.85,
    rounding: 'round',
  })
}

describe('buildStrips — Appendix A', () => {
  const strips = buildStrips(fixturePlan())

  it('matches the golden piece count and tape length', () => {
    expect(strips.totalPieces).toBe(22)
    expect(strips.totalLengthMM).toBe(2240)
    expect(strips.levels).toBe(3)
  })

  it('splits runs per level exactly as the cut list in the spec', () => {
    const rowA = strips.pieces.filter((piece) => piece.orient === 'row' && piece.line === 0)
    expect(rowA.map((piece) => [piece.level, piece.label, piece.length])).toEqual([
      [1, 'A3–A9', 140],
      [2, 'A4–A8', 100],
      [3, 'A7', 20],
    ])
    const rowB = strips.pieces.filter((piece) => piece.orient === 'row' && piece.line === 1)
    expect(rowB.map((piece) => [piece.level, piece.label, piece.length])).toEqual([
      [1, 'B3–B9', 140],
      [2, 'B6–B8', 60],
    ])
  })

  it('batches identical pieces and keeps every piece accounted for', () => {
    const byBatch = strips.batches.reduce((sum, batch) => sum + batch.count, 0)
    expect(byBatch).toBe(strips.totalPieces)
    for (const batch of strips.batches) {
      expect(batch.pieces).toHaveLength(batch.count)
      expect(batch.count).toBeGreaterThan(0)
    }
    // Longest strips first inside a level.
    const levels = [...new Set(strips.batches.map((batch) => batch.level))]
    for (const level of levels) {
      const lengths = strips.batches.filter((batch) => batch.level === level).map((batch) => batch.length)
      expect(lengths).toEqual([...lengths].sort((a, b) => b - a))
    }
  })
})

describe('batchCut', () => {
  const piece = (level: number, length: number, label: string): StripPiece => ({
    level,
    orient: 'row',
    line: 0,
    from: 0,
    to: length / 20 - 1,
    width: 20,
    length,
    label,
    cells: [label],
    partial: false,
    acrossIndex: 1,
    acrossCount: 1,
  })

  it('groups equal dimensions and accumulates counts', () => {
    const batches = batchCut([piece(1, 60, 'A1–A3'), piece(1, 40, 'B1–B2'), piece(1, 60, 'C1–C3')])
    expect(batches).toEqual([
      { level: 1, width: 20, length: 60, count: 2, pieces: ['A1–A3', 'C1–C3'] },
      { level: 1, width: 20, length: 40, count: 1, pieces: ['B1–B2'] },
    ])
  })

  it('puts lower levels first and longer pieces first within a level', () => {
    const batches = batchCut([piece(2, 20, 'A1'), piece(1, 20, 'A1'), piece(1, 60, 'A1')])
    expect(batches.map((batch) => [batch.level, batch.length])).toEqual([
      [1, 60],
      [1, 20],
      [2, 20],
    ])
  })
})

describe('buildStrips — empty plan', () => {
  it('returns no pieces when the bed needs no tape', () => {
    const { mesh } = parseMesh(fixture)
    const grid = buildGrid({
      plate: { w: 235, h: 235 },
      meshBounds: mesh.bounds!,
      tapeWidth: 20,
      meshXCount: mesh.xCount,
      meshYCount: mesh.yCount,
    })
    const empty = plan({
      surface: createSurface(mesh),
      grid,
      material,
      referencePercentile: 0.95,
      rounding: 'round',
    })
    // Force the matrix empty: the test is about the strip layer, not the corner case above.
    const strips = buildStrips({ ...empty, layers: empty.layers.map((row) => row.map(() => 0)) })
    expect(strips.pieces).toEqual([])
    expect(strips.batches).toEqual([])
    expect(strips.levels).toBe(0)
    expect(strips.totalLengthMM).toBe(0)
  })
})
