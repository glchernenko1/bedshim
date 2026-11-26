/**
 * First-layer reference zone (SPEC §9.2).
 *
 * `t1` is the effective lift of the *first* tape layer. The calibration pair
 * compares two meshes after detrending, so a uniform first layer is invisible:
 * it shifts the whole plate like a Z re-tune. t1 is identifiable only when some
 * cells change their "has tape" state between the two meshes while others do
 * not. A plan where every probed cell already carries a second layer has no
 * such contrast — t1 can never be measured again.
 *
 * This module reserves the contrast:
 *
 * - if the plan leaves at least one probed cell at 0 layers, that cell is raised
 *   to exactly 1 layer (a cheap 0 → 1 transition; no peeling);
 * - otherwise a small valley is carved: one cell at 0, its four neighbours at 1,
 *   and a ramp outward until the natural plan is reached. The ramp is widened
 *   only when a neighbour would differ by more than one layer, so the plate
 *   never sees a two-layer step at the zone.
 *
 * The zone is only built from probed, non-extrapolated, non-clipped cells.
 * When no safe zone fits, the caller warns instead of inventing one.
 */

export interface ReferenceInputCell {
  id: string
  row: number
  col: number
  /** Inside the probed rectangle and not clipped or stretched by the plate. */
  usable: boolean
  /** Natural planned layers before this guard. */
  planned: number
  /** Absolute layers already on the bed when this mesh was taken. */
  base: number
}

export type ReferenceRole = 'zero' | 'first' | 'ramp'

export interface ReferenceTarget {
  row: number
  col: number
  layers: number
  role: ReferenceRole
}

export interface ReferenceZone {
  /** The cell without tape, when the zone was carved. Null for a single filled cell. */
  zero: string | null
  /** Cells at exactly one layer. */
  first: string[]
  /** Lowered cells between the 1-layer ring and the natural plan. */
  ramp: string[]
  /** Layers physically peeled to build the zone. */
  peel: number
  /** Layers added to build the zone. */
  add: number
  cells: number
}

export interface ReferenceResult {
  zone: ReferenceZone
  targets: ReferenceTarget[]
}

export interface ReferenceOptions {
  /** Do not carve a zone larger than this. Default 25 cells. */
  maxCells?: number
}

/** True when the pair (base → planned) already has first-layer contrast. */
export function firstLayerIdentifiable(cells: readonly ReferenceInputCell[]): boolean {
  const values = new Set<number>()
  for (const cell of cells) {
    if (!cell.usable) continue
    values.add((cell.planned > 0 ? 1 : 0) - (cell.base > 0 ? 1 : 0))
    if (values.size > 1) return true
  }
  return false
}

interface Candidate {
  peel: number
  add: number
  lost: number
  distance: number
}

const indexOf = (cell: ReferenceInputCell, cols: number): number => cell.row * cols + cell.col

/** Peel first, then the total deviation from the natural plan, then distance. */
function better(a: Candidate, b: Candidate): boolean {
  const workA = a.add + a.lost
  const workB = b.add + b.lost
  return (
    a.peel < b.peel ||
    (a.peel === b.peel && (workA < workB || (workA === workB && a.distance < b.distance)))
  )
}

/**
 * Builds the cheapest zone that makes t1 identifiable for the next pair, or
 * null when the plan is already fine or no safe zone fits.
 */
