import type { Grid } from './grid'
import type { CoreMessage } from './messages'
import type { Surface } from './mesh/interpolate'

export interface FitOptions {
  oldSurface: Surface
  newSurface: Surface
  /** Absolute layers on the bed when the old mesh was taken. */
  oldLayers: number[][]
  /** Absolute layers on the bed when the new mesh was taken. */
  newLayers: number[][]
  grid: Grid
  /** Bridging length used when modelling the tape field, mm. Default 22. */
  sigma?: number
  /** Subgrid per axis for the cell mean. Default 16. */
  cellSamples?: number
  /**
   * Known first-layer lift. Used when the two meshes differ only by further
   * layers (every cell already had tape), where t1 is not identifiable.
   */
  fixedT1?: number
}

export interface FitResult {
  t1: number
  ts: number
  /** Coefficient of determination of the fit against the measured delta. */
  r2: number
  /** RMS of the residuals, mm. */
  noise: number
  cells: number
  /** How many cells changed by each number of layers. */
  counts: Array<{ delta: number; cells: number }>
  /** True when no cell had a 2+ layer change, so ts fell back to t1. */
  singleParameter: boolean
  /** True when only ts was measurable and t1 was taken as given. */
  tsOnly: boolean
  /** t1 is clearly above the noise. */
  conclusive: boolean
  warnings: CoreMessage[]
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * Least-squares fit of `t1` and `ts` from two meshes and the absolute layer
 * states between them (SPEC §9.2). Both meshes are detrended by their mean, so
 * a global shift after taping (the usual Z re-tune) does not pollute the fit.
 * The tape field is blurred with `sigma`, the same bridging the plate applies.
 */
export function fitMaterial(options: FitOptions): FitResult {
  const {
    oldSurface,
    newSurface,
    oldLayers,
    newLayers,
    grid,
    sigma = 22,
    cellSamples: _cellSamples = 16,
    fixedT1,
  } = options

  // Compare at the probe nodes: the measured delta there is a direct sample of
  // the bridged tape field, so the model does not have to be resampled through
  // a cell mean. Detrending removes the global shift after taping.
  const nodes: Array<{ x: number; y: number }> = []
  const { bounds, xCount, yCount } = oldSurface
  for (let row = 0; row < yCount; row++) {
    const y = bounds.minY + (row / (yCount - 1)) * (bounds.maxY - bounds.minY)
    for (let col = 0; col < xCount; col++) {
      const x = bounds.minX + (col / (xCount - 1)) * (bounds.maxX - bounds.minX)
      nodes.push({ x, y })
    }
  }

  const safeSigma = Math.max(1e-6, sigma)
  const inv = 1 / (2 * safeSigma * safeSigma)
  const centres = grid.cells.map((cell) => ({
    row: cell.row,
    col: cell.col,
    x: (cell.x0 + cell.x1) / 2,
    y: (cell.y0 + cell.y1) / 2,
  }))

  const blurLayerField = (field: number[][], x: number, y: number): number => {
    let nearest = Number.POSITIVE_INFINITY
    for (const centre of centres) {
      const dx = centre.x - x
      const dy = centre.y - y
      const d2 = dx * dx + dy * dy
      if (d2 < nearest) nearest = d2
    }
    let sum = 0
    let weight = 0
    for (const centre of centres) {
      const dx = centre.x - x
      const dy = centre.y - y
      const w = Math.exp(-(dx * dx + dy * dy - nearest) * inv)
      sum += w * (field[centre.row]?.[centre.col] ?? 0)
      weight += w
    }
    return weight > 0 ? sum / weight : 0
  }

  const basis1: number[][] = Array.from({ length: grid.rows }, () => new Array<number>(grid.cols).fill(0))
  const basis2: number[][] = Array.from({ length: grid.rows }, () => new Array<number>(grid.cols).fill(0))
  const countsByDelta = new Map<number, number>()
  for (const cell of grid.cells) {
    const before = oldLayers[cell.row]?.[cell.col] ?? 0
    const after = newLayers[cell.row]?.[cell.col] ?? 0
    basis1[cell.row]![cell.col] = (after >= 1 ? 1 : 0) - (before >= 1 ? 1 : 0)
    basis2[cell.row]![cell.col] = Math.max(after - 1, 0) - Math.max(before - 1, 0)
    const deltaLayers = after - before
    countsByDelta.set(deltaLayers, (countsByDelta.get(deltaLayers) ?? 0) + 1)
  }

  const oldVals: number[] = []
  const newVals: number[] = []
  const b1Vals: number[] = []
  const b2Vals: number[] = []
  for (const node of nodes) {
    oldVals.push(oldSurface.at(node.x, node.y))
    newVals.push(newSurface.at(node.x, node.y))
    b1Vals.push(blurLayerField(basis1, node.x, node.y))
    b2Vals.push(blurLayerField(basis2, node.x, node.y))
  }

  const oldMean = mean(oldVals)
  const newMean = mean(newVals)
  const delta = oldVals.map((value, index) => newVals[index]! - value - (newMean - oldMean))
  const mean1 = mean(b1Vals)
  const mean2 = mean(b2Vals)

  let s11 = 0
  let s12 = 0
  let s22 = 0
  let y1 = 0
  let y2 = 0
  for (let index = 0; index < delta.length; index++) {
    const b1 = b1Vals[index]! - mean1
    const b2 = b2Vals[index]! - mean2
    s11 += b1 * b1
    s12 += b1 * b2
    s22 += b2 * b2
    y1 += b1 * delta[index]!
    y2 += b2 * delta[index]!
  }

  const warnings: CoreMessage[] = []
  const counts = [...countsByDelta.entries()]
    .map(([deltaLayers, cells]) => ({ delta: deltaLayers, cells }))
    .sort((a, b) => a.delta - b.delta)

  if (s11 < 1e-12 && s22 < 1e-12) {
    warnings.push({ code: 'calibrate.error.noChanges' })
    return {
      t1: 0,
      ts: 0,
      r2: 0,
      noise: 0,
      cells: grid.cells.length,
      counts,
      singleParameter: false,
      tsOnly: false,
      conclusive: false,
      warnings,
    }
  }

  const determinant = s11 * s22 - s12 * s12
  let t1: number
  let ts: number
  let singleParameter = false
  let tsOnly = false
  if (s11 < 1e-12) {
    // Every cell already had tape: only the further-layer lift is observable.
    tsOnly = true
    t1 = fixedT1 ?? 0
    ts = (y2 - t1 * s12) / s22
    if (fixedT1 === undefined) {
      warnings.push({ code: 'calibrate.warn.onlyTs', params: { ts: ts.toFixed(4) } })
    } else {
      warnings.push({ code: 'calibrate.notice.tsOnly', params: { t1: t1.toFixed(4), ts: ts.toFixed(4) } })
    }
  } else if (Math.abs(determinant) < 1e-12 || s22 < 1e-12) {
    // No cell changed by a second layer: only the first-layer lift is observable.
    t1 = y1 / s11
    ts = t1
    singleParameter = true
    warnings.push({ code: 'calibrate.notice.singleParameter' })
  } else {
    t1 = (y1 * s22 - y2 * s12) / determinant
    ts = (y2 * s11 - y1 * s12) / determinant
  }

  let sse = 0
  let sst = 0
  for (let index = 0; index < delta.length; index++) {
    const predicted = t1 * (b1Vals[index]! - mean1) + ts * (b2Vals[index]! - mean2)
    const residual = delta[index]! - predicted
    sse += residual * residual
    sst += delta[index]! * delta[index]!
  }
  const noise = Math.sqrt(sse / Math.max(1, delta.length))
  const r2 = sst > 1e-18 ? 1 - sse / sst : 0

  if (!(t1 > 0) || !(ts > 0)) {
    warnings.push({ code: 'calibrate.warn.negative', params: { t1: t1.toFixed(4), ts: ts.toFixed(4) } })
  }
  if (r2 < 0.9) {
    warnings.push({
      code: 'calibrate.warn.poorFit',
      params: { r2: r2.toFixed(2), noise: noise.toFixed(4) },
    })
  }
  const conclusive = t1 > 0 && ts > 0 && t1 > 2 * noise && r2 > 0.5
  if (!conclusive) {
    warnings.push({ code: 'calibrate.warn.inconclusive', params: { t1: t1.toFixed(4), noise: noise.toFixed(4) } })
  }

  return {
    t1,
    ts,
    r2,
    noise,
    cells: grid.cells.length,
    counts,
    singleParameter,
    tsOnly,
    conclusive,
    warnings,
  }
}
