import { deadbandOf, lift, type Material } from './material'
import type { CoreMessage } from './messages'
import type { Grid, Cell } from './grid'
import type { Surface } from './mesh/interpolate'

export type MeshSign = 'high' | 'low'
export type Rounding = 'floor' | 'round'

export interface PlanCell {
  id: string
  col: number
  row: number
  x0: number
  x1: number
  y0: number
  y1: number
  /** Area average of the surface over the cell (SPEC §5.3). */
  mean: number
  /** max − min inside the cell; a large value means one layer count cannot fit it. */
  range: number
  /** Required lift after smoothing, mm. */
  target: number
  layers: number
  unprobed: boolean
  partial: boolean
  /** range > 0.5 * ts: the plate averages this cell, so a single count is a compromise. */
  inconsistent: boolean
  /** The ideal layer count was cut by maxLayers. */
  clamped: boolean
}

export interface PlanStats {
  totalLayers: number
  cellsWithTape: number
  tapeLengthMM: number
  tapeAreaMM2: number
  maxUsed: number
  unprobed: number
  inconsistent: number
  clamped: number
}

export interface Plan {
  cells: PlanCell[]
  cols: number
  rows: number
  layers: number[][]
  grid: Grid
  material: Material
  reference: number
  referencePercentile: number
  deadband: number
  sigma: number
  maxLayers: number
  rounding: Rounding
  meshSign: MeshSign
  stats: PlanStats
  warnings: CoreMessage[]
}

export interface PlanOptions {
  surface: Surface
  grid: Grid
  material: Material
  /** Quantile of plate height treated as "already good enough". Default 0.85. */
  referencePercentile?: number
  /** Default 0.4 * ts. */
  deadband?: number
  /** Bridging length, mm. Default 22. Only used when `smoothTarget` is on. */
  sigma?: number
  /**
   * Pre-smoothing the target before quantising (SPEC §1.2 sentence) is off by
   * default: the §4 pipeline and Appendix A put the σ blur in the forward model,
   * and pre-smoothing silently removes tape (it is the forward model that must
   * predict the bridged result).
   */
  smoothTarget?: boolean
  /** Default 'floor' until the material is calibrated, then 'round'. */
  rounding?: Rounding
  maxLayers?: number
  /** How to read a positive mesh value. Default 'low' (the fixture). */
  meshSign?: MeshSign
  /** Subgrid per axis for the cell mean; SPEC §5.3 requires ≥ 8. Default 16. */
  cellSamples?: number
}

/**
 * Height of the plate in a sign-normalised space: positive = closer to the
 * nozzle. Tape can only raise it, so the reference is a high quantile of `h`
 * and every low cell needs `ref − h` of lift.
 */
function heightOf(mean: number, sign: MeshSign): number {
  // Positive = closer to the nozzle. If a positive mesh value means the plate is
  // low, the height axis is its negation.
  return sign === 'low' ? -mean : mean
}

/** Linear (R-7) quantile, the same convention as numpy's default. */
export function quantile(values: readonly number[], percentile: number): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const p = Math.min(1, Math.max(0, percentile))
  const position = (sorted.length - 1) * p
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const weight = position - lower
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight
}

export interface QuantizeOptions {
  deadband: number
  maxLayers: number
  rounding: Rounding
}

/**
 * Converts a required lift in mm into an integer number of tape layers:
 * nearest lift with ties to the smaller count, a deadband, a ceiling, and a
 * deliberate undershoot when the material is not calibrated (SPEC §6.3).
 */
export function quantize(target: number, material: Material, options: QuantizeOptions): number {
  if (!(target > 0) || target < options.deadband) return 0
  let best = 0
  let bestError = Math.abs(target)
  for (let layers = 1; layers <= options.maxLayers; layers++) {
    const error = Math.abs(lift(material, layers) - target)
    // Strict `<` keeps the smaller count on ties: never overshoot on a coin flip.
    if (error < bestError - 1e-12) {
      best = layers
      bestError = error
    }
  }
  if (options.rounding === 'floor') {
    // Never exceed the target: the largest count whose lift does not overshoot.
    let layers = best
    while (layers > 0 && lift(material, layers) > target + 1e-9) layers--
    return layers
  }
  return best
}