export function reserveFirstLayer(
  cells: readonly ReferenceInputCell[],
  cols: number,
  options: ReferenceOptions = {},
): ReferenceResult | null {
  const maxCells = Math.max(1, options.maxCells ?? 25)
  const usable = cells.filter((cell) => cell.usable)
  if (usable.length === 0) return null
  if (firstLayerIdentifiable(cells)) return null
  // Nothing is glued: a calibration zone would only add tape to a flat bed.
  if (!usable.some((cell) => cell.planned > 0)) return null

  const byIndex = new Map<number, ReferenceInputCell>()
  for (const cell of cells) byIndex.set(indexOf(cell, cols), cell)
  const rows = Math.max(0, ...cells.map((cell) => cell.row)) + 1

  const neighbours = (cell: ReferenceInputCell): ReferenceInputCell[] => {
    const result: ReferenceInputCell[] = []
    for (const [dr, dc] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const) {
      const row = cell.row + dr
      const col = cell.col + dc
      if (row < 0 || row >= rows || col < 0 || col >= cols) continue
      const found = byIndex.get(row * cols + col)
      if (found) result.push(found)
    }
    return result
  }

  const centre = {
    row: usable.reduce((sum, cell) => sum + cell.row, 0) / usable.length,
    col: usable.reduce((sum, cell) => sum + cell.col, 0) / usable.length,
  }
  const distance = (cell: ReferenceInputCell): number => {
    const dr = cell.row - centre.row
    const dc = cell.col - centre.col
    return dr * dr + dc * dc
  }

  /**
   * Turns a target map into a result if it is a real change and every edge
   * stays within one layer. `zero` records the carved cell, if any.
   */
  const evaluate = (
    targets: Map<number, number>,
    zero: string | null,
    scoreDistance: number,
  ): { result: ReferenceResult; score: Candidate } | null => {
    if (targets.size === 0 || targets.size > maxCells) return null
    let changed = false
    let peel = 0
    let add = 0
    let lost = 0
    for (const [index, target] of targets) {
      const cell = byIndex.get(index)
      if (!cell || !cell.usable) return null
      if (target !== cell.planned) changed = true
      if (target < cell.base) peel += cell.base - target
      if (target > cell.base) add += target - cell.base
      if (target < cell.planned) lost += cell.planned - target
      for (const neighbour of neighbours(cell)) {
        const other = targets.get(indexOf(neighbour, cols)) ?? neighbour.planned
        if (Math.abs(target - other) > 1) return null
      }
    }
    if (!changed) return null

    const first: string[] = []
    const ramp: string[] = []
    const resultTargets: ReferenceTarget[] = []
    for (const [index, layers] of targets) {
      const cell = byIndex.get(index)!
      const role: ReferenceRole = zero === cell.id ? 'zero' : layers === 1 ? 'first' : 'ramp'
      if (role === 'first') first.push(cell.id)
      if (role === 'ramp') ramp.push(cell.id)
      resultTargets.push({ row: cell.row, col: cell.col, layers, role })
    }
    resultTargets.sort((a, b) => a.row - b.row || a.col - b.col)
    return {
      result: {
        zone: { zero, first, ramp, peel, add, cells: targets.size },
        targets: resultTargets,
      },
      score: { peel, add, lost, distance: scoreDistance },
    }
  }

  // Prefer filling an existing untaped cell: 0 → 1 is one added layer and no
  // peeling. This is the common case once the plan already leaves a 0.
  let bestFill: { result: ReferenceResult; score: Candidate } | null = null
  for (const cell of usable) {
    if (cell.base !== 0 || cell.planned !== 0) continue
    const targets = new Map<number, number>([[indexOf(cell, cols), 1]])
    const evaluated = evaluate(targets, null, distance(cell))
    if (!evaluated) continue
    if (!bestFill || better(evaluated.score, bestFill.score)) bestFill = evaluated
  }
  if (bestFill) return bestFill.result

  // No zero cell to fill: carve a valley. The seed is 0, its four neighbours 1,
  // and every further ring is lowered to one more than its parent, so the step
  // between neighbouring cells is never more than one layer.
  let best: { result: ReferenceResult; score: Candidate } | null = null
  for (const seed of usable) {
    const ring = neighbours(seed)
    if (ring.length !== 4) continue
    if (!ring.every((cell) => cell.usable)) continue

    const targets = new Map<number, number>()
    targets.set(indexOf(seed, cols), 0)
    for (const cell of ring) targets.set(indexOf(cell, cols), 1)

    const queue = ring.map((cell) => indexOf(cell, cols))
    while (queue.length > 0) {
      const index = queue.shift()!
      const value = targets.get(index)!
      const cell = byIndex.get(index)!
      for (const neighbour of neighbours(cell)) {
        const next = indexOf(neighbour, cols)
        if (!neighbour.usable || targets.has(next)) continue
        if (neighbour.planned > value + 1) {
          targets.set(next, value + 1)
          queue.push(next)
        }
      }
    }

    const evaluated = evaluate(targets, seed.id, distance(seed))
    if (!evaluated) continue
    if (!best || better(evaluated.score, best.score)) best = evaluated
  }
  return best?.result ?? null
}
