import type { CoreMessage } from './messages'
import type { MeshBounds } from './mesh/types'

export interface Cell {
  /** Stable identity: "A1" is always the same physical cell. */
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
  /**
   * The cell was stretched past the probed rectangle because the plan extends
   * into the margin. Its mean includes extrapolated area.
   */
  stretched: boolean
}

export interface Grid {
  cells: Cell[]
  cols: number
  rows: number
  tapeWidth: number
  /**
   * Y step actually used: the mesh row spacing, capped at one tape width so a
   * coarse mesh cannot produce cells taller than a strip (SPEC §3).
   */
  rowSpacing: number
  meshBounds: MeshBounds
  plate: { w: number; h: number }
  /** Cells were extended into the margin up to the plate edges. */
  extendToPlate: boolean
  warnings: CoreMessage[]
}

export interface GridOptions {
  plate: { w: number; h: number }
  meshBounds: MeshBounds
  tapeWidth: number
  meshXCount: number
  meshYCount: number
  /**
   * Stretch the outer row and column of the grid into the margin toward the
   * plate edges instead of adding extra margin cells. Keeps the base cell ids
   * and avoids 2–15 mm slivers.
   */
  extendToPlate?: boolean
}

/**
 * Solid band left at the plate edge when the plan is extended. The printable
 * lattice needs it for the row/column labels: with cells reaching the very edge
 * there is no material left to cut numbers and letters into.
 */
export const EXTEND_LABEL_BORDER = 6

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
 * A plate must contain the probed rectangle: a mesh cannot be taken outside the
 * physical plate. Returns a plate that is at least as large as the mesh, so the
 * plan never clips the measured area.
 */
export function fitPlateToMesh(
  plate: { w: number; h: number },
  bounds: MeshBounds,
): { w: number; h: number } {
  return {
    w: Math.max(plate.w, Math.ceil(bounds.maxX)),
    h: Math.max(plate.h, Math.ceil(bounds.maxY)),
  }
}

/**
 * Cells come from the tape, not from the mesh: X step is the tape width, Y step
 * is the mesh row spacing. This is the single source of truth for the planner,
 * the STL and the SVG (SPEC §3).
 */
export function buildGrid(options: GridOptions): Grid {
  const { plate, meshBounds, tapeWidth, meshXCount, meshYCount, extendToPlate = false } = options
  if (!(tapeWidth > 0)) throw new RangeError('tapeWidth must be > 0')
  const spanX = meshBounds.maxX - meshBounds.minX
  const spanY = meshBounds.maxY - meshBounds.minY
  if (!(spanX > 0) || !(spanY > 0)) throw new RangeError('meshBounds must be non-empty')

  const meshRowSpacing = meshYCount > 1 ? spanY / (meshYCount - 1) : spanY
  // A cell must be coverable by one strip across its short side. Probe rows
  // coarser than the roll (e.g. 8 probes over 215 mm = 30.7 mm) fall back to
  // tape-width rows so the cut list stays 20 mm strips instead of splitting
  // every row into two fractional ones; the surface is interpolated either way.
  const rowSpacing = Math.min(meshRowSpacing, tapeWidth)
  const baseCols = Math.max(1, Math.ceil(spanX / tapeWidth - 1e-9))
  const baseRows = Math.max(1, Math.ceil(spanY / rowSpacing - 1e-9))

  const baseX1 = meshBounds.minX + baseCols * tapeWidth
  const baseY1 = meshBounds.minY + baseRows * rowSpacing

  // The probed grid stays as it is; extension only moves its outer boundary to
  // the label border. The edge cells become rectangles, the cell ids and the
  // layer matrix dimensions do not change.
  const planX0 = extendToPlate ? Math.min(EXTEND_LABEL_BORDER, meshBounds.minX) : meshBounds.minX
  const planX1 = extendToPlate ? Math.max(plate.w - EXTEND_LABEL_BORDER, baseX1) : baseX1
  const planY0 = extendToPlate ? Math.min(EXTEND_LABEL_BORDER, meshBounds.minY) : meshBounds.minY
  const planY1 = extendToPlate ? Math.max(plate.h - EXTEND_LABEL_BORDER, baseY1) : baseY1

  const xBreaks: number[] = [planX0]
  for (let col = 1; col < baseCols; col++) xBreaks.push(meshBounds.minX + col * tapeWidth)
  xBreaks.push(planX1)
  const yBreaks: number[] = [planY0]
  for (let row = 1; row < baseRows; row++) yBreaks.push(meshBounds.minY + row * rowSpacing)
  yBreaks.push(planY1)

  const cols = Math.max(1, xBreaks.length - 1)
  const rows = Math.max(1, yBreaks.length - 1)

  const cells: Cell[] = []
  let partial = 0
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const rawX0 = xBreaks[col]!
      const rawX1 = xBreaks[col + 1]!
      const rawY0 = yBreaks[row]!
      const rawY1 = yBreaks[row + 1]!
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
      const stretched =
        extendToPlate &&
        (rawX0 < meshBounds.minX - 1e-9 ||
          rawX1 > meshBounds.maxX + 1e-9 ||
          rawY0 < meshBounds.minY - 1e-9 ||
          rawY1 > meshBounds.maxY + 1e-9)
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
        stretched,
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

  return { cells, cols, rows, tapeWidth, rowSpacing, meshBounds, plate, extendToPlate, warnings }
}