function cellStats(
  surface: Surface,
  cell: Cell,
  samples: number,
): { mean: number; min: number; max: number } {
  const steps = Math.max(8, Math.floor(samples))
  const width = cell.x1 - cell.x0
  const height = cell.y1 - cell.y0
  let sum = 0
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let row = 0; row < steps; row++) {
    const y = cell.y0 + ((row + 0.5) * height) / steps
    for (let col = 0; col < steps; col++) {
      const x = cell.x0 + ((col + 0.5) * width) / steps
      const value = surface.at(x, y)
      sum += value
      if (value < min) min = value
      if (value > max) max = value
    }
  }
  return { mean: sum / (steps * steps), min, max }
}

function gaussianKernel(sigma: number): number[] {
  const radius = Math.max(1, Math.ceil(3 * sigma))
  const weights: number[] = []
  let sum = 0
  for (let i = -radius; i <= radius; i++) {
    const weight = Math.exp(-(i * i) / (2 * sigma * sigma))
    weights.push(weight)
    sum += weight
  }
  return weights.map((weight) => weight / sum)
}

/** Separable gaussian blur over the cell grid, edges replicated. */
function blurGrid(values: number[][], sigmaX: number, sigmaY: number): number[][] {
  const rows = values.length
  const cols = values[0]?.length ?? 0
  if (rows === 0 || cols === 0) return values
  const kernelX = gaussianKernel(Math.max(1e-6, sigmaX))
  const kernelY = gaussianKernel(Math.max(1e-6, sigmaY))
  const radiusX = (kernelX.length - 1) / 2
  const radiusY = (kernelY.length - 1) / 2

  const horizontal: number[][] = values.map((row) => {
    const line: number[] = new Array(cols).fill(0)
    for (let col = 0; col < cols; col++) {
      let sum = 0
      for (let k = 0; k < kernelX.length; k++) {
        const source = Math.min(cols - 1, Math.max(0, col + k - radiusX))
        sum += row[source]! * kernelX[k]!
      }
      line[col] = sum
    }
    return line
  })

  const result: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0))
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let sum = 0
      for (let k = 0; k < kernelY.length; k++) {
        const source = Math.min(rows - 1, Math.max(0, row + k - radiusY))
        sum += horizontal[source]![col]! * kernelY[k]!
      }
      result[row]![col] = sum
    }
  }
  return result
}

/**
 * Turns the surface + grid into an absolute layer matrix. Layers are a physical
 * quantity: a later iteration may peel tape that is already there, but never
 * below zero (see `diffAgainstPhysical`).
 */
