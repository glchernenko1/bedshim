import { deadbandOf, lift, type Material } from './material'
import type { CoreMessage } from './messages'
import type { Grid } from './grid'
import type { Surface } from './mesh/interpolate'
import { cellStats, type MeshSign, type Plan } from './plan'

export interface ForwardOptions {
  surface: Surface
  grid: Grid
  /** Absolute layer matrix, row-major (SPEC §7: the tape field is `lift(layers)`). */
  layers: number[][]
  material: Material
  /** Target level in height space (the plan's reference). */
  reference: number
  /** Default 'high' (Klipper). */
  meshSign?: MeshSign
  /** Bridging length, mm. Default 22. */
  sigma?: number
  /** Default 0.4 * ts. */
  deadband?: number
  /** Subgrid per axis for the cell mean. Default 16. */
  cellSamples?: number
}

export interface ForwardCell {
  id: string
  col: number
  row: number
  /** Measured height in sign-normalised space (positive = closer to nozzle). */
  height: number
  /** Required lift that the plan asks for in this cell, mm. */
  plannedLift: number
  /** Lift the plate will actually deliver at this cell, after bridging, mm. */
  effectiveLift: number
  /** height + effectiveLift, mm. */
  predicted: number
  /** predicted − reference, mm. */
  residual: number
  /** |residual| < deadband. */
  ok: boolean
}

export interface ForwardMesh {
  xCount: number
  yCount: number
  bounds: Surface['bounds']
  /** Predicted raw mesh values at the probe nodes, mm (same sign as the input). */
  points: number[][]
}

export interface ForwardResult {
  cells: ForwardCell[]
  /** residual[row][col], mm. */
  residual: number[][]
  /** Fraction of taped cells whose predicted result lands within the deadband. */
  achievable: number
  /** Fraction of taped cells where the plate delivers the requested lift (bridging fidelity). */
  delivered: number
  maxAbsResidual: number
  rmsResidual: number
  /** RMS of residual around its mean, mm: the shape error a Z offset cannot remove. */
  spreadResidual: number
  sigma: number
  deadband: number
  predictedMesh: ForwardMesh
  warnings: CoreMessage[]
}

function heightOf(value: number, sign: MeshSign): number {
  return sign === 'low' ? -value : value
}

interface Kernel {
  weight: number
  lift: number
}

/**
 * Effective lift at a point: the plate spans small patches, so the tape field is
 * low-pass filtered with a gaussian of `sigma` mm (SPEC §1.2, §7). Weights are
 * normalised over the cells that exist, so a uniform field stays uniform.
 */
function makeLiftField(
  grid: Grid,
  layers: number[][],
  material: Material,
  sigma: number,
): (x: number, y: number) => number {
  const kernel: Kernel[] = []
  grid.cells.forEach((cell) => {
    const layersHere = layers[cell.row]?.[cell.col] ?? 0
    // Cells outside the mesh are planned as 0 unless the plan extends into the
    // margin, where their tape still lifts the plate.
    kernel.push({
      weight: 0,
      lift: cell.unprobed && !grid.extendToPlate ? 0 : lift(material, layersHere),
    })
  })
  const centres = grid.cells.map((cell) => ({
    x: (cell.x0 + cell.x1) / 2,
    y: (cell.y0 + cell.y1) / 2,
  }))
  const safeSigma = Math.max(1e-6, sigma)
  const inv = 1 / (2 * safeSigma * safeSigma)
  return (x, y) => {
    // Log-sum-exp trick: subtract the nearest squared distance so a tiny σ
    // does not underflow every weight to zero.
    let nearest = Number.POSITIVE_INFINITY
    for (const centre of centres) {
      const dx = centre.x - x
      const dy = centre.y - y
      const d2 = dx * dx + dy * dy
      if (d2 < nearest) nearest = d2
    }
    let sum = 0
    let weight = 0
    for (let index = 0; index < centres.length; index++) {
      const dx = centres[index]!.x - x
      const dy = centres[index]!.y - y
      const w = Math.exp(-(dx * dx + dy * dy - nearest) * inv)
      sum += w * kernel[index]!.lift
      weight += w
    }
    return weight > 0 ? sum / weight : 0
  }
}

