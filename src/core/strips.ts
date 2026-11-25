import type { CoreMessage } from './messages'
import type { Plan } from './plan'

export interface StripPiece {
  /** Tape level, 1 = first layer on the bed. */
  level: number
  /**
   * A row run lies along X and is `width` tall; a column run lies along Y and
   * is `width` wide. The planner follows the cell side that is one tape width,
   * so `width` stays at the tape width everywhere except the four corner
   * cells, where a stretched row meets a stretched column.
   */
  orient: 'row' | 'column'
  /** Row index for a row run, column index for a column run. */
  line: number
  /** First and last index along the run (columns for a row run, rows for a column run). */
  from: number
  to: number
  /** Tape width across the strip, mm; never wider than the roll. */
  width: number
  /** Cut length along the strip, mm. */
  length: number
  /** Run label, e.g. "A3–A9", "A3–J3" or "A7". */
  label: string
  /** Every cell id in the run. */
  cells: string[]
  /** At least one cell in the run is clipped by the plate edge. */
  partial: boolean
  /** 1-based index when the run is wider than the tape and needs several strips across. */
  acrossIndex: number
  /** Number of strips laid side by side to cover the run width. */
  acrossCount: number
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

/**
 * Turns a layer matrix into cut strips (SPEC §8.1).
 *
 * Without extension every row is about one tape width tall, so a level's
 * contiguous run along the row becomes one piece. The extended grid stretches
 * the outer row and column: a normal column is exactly one tape width wide and
 * is cut front→back (the stretched rows only add length), while the stretched
 * edge column is too wide for the roll, so its cells are cut across their row.
 * A strip is therefore always cut at the tape width except in the four corners,
 * where a stretched row meets a stretched column. Levels are nested, so the
 * instruction is simply "level 1 first, then level 2".
 */
export function buildStrips(plan: Plan): StripPlan {
  const { grid, layers } = plan
  const levels = layers.reduce((max, row) => row.reduce((rowMax, value) => Math.max(rowMax, value), max), 0)
  const pieces: StripPiece[] = []
  let totalLengthMM = 0

  const cellAt = (row: number, col: number) => grid.cells[row * grid.cols + col]
  const stripWidth = (cell: { x0: number; x1: number; y0: number; y1: number }, orient: 'row' | 'column') =>
    orient === 'row' ? cell.y1 - cell.y0 : cell.x1 - cell.x0
  const wideColumn = (col: number) => {
    const cell = cellAt(0, col)
    return cell ? cell.x1 - cell.x0 > grid.tapeWidth + 2 : false
  }
  const covered = (row: number, col: number, level: number) => (layers[row]?.[col] ?? 0) >= level

  interface Run {
    level: number
    orient: 'row' | 'column'
    line: number
    from: number
    to: number
  }
  const runs: Run[] = []

  for (let level = 1; level <= levels; level++) {
    if (!grid.extendToPlate) {
      // A normal grid: every row fits the tape, so each row is independent.
      for (let row = 0; row < grid.rows; row++) {
        let start: number | null = null
        for (let col = 0; col <= grid.cols; col++) {
          const hit = col < grid.cols && covered(row, col, level)
          if (hit && start === null) {
            start = col
          } else if (!hit && start !== null) {
            runs.push({ level, orient: 'row', line: row, from: start, to: col - 1 })
            start = null
          }
        }
      }
      continue
    }

    // Extended grid: a normal column is one tape width, so cut it front→back.
    // The stretched edge column is wider than the roll; those cells are cut
    // across their row instead, where a normal row is one tape width tall.
    for (let col = 0; col < grid.cols; col++) {
      if (wideColumn(col)) continue
      let start: number | null = null
      for (let row = 0; row <= grid.rows; row++) {
        const hit = row < grid.rows && covered(row, col, level)
        if (hit && start === null) {
          start = row
        } else if (!hit && start !== null) {
          runs.push({ level, orient: 'column', line: col, from: start, to: row - 1 })
          start = null
        }
      }
    }
    for (let row = 0; row < grid.rows; row++) {
      let start: number | null = null
      for (let col = 0; col <= grid.cols; col++) {
        const hit = col < grid.cols && wideColumn(col) && covered(row, col, level)
        if (hit && start === null) {
          start = col
        } else if (!hit && start !== null) {
          runs.push({ level, orient: 'row', line: row, from: start, to: col - 1 })
          start = null
        }
      }
    }
  }

  // Placement order: front→back, then left→right (SPEC §8.3).
  const frontRow = (run: Run) => (run.orient === 'row' ? run.line : run.from)
  const leftColumn = (run: Run) => (run.orient === 'row' ? run.from : run.line)
  runs.sort((a, b) => frontRow(a) - frontRow(b) || leftColumn(a) - leftColumn(b))

  for (const run of runs) {
    const first =
      run.orient === 'row' ? cellAt(run.line, run.from) : cellAt(run.from, run.line)
    const last = run.orient === 'row' ? cellAt(run.line, run.to) : cellAt(run.to, run.line)
    if (!first || !last) continue
    const count = run.to - run.from + 1
    const cells = Array.from({ length: count }, (_, offset) =>
      run.orient === 'row'
        ? cellAt(run.line, run.from + offset)!
        : cellAt(run.from + offset, run.line)!,
    )
    // Across the run the strip is one cell dimension: the row height for a row
    // run, the column width for a column run. A dimension within 2 mm of the
    // roll is covered by a full-width strip (the 1 mm overhang a 19 mm row
    // needs); a wider stretched corner is split into equal strips across.
    const runWidth = stripWidth(first, run.orient)
    const acrossCount =
      runWidth <= grid.tapeWidth + 2
        ? 1
        : Math.max(1, Math.ceil(runWidth / grid.tapeWidth - 1e-9))
    const width =
      acrossCount > 1 ? runWidth / acrossCount : runWidth >= grid.tapeWidth - 2 ? grid.tapeWidth : runWidth
    const length =
      run.orient === 'row' ? last.x1 - first.x0 : last.y1 - first.y0
    const range = first.label === last.label ? first.label : `${first.label}–${last.label}`
    for (let across = 1; across <= acrossCount; across++) {
      const piece: StripPiece = {
        level: run.level,
        orient: run.orient,
        line: run.line,
        from: run.from,
        to: run.to,
        width,
        length,
        label: acrossCount > 1 ? `${range} (${across}/${acrossCount})` : range,
        cells: cells.map((cell) => cell.label),
        partial: cells.some((cell) => cell.partial),
        acrossIndex: across,
        acrossCount,
      }
      pieces.push(piece)
      totalLengthMM += piece.length
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