export function plan(options: PlanOptions): Plan {
  const {
    surface,
    grid,
    material,
    referencePercentile = 0.85,
    deadband = deadbandOf(material),
    sigma = 22,
    rounding = material.calibrated ? 'round' : 'floor',
    maxLayers = 6,
    meshSign = 'low',
    cellSamples = 16,
    smoothTarget = false,
  } = options

  const means: number[][] = Array.from({ length: grid.rows }, () => new Array<number>(grid.cols).fill(0))
  const ranges: number[][] = Array.from({ length: grid.rows }, () => new Array<number>(grid.cols).fill(0))
  for (const cell of grid.cells) {
    const stats = cellStats(surface, cell, cellSamples)
    means[cell.row]![cell.col] = stats.mean
    ranges[cell.row]![cell.col] = stats.max - stats.min
  }

  const heights: number[] = []
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) heights.push(heightOf(means[row]![col]!, meshSign))
  }
  const reference = quantile(heights, referencePercentile)

  const raw: number[][] = heights
    ? Array.from({ length: grid.rows }, (_, row) =>
        Array.from({ length: grid.cols }, (_, col) => {
          const cell = grid.cells[row * grid.cols + col]!
          const needed = Math.max(0, reference - heightOf(means[row]![col]!, meshSign))
          return cell.unprobed ? 0 : needed
        }),
      )
    : []

  // Bridging smoothing is optional here; by default the target stays raw and the
  // forward model (P3) applies the σ blur when predicting the result.
  const target = smoothTarget
    ? blurGrid(raw, sigma / grid.tapeWidth, sigma / grid.rowSpacing)
    : raw

  const cells: PlanCell[] = []
  let totalLayers = 0
  let cellsWithTape = 0
  let tapeLengthMM = 0
  let tapeAreaMM2 = 0
  let maxUsed = 0
  let unprobed = 0
  let inconsistent = 0
  let clamped = 0

  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const cell = grid.cells[row * grid.cols + col]!
      const mean = means[row]![col]!
      const range = ranges[row]![col]!
      const needed = target[row]![col] ?? 0
      const wanted = quantize(needed, material, { deadband, maxLayers, rounding })
      const idealWanted = quantize(needed, material, { deadband, maxLayers: 64, rounding })
      const layers = cell.unprobed ? 0 : wanted
      const width = cell.x1 - cell.x0
      const cellHeight = cell.y1 - cell.y0
      totalLayers += layers
      if (layers > 0) {
        cellsWithTape++
        tapeLengthMM += layers * width
        tapeAreaMM2 += layers * width * cellHeight
      }
      maxUsed = Math.max(maxUsed, layers)
      if (cell.unprobed) unprobed++
      if (range > 0.5 * material.ts) inconsistent++
      if (idealWanted > maxLayers) clamped++
      cells.push({
        id: cell.id,
        col,
        row,
        x0: cell.x0,
        x1: cell.x1,
        y0: cell.y0,
        y1: cell.y1,
        mean,
        range,
        target: needed,
        layers,
        unprobed: cell.unprobed,
        partial: cell.partial,
        inconsistent: range > 0.5 * material.ts,
        clamped: idealWanted > maxLayers,
      })
    }
  }

  const warnings: CoreMessage[] = []
  if (unprobed > 0) warnings.push({ code: 'plan.notice.unprobed', params: { count: unprobed } })
  if (clamped > 0) warnings.push({ code: 'plan.notice.clamped', params: { count: clamped, max: maxLayers } })
  if (inconsistent > 0) warnings.push({ code: 'plan.notice.inconsistent', params: { count: inconsistent } })

  return {
    cells,
    cols: grid.cols,
    rows: grid.rows,
    layers: Array.from({ length: grid.rows }, (_, row) =>
      Array.from({ length: grid.cols }, (_, col) => cells[row * grid.cols + col]!.layers),
    ),
    grid,
    material,
    reference,
    referencePercentile,
    deadband,
    sigma,
    maxLayers,
    rounding,
    meshSign,
    stats: {
      totalLayers,
      cellsWithTape,
      tapeLengthMM,
      tapeAreaMM2,
      maxUsed,
      unprobed,
      inconsistent,
      clamped,
    },
    warnings,
  }
}

export interface PlanDiffCell {
  id: string
  col: number
  row: number
  planned: number
  physical: number
  /** planned − physical; negative means peel this many layers. */
  delta: number
}

export interface PlanDiff {
  cells: PlanDiffCell[]
  add: number
  peel: number
  unchanged: number
}

/**
 * Compares a plan with what is physically on the plate. Layers are absolute:
 * a cell may go down (peel) but never below zero, so overshoot from a previous
 * iteration is recoverable, unlike the monotonic plan of SPEC §1.1.
 */
export function diffAgainstPhysical(planResult: Plan, physical: number[][]): PlanDiff {
  const cells: PlanDiffCell[] = []
  let add = 0
  let peel = 0
  let unchanged = 0
  for (const cell of planResult.cells) {
    const current = Math.max(0, physical[cell.row]?.[cell.col] ?? 0)
    const planned = Math.max(0, cell.layers)
    const delta = planned - current
    if (delta > 0) add += delta
    else if (delta < 0) peel += -delta
    else unchanged++
    cells.push({ id: cell.id, col: cell.col, row: cell.row, planned, physical: current, delta })
  }
  return { cells, add, peel, unchanged }
}
