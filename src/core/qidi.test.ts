import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildGrid } from './grid'
import type { Material } from './material'
import { createSurface } from './mesh/interpolate'
import { parseMesh } from './mesh/parse'
import { plan } from './plan'
import { buildStrips } from './strips'

/**
 * Owner's Qidi Q1 Pro map: 8×8 probes over 210 × 214.97 mm on a 250 × 250 mm
 * plate. Probe rows are ~30.7 mm apart, wider than the 20 mm tape, which used
 * to split every row into two 15.355 mm strips. The plan must stay on 20 mm
 * cells and produce a cut list with whole-millimetre dimensions (SPEC §3).
 */
const material: Material = { nominal: 0.05, t1: 0.03, ts: 0.03, calibrated: true }
const text = readFileSync(new URL('../../fixtures/qidi-q1pro-mesh.cfg', import.meta.url), 'utf8')

function qidi() {
  const { mesh } = parseMesh(text)
  const grid = buildGrid({
    plate: { w: 250, h: 250 },
    meshBounds: mesh.bounds!,
    tapeWidth: 20,
    meshXCount: mesh.xCount,
    meshYCount: mesh.yCount,
  })
  const result = plan({
    surface: createSurface(mesh),
    grid,
    material,
    referencePercentile: 0.85,
    rounding: 'round',
  })
  return { mesh, grid, result }
}

describe('Qidi Q1 Pro mesh', () => {
  it('parses as 8×8 probes over 210 × 214.97 mm', () => {
    const { mesh } = qidi()
    expect(mesh.xCount).toBe(8)
    expect(mesh.yCount).toBe(8)
    expect(mesh.bounds).toEqual({ minX: 20, maxX: 230, minY: 15, maxY: 229.97 })
  })

  it('uses 20 mm rows instead of one cell per coarse probe row', () => {
    const { grid } = qidi()
    // X: 210 mm / 20 mm → 11 columns. Y: coarse probe rows capped at the tape.
    expect(grid.cols).toBe(11)
    expect(grid.rows).toBe(11)
    expect(grid.rowSpacing).toBe(20)
    for (const cell of grid.cells) {
      expect(cell.x1 - cell.x0).toBeCloseTo(20, 9)
      expect(cell.y1 - cell.y0).toBeCloseTo(20, 9)
    }
    expect(grid.cells[0]).toMatchObject({ id: 'A1', x0: 20, x1: 40, y0: 15, y1: 35 })
    expect(grid.cells[grid.cells.length - 1]).toMatchObject({ id: 'K11', x0: 220, x1: 240, y0: 215, y1: 235 })
    // The grid stays inside the 250 mm plate.
    expect(grid.cells[grid.cells.length - 1]!.x1).toBeLessThanOrEqual(250)
    expect(grid.cells[grid.cells.length - 1]!.y1).toBeLessThanOrEqual(250)
  })

  it('plans some tape and cuts only 20 mm wide strips', () => {
    const { result } = qidi()
    const strips = buildStrips(result)
    expect(result.stats.totalLayers).toBeGreaterThan(0)
    expect(strips.totalPieces).toBeGreaterThan(0)
    for (const piece of strips.pieces) {
      // Across the run the strip is one tape width, never a 30.71/2 fraction.
      expect(piece.width).toBeCloseTo(20, 9)
      expect(Number.isInteger(piece.length)).toBe(true)
    }
  })

  it('has no floating-point noise in the cut batches', () => {
    const { result } = qidi()
    const strips = buildStrips(result)
    for (const batch of strips.batches) {
      expect(batch.width.toString()).not.toMatch(/\d{6,}/)
      expect(batch.length.toString()).not.toMatch(/\d{6,}/)
      expect(Number.isInteger(batch.width)).toBe(true)
      expect(Number.isInteger(batch.length)).toBe(true)
    }
  })
})
