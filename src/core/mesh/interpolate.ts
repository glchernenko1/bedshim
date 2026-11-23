import { CoreError } from '../errors'
import type { CoreMessage } from '../messages'
import type { Mesh, MeshAlgo, MeshBounds } from './types'

/**
 * The interpolated bed surface. `at(x, y)` is the z a nozzle sees at a plate
 * coordinate, in mm, using Klipper's own sampling: bicubic is evaluated into a
 * `mesh_pps` grid, then bilinearly interpolated — the same surface the printer
 * compensates for (SPEC §5.2).
 */
export interface Surface {
  readonly algo: MeshAlgo
  readonly bounds: MeshBounds
  readonly xCount: number
  readonly yCount: number
  readonly sampledX: number
  readonly sampledY: number
  readonly sampled: readonly (readonly number[])[]
  readonly notices: CoreMessage[]
  at(x: number, y: number): number
}

function lerp(t: number, a: number, b: number): number {
  return (1 - t) * a + t * b
}

function cardinal(p0: number, p1: number, p2: number, p3: number, t: number, tension: number): number {
  const t2 = t * t
  const t3 = t2 * t
  const m1 = tension * (p2 - p0)
  const m2 = tension * (p3 - p1)
  return (
    p1 * (2 * t3 - 3 * t2 + 1) +
    p2 * (-2 * t3 + 3 * t2) +
    m1 * (t3 - 2 * t2 + t) +
    m2 * (t3 - t2)
  )
}

interface ControlPoints {
  p0: number
  p1: number
  p2: number
  p3: number
  t: number
}

/** Klipper `_get_x_ctl_pts` / `_get_y_ctl_pts`, with edge control points held. */
function controlPoints(arr: readonly number[], index: number, mult: number): ControlPoints {
  const last = arr.length - 1 - mult
  if (index < mult) {
    return { p0: arr[0]!, p1: arr[0]!, p2: arr[mult]!, p3: arr[2 * mult]!, t: index / mult }
  }
  if (index > last) {
    return {
      p0: arr[last - mult]!,
      p1: arr[last]!,
      p2: arr[last + mult]!,
      p3: arr[last + mult]!,
      t: (index - last) / mult,
    }
  }
  const segment = Math.floor(index / mult)
  return {
    p0: arr[(segment - 1) * mult]!,
    p1: arr[segment * mult]!,
    p2: arr[(segment + 1) * mult]!,
    p3: arr[(segment + 2) * mult]!,
    t: (index - segment * mult) / mult,
  }
}

function sampleBicubic(mesh: Mesh, ppsX: number, ppsY: number): number[][] {
  const { xCount, yCount, points, tension } = mesh
  const xMult = ppsX + 1
  const yMult = ppsY + 1
  const sampledX = (xCount - 1) * ppsX + xCount
  const sampledY = (yCount - 1) * ppsY + yCount
  const grid: number[][] = Array.from({ length: sampledY }, () => new Array<number>(sampledX).fill(0))

  for (let row = 0; row < yCount; row++) {
    for (let col = 0; col < xCount; col++) {
      grid[row * yMult]![col * xMult] = points[row]![col]!
    }
  }

  // Interpolate every probe row along X.
  for (let y = 0; y < sampledY; y += yMult) {
    const line = grid[y]!
    for (let x = 0; x < sampledX; x++) {
      if (x % xMult === 0) continue
      const cp = controlPoints(line, x, xMult)
      line[x] = cardinal(cp.p0, cp.p1, cp.p2, cp.p3, cp.t, tension)
    }
  }

  // Then interpolate every sampled column along Y.
  for (let x = 0; x < sampledX; x++) {
    for (let y = 0; y < sampledY; y++) {
      if (y % yMult === 0) continue
      const last = sampledY - 1 - yMult
      const read = (index: number): number => grid[index]![x]!
      let cp: ControlPoints
      if (y < yMult) {
        cp = { p0: read(0), p1: read(0), p2: read(yMult), p3: read(2 * yMult), t: y / yMult }
      } else if (y > last) {
        cp = {
          p0: read(last - yMult),
          p1: read(last),
          p2: read(last + yMult),
          p3: read(last + yMult),
          t: (y - last) / yMult,
        }
      } else {
        const segment = Math.floor(y / yMult)
        cp = {
          p0: read((segment - 1) * yMult),
          p1: read(segment * yMult),
          p2: read((segment + 1) * yMult),
          p3: read((segment + 2) * yMult),
          t: (y - segment * yMult) / yMult,
        }
      }
      grid[y]![x] = cardinal(cp.p0, cp.p1, cp.p2, cp.p3, cp.t, tension)
    }
  }

  return grid
}

/**
 * Bilinear lookup over a sampled grid. Outside `bounds` the edge value is held,
 * which is what Klipper does: it clamps the index and the parameter (SPEC §1.5).
 */
function makeLookup(
  sampled: readonly (readonly number[])[],
  bounds: MeshBounds,
): (x: number, y: number) => number {
  const sampledX = sampled[0]?.length ?? 0
  const sampledY = sampled.length
  if (sampledX < 2 || sampledY < 2) {
    const only = sampled[0]?.[0] ?? 0
    return () => only
  }
  const xDist = (bounds.maxX - bounds.minX) / (sampledX - 1)
  const yDist = (bounds.maxY - bounds.minY) / (sampledY - 1)
  return (x: number, y: number) => {
    const rawX = Math.floor((x - bounds.minX) / xDist)
    const ix = Math.min(Math.max(rawX, 0), sampledX - 2)
    const tx = Math.min(Math.max((x - (bounds.minX + xDist * ix)) / xDist, 0), 1)
    const rawY = Math.floor((y - bounds.minY) / yDist)
    const iy = Math.min(Math.max(rawY, 0), sampledY - 2)
    const ty = Math.min(Math.max((y - (bounds.minY + yDist * iy)) / yDist, 0), 1)
    const z0 = lerp(tx, sampled[iy]![ix]!, sampled[iy]![ix + 1]!)
    const z1 = lerp(tx, sampled[iy + 1]![ix]!, sampled[iy + 1]![ix + 1]!)
    return lerp(ty, z0, z1)
  }
}

/** Builds the interpolated surface; requires `mesh.bounds` (SPEC §5.1 shape C asks for them). */
export function createSurface(mesh: Mesh): Surface {
  if (!mesh.bounds) throw new CoreError('surface.error.noBounds')
  const bounds = mesh.bounds
  const notices: CoreMessage[] = []

  let algo: MeshAlgo = mesh.algo
  if (algo === 'lagrange' || algo === 'direct') {
    // SPEC §5.2: approximated by bicubic in v1, with a one-line notice.
    notices.push({ code: 'surface.notice.algoApproximated', params: { algo } })
    algo = 'bicubic'
  }
  if (algo === 'bicubic' && (mesh.xCount < 3 || mesh.yCount < 3)) {
    notices.push({ code: 'surface.notice.bilinearFallback' })
    algo = 'bilinear'
  }

  let sampled: number[][]
  if (algo === 'bicubic') {
    const ppsX = Math.max(1, Math.floor(mesh.meshXPps))
    const ppsY = Math.max(1, Math.floor(mesh.meshYPps))
    sampled = sampleBicubic(mesh, ppsX, ppsY)
  } else {
    sampled = mesh.points.map((row) => [...row])
  }

  return {
    algo,
    bounds,
    xCount: mesh.xCount,
    yCount: mesh.yCount,
    sampledX: sampled[0]?.length ?? 0,
    sampledY: sampled.length,
    sampled,
    notices,
    at: makeLookup(sampled, bounds),
  }
}
