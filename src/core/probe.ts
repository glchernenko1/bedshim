import type { CoreMessage } from './messages'
import type { MeshBounds } from './mesh/types'

export interface ProbeEstimate {
  tapeWidth: number
  idealX: number
  idealY: number
  points: number
  minutes: number
}

/** SPEC §5.4: the probe count that puts roughly one probe per tape cell. */
export function idealProbeCount(bounds: MeshBounds, tapeWidth: number): { x: number; y: number } {
  if (!(tapeWidth > 0)) throw new RangeError('tapeWidth must be > 0')
  const spanX = bounds.maxX - bounds.minX
  const spanY = bounds.maxY - bounds.minY
  // Klipper cannot probe fewer than 3 points on an axis.
  return {
    x: Math.max(3, Math.round(spanX / tapeWidth) + 1),
    y: Math.max(3, Math.round(spanY / tapeWidth) + 1),
  }
}

export function probeEstimate(
  bounds: MeshBounds,
  tapeWidth: number,
  secondsPerPoint = 2,
): ProbeEstimate {
  const { x, y } = idealProbeCount(bounds, tapeWidth)
  const points = x * y
  return {
    tapeWidth,
    idealX: x,
    idealY: y,
    points,
    minutes: (points * Math.max(0.1, secondsPerPoint)) / 60,
  }
}

export type ProbeVerdict = 'coarse' | 'good' | 'fine' | 'slow'

/**
 * Verdict for a candidate tape width, relative to the tape in use (one probe
 * per cell). An absolute point cutoff called the 250 mm bed's own 12×12 ideal
 * "fine" (мелко) while the 235 mm fixture's 11×11 counted as "good"; the two
 * are the same density, so the comparison has to be relative.
 */
export function probeVerdict(points: number, currentPoints: number): ProbeVerdict {
  const ratio = currentPoints > 0 ? points / currentPoints : 1
  if (ratio <= 0.5) return 'coarse'
  if (ratio <= 1.5) return 'good'
  if (ratio <= 3) return 'fine'
  return 'slow'
}

export interface ProbeMismatch {
  idealX: number
  idealY: number
  points: number
  currentX: number
  currentY: number
}

/**
 * Compares the probe grid a mesh was taken with to the grid the tape needs.
 * Null when both axes are within one probe of the ideal, so ordinary rounding
 * (round vs ceil) does not nag the user.
 */
export function probeMismatch(
  bounds: MeshBounds,
  tapeWidth: number,
  xCount: number,
  yCount: number,
  tolerance = 1,
): ProbeMismatch | null {
  const ideal = idealProbeCount(bounds, tapeWidth)
  if (Math.abs(xCount - ideal.x) <= tolerance && Math.abs(yCount - ideal.y) <= tolerance) return null
  return {
    idealX: ideal.x,
    idealY: ideal.y,
    points: ideal.x * ideal.y,
    currentX: xCount,
    currentY: yCount,
  }
}

export interface ProbeAdviceOptions {
  bounds: MeshBounds
  tapeWidth: number
  xCount: number
  yCount: number
  secondsPerPoint?: number
}

/**
 * Compares the current mesh with what the tape needs. The app never changes the
 * printer's probing; it explains the cost of the current density and the ideal
 * one, and lets the user decide (SPEC §5.4).
 */
export function probeAdvice(options: ProbeAdviceOptions): CoreMessage[] {
  const { bounds, tapeWidth, xCount, yCount, secondsPerPoint = 2 } = options
  const messages: CoreMessage[] = []
  const spacingX = xCount > 1 ? (bounds.maxX - bounds.minX) / (xCount - 1) : bounds.maxX - bounds.minX
  const ideal = idealProbeCount(bounds, tapeWidth)

  if (spacingX < 0.5 * tapeWidth) {
    messages.push({
      code: 'probe.notice.overMeasuring',
      params: { ideal: `${ideal.x}×${ideal.y}`, tape: tapeWidth },
    })
  }
  if (spacingX > 1.5 * tapeWidth) {
    messages.push({
      code: 'probe.notice.coarserThanTape',
      params: { probeCount: `${ideal.x}, ${ideal.y}`, tape: tapeWidth },
    })
  }

  const estimate = probeEstimate(bounds, tapeWidth, secondsPerPoint)
  if (estimate.idealX > 25 || estimate.idealY > 25) {
    messages.push({
      code: 'probe.warn.tooMany',
      params: {
        grid: `${estimate.idealX}×${estimate.idealY}`,
        points: estimate.points,
        minutes: Math.round(estimate.minutes),
      },
    })
  }
  // Silence an unused-variable lint when yCount is not part of the comparison yet.
  void yCount
  return messages
}

/** The copy-paste block SPEC §5.4 asks for: only the probe count changes. */
export function bedMeshSnippet(
  bounds: MeshBounds,
  probeX: number,
  probeY: number,
  algorithm = 'bicubic',
): string {
  // Keep fractional mesh bounds exact (229.97 is not 230.0): the snippet is
  // copied into printer.cfg, so it must not shift the probed rectangle.
  const fmt = (value: number): string => String(Number(value.toFixed(2)))
  return [
    '[bed_mesh]',
    `mesh_min: ${fmt(bounds.minX)}, ${fmt(bounds.minY)}`,
    `mesh_max: ${fmt(bounds.maxX)}, ${fmt(bounds.maxY)}`,
    `probe_count: ${probeX}, ${probeY}`,
    `algorithm: ${algorithm}`,
  ].join('\n')
}
