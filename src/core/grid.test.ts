import { describe, expect, it } from 'vitest'
import { buildGrid, rowLabel } from './grid'

const bounds = { minX: 10, maxX: 210, minY: 21, maxY: 211 }

function fixtureGrid(overrides: Partial<Parameters<typeof buildGrid>[0]> = {}) {
  return buildGrid({
    plate: { w: 235, h: 235 },
    meshBounds: bounds,
    tapeWidth: 20,
    meshXCount: 11,
    meshYCount: 11,
    ...overrides,
  })
}

describe('buildGrid', () => {
  it('builds 10×10 tape cells for the fixture (SPEC §13 P2)', () => {
    const grid = fixtureGrid()
    expect(grid.cols).toBe(10)
    expect(grid.rows).toBe(10)
    expect(grid.rowSpacing).toBeCloseTo(19, 12)
    expect(grid.cells).toHaveLength(100)
    expect(grid.cells[0]!.id).toBe('A1')
    expect(grid.cells[99]!.id).toBe('J10')
    expect(grid.cells[0]).toMatchObject({ x0: 10, x1: 30, y0: 21, y1: 40 })
    expect(grid.cells[9]).toMatchObject({ x0: 190, x1: 210 })
    expect(grid.cells.filter((cell) => cell.unprobed)).toHaveLength(0)
    expect(grid.cells.filter((cell) => cell.partial)).toHaveLength(0)
    expect(grid.cells[0]!.unprobed).toBe(false)
    expect(grid.cells[0]!.partial).toBe(false)
  })

  it('numbers columns left→right and rows front→back', () => {
    const grid = fixtureGrid()
    expect(grid.cells[0]!.col).toBe(0)
    expect(grid.cells[0]!.row).toBe(0)
    expect(grid.cells[1]!.id).toBe('A2')
    expect(grid.cells[10]!.id).toBe('B1')
    expect(grid.cells[19]!.id).toBe('B10')
    expect(grid.cells[99]!.row).toBe(9)
  })

  it('takes the row height from the mesh, not from the tape', () => {
    const grid = fixtureGrid({ tapeWidth: 25 })
    expect(grid.rowSpacing).toBeCloseTo(19, 12)
    expect(grid.cols).toBe(8)
    expect(grid.rows).toBe(10)
  })

  it('flags cells whose centre falls outside the mesh as unprobed', () => {
    const grid = fixtureGrid({ tapeWidth: 15 })
    expect(grid.cols).toBe(14)
    expect(grid.cells[13]!.unprobed).toBe(true)
    expect(grid.cells[12]!.unprobed).toBe(false)
  })

  it('clips at the plate edge and flags partial cells', () => {
    const grid = fixtureGrid({ plate: { w: 215, h: 235 }, meshBounds: { minX: 0, maxX: 215, minY: 0, maxY: 190 } })
    const last = grid.cells[grid.cols - 1]!
    expect(last.partial).toBe(true)
    expect(last.x1).toBe(215)
    expect(grid.cells[0]!.partial).toBe(false)
  })

  it('warns when the tape is much finer or coarser than the mesh', () => {
    expect(fixtureGrid({ tapeWidth: 5 }).warnings.map((w) => w.code)).toContain('grid.warn.fineCells')
    expect(fixtureGrid({ tapeWidth: 60 }).warnings.map((w) => w.code)).toContain('grid.warn.coarseCells')
    const clipped = fixtureGrid({
      plate: { w: 215, h: 235 },
      meshBounds: { minX: 0, maxX: 215, minY: 0, maxY: 190 },
    })
    expect(clipped.warnings.map((w) => w.code)).toContain('grid.warn.partialCells')
  })

  it('letters rows beyond Z with double letters', () => {
    expect(rowLabel(0)).toBe('A')
    expect(rowLabel(25)).toBe('Z')
    expect(rowLabel(26)).toBe('AA')
    expect(rowLabel(27)).toBe('AB')
  })

  it('rejects a non-positive tape width', () => {
    expect(() => fixtureGrid({ tapeWidth: 0 })).toThrowError(RangeError)
  })

  it('stretches the outer cells into the margin instead of adding slivers', () => {
    const grid = fixtureGrid({ extendToPlate: true })
    // The probed 10×10 grid keeps its ids and matrix shape; only its outer
    // boundary moves to the 6 mm label border.
    expect(grid.cols).toBe(10)
    expect(grid.rows).toBe(10)
    expect(grid.cells).toHaveLength(100)
    expect(grid.cells[0]).toMatchObject({
      id: 'A1',
      x0: 6,
      x1: 30,
      y0: 6,
      y1: 40,
      unprobed: false,
      partial: false,
      stretched: true,
    })
    expect(grid.cells[grid.cells.length - 1]).toMatchObject({
      id: 'J10',
      x0: 190,
      x1: 229,
      y0: 192,
      y1: 229,
      unprobed: false,
      partial: false,
      stretched: true,
    })
    // A cell inside the probed rectangle is untouched.
    expect(grid.cells.find((cell) => cell.id === 'B2')).toMatchObject({
      x0: 30,
      x1: 50,
      y0: 40,
      y1: 59,
      stretched: false,
    })
    expect(grid.cells.filter((cell) => cell.stretched)).toHaveLength(36)
    expect(grid.cells.filter((cell) => cell.partial)).toHaveLength(0)
    expect(grid.extendToPlate).toBe(true)
  })

  it('has no cell smaller than one normal step in extended mode', () => {
    const grid = fixtureGrid({ extendToPlate: true })
    for (const cell of grid.cells) {
      expect(cell.x1 - cell.x0).toBeGreaterThanOrEqual(20 - 1e-9)
      expect(cell.y1 - cell.y0).toBeGreaterThanOrEqual(19 - 1e-9)
    }
  })
})
