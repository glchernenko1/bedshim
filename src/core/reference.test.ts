import { describe, expect, it } from 'vitest'
import {
  firstLayerIdentifiable,
  reserveFirstLayer,
  type ReferenceInputCell,
} from './reference'

function cells(
  planned: number[][],
  base: number[][],
  usable = true,
): ReferenceInputCell[] {
  const rows = planned.length
  const cols = planned[0]?.length ?? 0
  const result: ReferenceInputCell[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      result.push({
        id: `${String.fromCharCode(65 + row)}${col + 1}`,
        row,
        col,
        usable,
        planned: planned[row]![col]!,
        base: base[row]![col]!,
      })
    }
  }
  return result
}

const grid10 = (value: number): number[][] =>
  Array.from({ length: 10 }, () => new Array<number>(10).fill(value))

describe('firstLayerIdentifiable', () => {
  it('accepts a mix of taped and untaped cells', () => {
    const planned = grid10(1)
    planned[0]![0] = 0
    expect(firstLayerIdentifiable(cells(planned, grid10(0)))).toBe(true)
  })

  it('rejects a uniform first layer: it looks like a Z shift', () => {
    expect(firstLayerIdentifiable(cells(grid10(2), grid10(0)))).toBe(false)
    expect(firstLayerIdentifiable(cells(grid10(2), grid10(2)))).toBe(false)
  })

  it('ignores cells outside the probed area', () => {
    const planned = grid10(0)
    planned[0]![0] = 1
    expect(firstLayerIdentifiable(cells(planned, grid10(0), false))).toBe(false)
  })
})