/** Applies the plan to the surface and reports what the plate can actually do. */
export function predict(options: ForwardOptions): ForwardResult {
  const {
    surface,
    grid,
    layers,
    material,
    reference,
    meshSign = 'high',
    sigma = 22,
    deadband = deadbandOf(material),
    cellSamples = 16,
  } = options

  const liftAt = makeLiftField(grid, layers, material, sigma)
  const cells: ForwardCell[] = []
  const residual: number[][] = Array.from({ length: grid.rows }, () => new Array<number>(grid.cols).fill(0))
  let okCount = 0
  let deliveredCount = 0
  let tapedCount = 0
  let maxAbs = 0
  let squareSum = 0
  let residualSum = 0

  for (const cell of grid.cells) {
    const stats = cellStats(surface, cell, cellSamples)
    const height = heightOf(stats.mean, meshSign)
    const plannedLift =
      cell.unprobed && !grid.extendToPlate ? 0 : lift(material, layers[cell.row]?.[cell.col] ?? 0)
    const cx = (cell.x0 + cell.x1) / 2
    const cy = (cell.y0 + cell.y1) / 2
    const effectiveLift = liftAt(cx, cy)
    const value = height + effectiveLift
    const cellResidual = value - reference
    const ok = Math.abs(cellResidual) < deadband
    const taped = plannedLift > 0
    if (taped) {
      tapedCount++
      if (ok) okCount++
      if (Math.abs(effectiveLift - plannedLift) < deadband) deliveredCount++
    }
    maxAbs = Math.max(maxAbs, Math.abs(cellResidual))
    squareSum += cellResidual * cellResidual
    residualSum += cellResidual
    residual[cell.row]![cell.col] = cellResidual
    cells.push({
      id: cell.id,
      col: cell.col,
      row: cell.row,
      height,
      plannedLift,
      effectiveLift,
      predicted: value,
      residual: cellResidual,
      ok,
    })
  }

  // The predicted mesh at the probe nodes, for export as a Klipper profile.
  const { bounds, xCount, yCount } = surface
  const points: number[][] = []
  for (let row = 0; row < yCount; row++) {
    const y = bounds.minY + (row / (yCount - 1)) * (bounds.maxY - bounds.minY)
    const line: number[] = []
    for (let col = 0; col < xCount; col++) {
      const x = bounds.minX + (col / (xCount - 1)) * (bounds.maxX - bounds.minX)
      line.push(surface.at(x, y) + liftAt(x, y))
    }
    points.push(line)
  }

  // "Achievable" is about the cells the plan actually touches: a cell with no
  // tape is already at the target by construction, so counting it would hide a
  // plan that fails exactly where it matters.
  const achievable = tapedCount > 0 ? okCount / tapedCount : 1
  const delivered = tapedCount > 0 ? deliveredCount / tapedCount : 1
  const meanResidual = residualSum / Math.max(1, cells.length)
  const variance = squareSum / Math.max(1, cells.length) - meanResidual * meanResidual
  const warnings: CoreMessage[] = []
  if (delivered < 0.6) {
    // The plate is not delivering the tape: this is a bridging problem.
    warnings.push({
      code: 'forward.warn.notAchievable',
      params: { percent: Math.round(delivered * 100), sigma },
    })
  } else if (achievable < 0.6) {
    // The plate does what was asked; the plan itself is conservative (floor).
    warnings.push({ code: 'forward.notice.undershoot' })
  } else if (achievable < 0.9) {
    warnings.push({ code: 'forward.notice.bridging', params: { sigma } })
  }

  return {
    cells,
    residual,
    achievable,
    delivered,
    maxAbsResidual: maxAbs,
    rmsResidual: Math.sqrt(squareSum / Math.max(1, cells.length)),
    spreadResidual: Math.sqrt(Math.max(0, variance)),
    sigma,
    deadband,
    predictedMesh: { xCount, yCount, bounds, points },
    warnings,
  }
}

/** Convenience wrapper: predict the outcome of an existing plan. */
export function predictPlan(plan: Plan, surface: Surface, options: Partial<ForwardOptions> = {}): ForwardResult {
  return predict({
    surface,
    grid: plan.grid,
    layers: plan.layers,
    material: plan.material,
    reference: plan.reference,
    meshSign: plan.meshSign,
    deadband: plan.deadband,
    ...options,
  })
}

/** A `[bed_mesh <name>]` block the user can paste into printer.cfg (SPEC §7). */
export function predictedMeshBlock(result: ForwardResult, mesh: { algo: string; tension: number; meshXPps: number; meshYPps: number }, name = 'predicted'): string {
  const { bounds, xCount, yCount, points } = result.predictedMesh
  const fmt = (value: number): string => (Number.isInteger(value) ? String(value) : value.toFixed(3))
  const rows = points.map((row) => '  ' + row.map((value) => value.toFixed(6)).join(', '))
  return [
    `[bed_mesh ${name}]`,
    'version = 1',
    'points =',
    ...rows,
    `x_count = ${xCount}`,
    `y_count = ${yCount}`,
    `mesh_x_pps = ${mesh.meshXPps}`,
    `mesh_y_pps = ${mesh.meshYPps}`,
    `algo = ${mesh.algo}`,
    `tension = ${fmt(mesh.tension)}`,
    `min_x = ${fmt(bounds.minX)}`,
    `max_x = ${fmt(bounds.maxX)}`,
    `min_y = ${fmt(bounds.minY)}`,
    `max_y = ${fmt(bounds.maxY)}`,
  ].join('\n')
}
