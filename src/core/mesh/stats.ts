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