describe('reserveFirstLayer', () => {
  it('fills an existing zero cell first: one added layer, no peel', () => {
    const planned = grid10(1)
    const base = grid10(1)
    planned[5]![5] = 0
    base[5]![5] = 0
    const zone = reserveFirstLayer(cells(planned, base), 10)
    expect(zone).not.toBeNull()
    expect(zone!.zone.zero).toBeNull()
    expect(zone!.zone.first).toEqual(['F6'])
    expect(zone!.zone.add).toBe(1)
    expect(zone!.zone.peel).toBe(0)
    expect(zone!.targets).toEqual([{ row: 5, col: 5, layers: 1, role: 'first' }])
  })

  it('carves a 0/1 witness when every cell is already taped twice', () => {
    const planned = grid10(2)
    const base = grid10(2)
    const zone = reserveFirstLayer(cells(planned, base), 10)
    expect(zone).not.toBeNull()
    expect(zone!.zone.zero).not.toBeNull()
    expect(zone!.zone.first).toHaveLength(4)
    expect(zone!.zone.ramp).toHaveLength(0)
    expect(zone!.zone.cells).toBe(5)
    expect(zone!.zone.peel).toBe(6)
    expect(zone!.targets.find((target) => target.role === 'zero')?.layers).toBe(0)
    expect(
      zone!.targets.filter((target) => target.role === 'first').every((target) => target.layers === 1),
    ).toBe(true)
  })

  it('never leaves a two-layer step at the witness', () => {
    const planned = grid10(4)
    const base = grid10(4)
    const zone = reserveFirstLayer(cells(planned, base), 10)
    expect(zone).not.toBeNull()
    const byKey = new Map(
      cells(planned, base).map((cell) => [`${cell.row}:${cell.col}`, cell]),
    )
    const target = new Map(
      zone!.targets.map((item) => [`${item.row}:${item.col}`, item.layers]),
    )
    for (const item of zone!.targets) {
      for (const [dr, dc] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const) {
        const neighbour = byKey.get(`${item.row + dr}:${item.col + dc}`)
        if (!neighbour) continue
        const value = target.get(`${neighbour.row}:${neighbour.col}`) ?? neighbour.planned
        expect(Math.abs(item.layers - value), `${item.row}:${item.col}`).toBeLessThanOrEqual(1)
      }
    }
  })

  it('prefers a corner where the old stack is thin', () => {
    const planned = grid10(3)
    const base = grid10(3)
    // A cheap 2-layer island in one corner: peeling there costs less.
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) base[row]![col] = 2
    }
    const zone = reserveFirstLayer(cells(planned, base), 10)
    expect(zone).not.toBeNull()
    expect(zone!.zone.peel).toBeLessThan(16)
    expect(zone!.zone.zero).toMatch(/^[AB][12]$/)
  })

  it('leaves a plan that already has first-layer contrast alone', () => {
    const planned = grid10(2)
    planned[0]![0] = 0
    expect(reserveFirstLayer(cells(planned, grid10(0)), 10)).toBeNull()
  })

  it('does not add tape to a plan that needs none', () => {
    expect(reserveFirstLayer(cells(grid10(0), grid10(0)), 10)).toBeNull()
  })

  it('refuses a zone larger than the budget', () => {
    expect(reserveFirstLayer(cells(grid10(8), grid10(8)), 10, { maxCells: 5 })).toBeNull()
  })

  it('never wraps around the row ends', () => {
    const planned = Array.from({ length: 3 }, () => new Array<number>(3).fill(2))
    const base = Array.from({ length: 3 }, () => new Array<number>(3).fill(2))
    const zone = reserveFirstLayer(cells(planned, base), 3)
    expect(zone).not.toBeNull()
    // Only the centre has four real neighbours, so the seed must be there.
    expect(zone!.zone.zero).toBe('B2')
    for (const target of zone!.targets) {
      expect(target.row).toBeGreaterThanOrEqual(0)
      expect(target.row).toBeLessThanOrEqual(2)
      expect(target.col).toBeGreaterThanOrEqual(0)
      expect(target.col).toBeLessThanOrEqual(2)
    }
  })

  it('refuses to ramp into an unprobed cell', () => {
    const planned = Array.from({ length: 9 }, () => new Array<number>(9).fill(4))
    const base = Array.from({ length: 9 }, () => new Array<number>(9).fill(4))
    const all = cells(planned, base)
    for (const cell of all) {
      cell.usable = cell.row >= 1 && cell.row <= 7 && cell.col >= 1 && cell.col <= 7
      if (!cell.usable) cell.planned = 6
    }
    expect(reserveFirstLayer(all, 9)).toBeNull()
  })

  it('keeps a deep witness inside the probed area', () => {
    const planned = Array.from({ length: 9 }, () => new Array<number>(9).fill(4))
    const base = Array.from({ length: 9 }, () => new Array<number>(9).fill(4))
    const all = cells(planned, base)
    for (const cell of all) {
      cell.usable = cell.row >= 1 && cell.row <= 7 && cell.col >= 1 && cell.col <= 7
    }
    const zone = reserveFirstLayer(all, 9)
    expect(zone).not.toBeNull()
    for (const target of zone!.targets) {
      expect(target.row).toBeGreaterThanOrEqual(1)
      expect(target.row).toBeLessThanOrEqual(7)
      expect(target.col).toBeGreaterThanOrEqual(1)
      expect(target.col).toBeLessThanOrEqual(7)
    }
  })

  it('only uses probed, clipped-free cells', () => {
    const planned = grid10(2)
    const base = grid10(2)
    const all = cells(planned, base)
    for (const cell of all) {
      // Mark everything unusable except a 3x3 centre: the witness must fit there.
      cell.usable = cell.row >= 4 && cell.row <= 6 && cell.col >= 4 && cell.col <= 6
    }
    const zone = reserveFirstLayer(all, 10)
    expect(zone).not.toBeNull()
    for (const target of zone!.targets) {
      expect(target.row).toBeGreaterThanOrEqual(4)
      expect(target.row).toBeLessThanOrEqual(6)
      expect(target.col).toBeGreaterThanOrEqual(4)
      expect(target.col).toBeLessThanOrEqual(6)
    }
  })
})
