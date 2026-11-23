import type { CoreMessage } from './messages'
import type { MeshBounds } from './mesh/types'

export type GridView = 'top' | 'bottom'

export interface Cell {
  /** Stable identity across views: "A1" is the same physical cell in both. */
  id: string
  label: string
  /** 0-based, 0 = left (min_x). */
  col: number
  /** 0-based, 0 = front (min_y). */
  row: number
  x0: number
  x1: number
  y0: number
  y1: number
  /** Cell centre lies outside the probed mesh: its value is extrapolation. */
  unprobed: boolean
  /** Clipped by the plate edge, so it cannot be covered by one full-width strip. */
  partial: boolean
}

export interface Grid {
  cells: Cell[]
  cols: number
  rows: number
  view: GridView
  tapeWidth: number
  /** Y step = mesh row spacing, so rows land on probe rows (SPEC §3). */
  rowSpacing: number
  meshBounds: MeshBounds
  plate: { w: number; h: number }
  warnings: CoreMessage[]
}

export interface GridOptions {
  plate: { w: number; h: number }
  meshBounds: MeshBounds
  tapeWidth: number
  view: GridView
  meshXCount: number
  meshYCount: number
}

/** 0 → A, 25 → Z, 26 → AA (SPEC §3 letters rows front→back). */
export function rowLabel(index: number): string {
  let value = Math.max(0, Math.floor(index))
  let label = ''
  for (;;) {
    label = String.fromCharCode(65 + (value % 26)) + label
    value = Math.floor(value / 26) - 1
    if (value < 0) break
  }
  return label
}

/**
 * Cells come from the tape, not from the mesh: X step is the tape width, Y step
 * is the mesh row spacing. This is the single source of truth for the planner,
 * the STL and the SVG (SPEC §3).
 */
export function buildGrid(options: GridOptions): Grid {
  const { plate, meshBounds, tapeWidth, view, meshXCount, meshYCount } = options
  if (!(tapeWidth > 0)) throw new RangeError('tapeWidth must be > 0')
  const spanX = meshBounds.maxX - meshBounds.minX
  const spanY = meshBounds.maxY - meshBounds.minY
  if (!(spanX > 0) || !(spanY > 0)) throw new RangeError('meshBounds must be non-empty')

  const rowSpacing = meshYCount > 1 ? spanY / (meshYCount - 1) : spanY
  const cols = Math.max(1, Math.ceil(spanX / tapeWidth - 1e-9))
  const rows = Math.max(1, Math.ceil(spanY / rowSpacing - 1e-9))

  const cells: Cell[] = []
  let partial = 0
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const rawX0 = meshBounds.minX + col * tapeWidth
      const rawX1 = rawX0 + tapeWidth
      const rawY0 = meshBounds.minY + row * rowSpacing
      const rawY1 = rawY0 + rowSpacing
      const x0 = Math.max(0, Math.min(rawX0, plate.w))
      const x1 = Math.max(0, Math.min(rawX1, plate.w))
      const y0 = Math.max(0, Math.min(rawY0, plate.h))
      const y1 = Math.max(0, Math.min(rawY1, plate.h))
      const clipped = x0 !== rawX0 || x1 !== rawX1 || y0 !== rawY0 || y1 !== rawY1
      if (clipped) partial++
      const centreX = (rawX0 + rawX1) / 2
      const centreY = (rawY0 + rawY1) / 2
      const unprobed =
        centreX < meshBounds.minX ||
        centreX > meshBounds.maxX ||
        centreY < meshBounds.minY ||
        centreY > meshBounds.maxY
      const label = `${rowLabel(row)}${col + 1}`
      cells.push({
        id: label,
        label,
        col,
        row,
        x0,
        x1,
        y0,
        y1,
        unprobed,
        partial: clipped,
      })
    }
  }

  const warnings: CoreMessage[] = []
  const spacingX = meshXCount > 1 ? spanX / (meshXCount - 1) : spanX
  if (tapeWidth < 0.6 * spacingX) {
    warnings.push({ code: 'grid.warn.fineCells', params: { tape: tapeWidth, spacing: Number(spacingX.toFixed(1)) } })
  }
  if (tapeWidth > 2.5 * spacingX) {
    warnings.push({ code: 'grid.warn.coarseCells', params: { tape: tapeWidth, spacing: Number(spacingX.toFixed(1)) } })
  }
  // Only warn when the grid actually reaches the plate edge: a plate width that
  // is not a multiple of the tape is harmless while the mesh keeps cells away
  // from the edge.
  if (partial > 0 && plate.w % tapeWidth !== 0) {
    warnings.push({
      code: 'grid.warn.partialCells',
      params: { count: partial, width: plate.w, tape: tapeWidth },
    })
  }

  return { cells, cols, rows, view, tapeWidth, rowSpacing, meshBounds, plate, warnings }
}

/**
 * Where a cell sits on the plan sheet. `top` keeps plate coordinates; `bottom`
 * mirrors X, because the plate is flipped to apply tape (SPEC §2.2). The id
 * travels with the cell, so the label still names the same physical cell.
 */
export function displayRect(
  cell: Pick<Cell, 'x0' | 'x1' | 'y0' | 'y1'>,
  grid: Pick<Grid, 'view' | 'plate'>,
): { x0: number; x1: number; y0: number; y1: number } {
  if (grid.view === 'top') return { x0: cell.x0, x1: cell.x1, y0: cell.y0, y1: cell.y1 }
  return { x0: grid.plate.w - cell.x1, x1: grid.plate.w - cell.x0, y0: cell.y0, y1: cell.y1 }
}
