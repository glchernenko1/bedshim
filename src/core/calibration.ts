import { fitBridging, type BridgingResult } from './calibrate'
import { buildGrid } from './grid'
import { createSurface } from './mesh/interpolate'
import type { Mesh } from './mesh/types'

/**
 * The subset of a stored measurement the calibration needs. Keeping it
 * structural lets the core stay free of the store while Pro and Auto use the
 * exact same fit (SPEC §9.2).
 */
export interface CalibrationMeasurement {
  id: string
  label: string
  createdAt: string
  mesh: Mesh
  layers: number[][] | null
  applied: CalibrationPlan | null
}

/** The plan geometry recorded when a plan was marked as glued. */
export interface CalibrationPlan {
  layers: number[][]
  tapeWidth: number
  plateW: number
  plateH: number
  extendToPlate: boolean
}

export type CalibrationProblem = 'same' | 'fromNoPlan' | 'toNoLayers' | 'geometry' | null

export interface CalibrationPair {
  from: CalibrationMeasurement
  to: CalibrationMeasurement
}

/**
 * Panels are fitted as a chronological pair: what was on the bed when the
 * older mesh was taken, and what the newer mesh saw. Pro preselects the last
 * two measurements and Auto always uses them, so both take the same pair.
 */
export function lastPair(measurements: readonly CalibrationMeasurement[]): CalibrationPair | null {
  if (measurements.length < 2) return null
  return {
    from: measurements[measurements.length - 2]!,
    to: measurements[measurements.length - 1]!,
  }
}

/**
 * Absolute layers on the bed when a measurement was taken. A measurement added
 * right after its plan was glued carries them; the older mesh of a pair may
 * only know the plan, in which case it was taken on a bare bed.
 */
export function baseLayersOf(measurement: CalibrationMeasurement): number[][] | null {
  if (measurement.layers) return measurement.layers
  if (!measurement.applied) return null
  return measurement.applied.layers.map((row) => row.map(() => 0))
}

function boundsMatch(
  a: CalibrationMeasurement['mesh']['bounds'],
  b: CalibrationMeasurement['mesh']['bounds'],
): boolean {
  if (!a || !b) return false
  return (
    Math.abs(a.minX - b.minX) < 1e-6 &&
    Math.abs(a.maxX - b.maxX) < 1e-6 &&
    Math.abs(a.minY - b.minY) < 1e-6 &&
    Math.abs(a.maxY - b.maxY) < 1e-6
  )
}

/** Why a pair cannot be fitted, or null when it can. */
export function calibrationProblem(from: CalibrationMeasurement, to: CalibrationMeasurement): CalibrationProblem {
  if (from.id === to.id) return 'same'
  if (!from.applied || !baseLayersOf(from)) return 'fromNoPlan'
  if (!to.layers) return 'toNoLayers'
  if (
    from.mesh.xCount !== to.mesh.xCount ||
    from.mesh.yCount !== to.mesh.yCount ||
    !boundsMatch(from.mesh.bounds, to.mesh.bounds)
  ) {
    return 'geometry'
  }
  return null
}

export interface FitPairOptions {
  from: CalibrationMeasurement
  to: CalibrationMeasurement
  /** Known first-layer lift when only further layers are identifiable. */
  fixedT1?: number
  /** σ kept when the pair cannot pin it down, mm. */
  fallbackSigma?: number
}

/** Fits t1/ts/σ for one pair; null when the pair cannot be fitted at all. */
export function fitCalibrationPair(options: FitPairOptions): BridgingResult | null {
  const { from, to, fixedT1, fallbackSigma } = options
  if (calibrationProblem(from, to) !== null) return null
  const oldLayers = baseLayersOf(from)
  if (!from.applied || !oldLayers || !to.layers || !from.mesh.bounds) return null

  const grid = buildGrid({
    plate: { w: from.applied.plateW, h: from.applied.plateH },
    meshBounds: from.mesh.bounds,
    tapeWidth: from.applied.tapeWidth,
    meshXCount: from.mesh.xCount,
    meshYCount: from.mesh.yCount,
    extendToPlate: from.applied.extendToPlate,
  })

  return fitBridging({
    oldSurface: createSurface(from.mesh),
    newSurface: createSurface(to.mesh),
    oldLayers,
    newLayers: to.layers,
    grid,
    fixedT1,
    fallbackSigma,
  })
}

export interface CalibrationValues {
  t1: number
  ts: number
  sigma: number
  rounding: 'round'
}

/**
 * The exact settings a fit turns into. Pro and Auto both apply this, so the
 * plan cannot differ between the two modes for the same pair.
 */
export function calibrationValues(result: BridgingResult): CalibrationValues {
  const round4 = (value: number): number => Math.round(value * 10000) / 10000
  return {
    t1: round4(result.fit.t1),
    ts: round4(result.fit.ts),
    sigma: Math.round(result.sigma * 10) / 10,
    rounding: 'round',
  }
}

export type AutoCalibrationState =
  | { status: 'noPair' }
  | { status: 'blocked'; problem: Exclude<CalibrationProblem, null>; from: CalibrationMeasurement; to: CalibrationMeasurement }
  | { status: 'inconclusive'; from: CalibrationMeasurement; to: CalibrationMeasurement; result: BridgingResult }
  | {
      status: 'ready'
      from: CalibrationMeasurement
      to: CalibrationMeasurement
      result: BridgingResult
      values: CalibrationValues
    }

export interface AutoCalibrationOptions {
  measurements: readonly CalibrationMeasurement[]
  fixedT1?: number
  fallbackSigma?: number
}

/**
 * What Auto mode should do with the current measurement list. It is a pure
 * function so the automatic path can be compared with Pro in tests; the UI
 * side only applies `values` when the state is `ready`.
 */
export function autoCalibration(options: AutoCalibrationOptions): AutoCalibrationState {
  const pair = lastPair(options.measurements)
  if (!pair) return { status: 'noPair' }

  const problem = calibrationProblem(pair.from, pair.to)
  if (problem !== null) return { status: 'blocked', problem, ...pair }

  const result = fitCalibrationPair({
    ...pair,
    fixedT1: options.fixedT1,
    fallbackSigma: options.fallbackSigma,
  })
  if (!result) return { status: 'blocked', problem: 'fromNoPlan', ...pair }
  if (!result.fit.conclusive) return { status: 'inconclusive', ...pair, result }

  return { status: 'ready', ...pair, result, values: calibrationValues(result) }
}
