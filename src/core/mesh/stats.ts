import type { Surface } from './interpolate'

/** Statistics of the interpolated surface, in mm (same sign as the mesh). */
export interface SurfaceStats {
  min: number
  max: number
  /** max − min: the full height the plan would have to cover. */
  delta: number
  mean: number
  median: number
  /** Median absolute deviation, median(|z − median|): a spread that ignores a single bad node. */
  mad: number
  samples: number
}

function medianOf(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length === 0) return Number.NaN
  if (sorted.length % 2 === 1) return sorted[middle]!
  return (sorted[middle - 1]! + sorted[middle]!) / 2
}

/** How the MAD compares with one tape layer: a plain-language severity. */
export type MadBand = 'flat' | 'mild' | 'notable' | 'strong'

export interface MadBands {
  /** Below this the bed is flat enough that shimming is chasing noise. */
  flatMax: number
  mildMax: number
  notableMax: number
}

/**
 * Band edges in mm for a given effective layer `ts` (SPEC §1.3, §1.4).
 * A quarter layer is below what a tape correction can express; the absolute
 * floor of 0.005 mm is Klipper's best-case probe repeatability (§1.4).
 */
export function madBands(ts: number): MadBands {
  const flatMax = Math.max(0.25 * ts, 0.005)
  const mildMax = Math.max(ts, 2 * flatMax)
  const notableMax = Math.max(2 * ts, 1.5 * mildMax)
  return { flatMax, mildMax, notableMax }
}

export function madBand(mad: number, ts: number): MadBand {
  const bands = madBands(ts)
  if (mad <= bands.flatMax) return 'flat'
  if (mad <= bands.mildMax) return 'mild'
  if (mad <= bands.notableMax) return 'notable'
  return 'strong'
}


/**
 * Samples the surface on a uniform grid inside the mesh bounds and summarises it.
 * The grid includes the bounds themselves, so min/max are the real extrema of
 * the measured area (an edge node is often the outlier we care about). The
 * margin outside the bounds is not included: that is extrapolation, not measurement.
 */
export function surfaceStats(surface: Surface, resolution = 96): SurfaceStats {
  const steps = Math.max(2, Math.floor(resolution))
  const { minX, maxX, minY, maxY } = surface.bounds
  const spanX = maxX - minX
  const spanY = maxY - minY
  const values: number[] = new Array(steps * steps)
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let sum = 0
  let index = 0
  for (let row = 0; row < steps; row++) {
    const y = minY + (row / (steps - 1)) * spanY
    for (let col = 0; col < steps; col++) {
      const x = minX + (col / (steps - 1)) * spanX
      const value = surface.at(x, y)
      values[index++] = value
      if (value < min) min = value
      if (value > max) max = value
      sum += value
    }
  }
  const sorted = [...values].sort((a, b) => a - b)
  const median = medianOf(sorted)
  const deviations = values.map((value) => Math.abs(value - median)).sort((a, b) => a - b)
  return {
    min,
    max,
    delta: max - min,
    mean: sum / values.length,
    median,
    mad: medianOf(deviations),
    samples: values.length,
  }
}
