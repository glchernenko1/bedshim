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
  const fmt = (value: number): string => (Number.isInteger(value) ? String(value) : value.toFixed(1))
  return [
    '[bed_mesh]',
    `mesh_min: ${fmt(bounds.minX)}, ${fmt(bounds.minY)}`,
    `mesh_max: ${fmt(bounds.maxX)}, ${fmt(bounds.maxY)}`,
    `probe_count: ${probeX}, ${probeY}`,
    `algorithm: ${algorithm}`,
  ].join('\n')
}
