import type { CoreMessage } from './messages'
import type { Plan } from './plan'

export interface StripPiece {
  /** Tape level, 1 = first layer on the bed. */
  level: number
  /** Grid row, 0 = front. */
  row: number
  /** First and last column of the run, inclusive. */
  c0: number
  c1: number
  /** Tape width across the row, mm. */
  width: number
  /** Cut length along the row, mm. */
  length: number
  /** Run label, e.g. "A3–A9" or "A7". */
  label: string
  /** Every cell id in the run. */
  cells: string[]
  /** At least one cell in the run is clipped by the plate edge. */
  partial: boolean
}

export interface CutBatch {
  level: number
  width: number
  length: number
  count: number
  /** Run labels in placement order. */
  pieces: string[]
}

export interface StripPlan {
  pieces: StripPiece[]
  batches: CutBatch[]
  /** Highest layer count in the plan. */
  levels: number
  totalPieces: number
  totalLengthMM: number
  warnings: CoreMessage[]
}

interface Run {
  row: number
  c0: number
  c1: number
}

/**
 * Turns a layer matrix into cut strips (SPEC §8.1). Rows are independent: a
 * strip is exactly `tapeWidth` across the row, so a level's contiguous run of
 * cells becomes one piece. Levels are nested, so the instruction is simply
 * "level 1 first, then level 2".
 */
export function buildStrips(plan: Plan): StripPlan {
  const { grid, layers } = plan
  const levels = layers.reduce((max, row) => row.reduce((rowMax, value) => Math.max(rowMax, value), max), 0)
  const pieces: StripPiece[] = []
  let totalLengthMM = 0

  for (let level = 1; level <= levels; level++) {
    for (let row = 0; row < grid.rows; row++) {
      let start: number | null = null
      for (let col = 0; col <= grid.cols; col++) {
        const covered = col < grid.cols && (layers[row]?.[col] ?? 0) >= level
        if (covered && start === null) {
          start = col
        } else if (!covered && start !== null) {
          const run: Run = { row, c0: start, c1: col - 1 }
          const first = grid.cells[row * grid.cols + run.c0]
          const last = grid.cells[row * grid.cols + run.c1]
          if (first && last) {
            const count = run.c1 - run.c0 + 1
            const cells = Array.from({ length: count }, (_, offset) => grid.cells[row * grid.cols + run.c0 + offset]!)
            const rowHeight = first.y1 - first.y0
            // A full row is covered by one tape-width strip (20 mm over a 19 mm
            // row). A narrow edge row must be trimmed to its own height.
            const width =
              Math.abs(rowHeight - grid.tapeWidth) <= 1
                ? grid.tapeWidth
                : Math.min(grid.tapeWidth, rowHeight)
            const length = last.x1 - first.x0
            const piece: StripPiece = {
              level,
              row,
              c0: run.c0,
              c1: run.c1,
              width,
              length,
              label: first.label === last.label ? first.label : `${first.label}–${last.label}`,
              cells: cells.map((cell) => cell.label),
              partial: cells.some((cell) => cell.partial),
            }
            pieces.push(piece)
            totalLengthMM += piece.length
          }
          start = null
        }
      }
    }
  }

  const warnings: CoreMessage[] = []
  const partial = pieces.filter((piece) => piece.partial).length
  if (partial > 0) warnings.push({ code: 'strips.warn.partial', params: { count: partial } })

  return {
    pieces,
    batches: batchCut(pieces),
    levels,
    totalPieces: pieces.length,
    totalLengthMM,
    warnings,
  }
}

/**
 * Groups identical pieces so the user cuts a stack at once instead of one
 * strip at a time (SPEC §8.2). Batches keep placement order; dimensions are
 * sorted by level, then longest first.
 */
export function batchCut(pieces: readonly StripPiece[]): CutBatch[] {
  const batches = new Map<string, CutBatch>()
  for (const piece of pieces) {
    const key = `${piece.level}|${piece.width}|${piece.length}`
    const existing = batches.get(key)
    if (existing) {
      existing.count++
      existing.pieces.push(piece.label)
    } else {
      batches.set(key, {
        level: piece.level,
        width: piece.width,
        length: piece.length,
        count: 1,
        pieces: [piece.label],
      })
    }
  }
  return [...batches.values()].sort(
    (a, b) => a.level - b.level || b.length - a.length || a.width - b.width,
  )
}
