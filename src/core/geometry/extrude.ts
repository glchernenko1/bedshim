import earcut from 'earcut'
import type { MultiPolygon } from './polygon'

export type Vec3 = [number, number, number]
export type Triangle = [Vec3, Vec3, Vec3]

export interface MeshBox {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
}

export interface ManifoldReport {
  vertices: number
  triangles: number
  /** Every undirected edge is used exactly twice, in opposite directions. */
  closed: boolean
  /** The triangles form one connected surface. */
  connected: boolean
  components: number
  /** Edges that are not shared, or shared more than twice. */
  badEdges: number
  degenerateTriangles: number
  /** Signed volume from the divergence theorem, mm³. */
  volume: number
  box: MeshBox
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function signedTriangleVolume(a: Vec3, b: Vec3, c: Vec3): number {
  return dot(a, cross(b, c)) / 6
}

type Point2 = [number, number]

function pointsOnSegment(a: Point2, b: Point2, vertices: readonly Point2[]): Point2[] {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared < 1e-18) return []
  const found: Array<{ t: number; point: Point2 }> = []
  for (const point of vertices) {
    const px = point[0] - a[0]
    const py = point[1] - a[1]
    const crossValue = dx * py - dy * px
    if (Math.abs(crossValue) > 1e-7 * Math.sqrt(lengthSquared)) continue
    const t = (px * dx + py * dy) / lengthSquared
    if (t <= 1e-7 || t >= 1 - 1e-7) continue
    if (found.some((entry) => Math.abs(entry.t - t) < 1e-7)) continue
    found.push({ t, point })
  }
  found.sort((one, two) => one.t - two.t)
  return found.map((entry) => entry.point)
}

/**
 * Earcut can leave T-junctions where a triangle edge runs through vertices of a
 * neighbouring hole (the narrow wall between two cell holes is the usual case).
 * Splitting such a triangle with a fan from its centroid adds those vertices to
 * the edge, so the top and bottom faces share every edge with their neighbours.
 */
function splitAtTjunctions(
  a: Point2,
  b: Point2,
  c: Point2,
  vertices: readonly Point2[],
  height: number,
  triangles: Triangle[],
): void {
  const ab = pointsOnSegment(a, b, vertices)
  const bc = pointsOnSegment(b, c, vertices)
  const ca = pointsOnSegment(c, a, vertices)
  if (ab.length === 0 && bc.length === 0 && ca.length === 0) {
    const top: Triangle = [
      [a[0], a[1], height],
      [b[0], b[1], height],
      [c[0], c[1], height],
    ]
    triangles.push(top)
    triangles.push([
      [top[0][0], top[0][1], 0],
      [top[2][0], top[2][1], 0],
      [top[1][0], top[1][1], 0],
    ])
    return
  }

  const boundary: Point2[] = [a, ...ab, b, ...bc, c, ...ca]
  const centreX = (a[0] + b[0] + c[0]) / 3
  const centreY = (a[1] + b[1] + c[1]) / 3
  for (let index = 0; index < boundary.length; index++) {
    const from = boundary[index]!
    const to = boundary[(index + 1) % boundary.length]!
    const top: Triangle = [
      [centreX, centreY, height],
      [from[0], from[1], height],
      [to[0], to[1], height],
    ]
    triangles.push(top)
    triangles.push([
      [top[0][0], top[0][1], 0],
      [top[2][0], top[2][1], 0],
      [top[1][0], top[1][1], 0],
    ])
  }
}

/**
 * Triangulates a polygon with holes (outer ring first, holes after) and extrudes
 * it from z = 0 to z = height. Winding is fixed so the result is outward-facing:
 * top triangles are CCW, bottom triangles reversed, and side walls follow the
 * normalised ring direction.
 */
export function extrude(multi: MultiPolygon, height: number): Triangle[] {
  const triangles: Triangle[] = []
  if (!(height > 0)) return triangles

  for (const polygon of multi) {
    if (polygon.length === 0) continue
    const vertices: number[] = []
    const polygonVertices: Point2[] = []
    const holeIndices: number[] = []
    for (let ringIndex = 0; ringIndex < polygon.length; ringIndex++) {
      const ring = polygon[ringIndex]!
      if (ring.length < 3) continue
      if (ringIndex > 0) holeIndices.push(vertices.length / 2)
      for (const [x, y] of ring) {
        vertices.push(x, y)
        polygonVertices.push([x, y])
      }
    }
    if (vertices.length < 6) continue

    const indices = earcut(vertices, holeIndices.length > 0 ? holeIndices : null, 2)
    for (let index = 0; index < indices.length; index += 3) {
      const i0 = indices[index]!
      const i1 = indices[index + 1]!
      const i2 = indices[index + 2]!
      const ax = vertices[i0 * 2]!
      const ay = vertices[i0 * 2 + 1]!
      const bx = vertices[i1 * 2]!
      const by = vertices[i1 * 2 + 1]!
      const cx = vertices[i2 * 2]!
      const cy = vertices[i2 * 2 + 1]!
      const area2 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
      if (Math.abs(area2) < 1e-12) continue
      // Earcut may return either winding; the top face must face +Z.
      if (area2 > 0) {
        splitAtTjunctions([ax, ay], [bx, by], [cx, cy], polygonVertices, height, triangles)
      } else {
        splitAtTjunctions([ax, ay], [cx, cy], [bx, by], polygonVertices, height, triangles)
      }
    }

    for (const ring of polygon) {
      if (ring.length < 3) continue
      for (let index = 0; index < ring.length; index++) {
        const a = ring[index]!
        const b = ring[(index + 1) % ring.length]!
        const a0: Vec3 = [a[0], a[1], 0]
        const b0: Vec3 = [b[0], b[1], 0]
        const b1: Vec3 = [b[0], b[1], height]
        const a1: Vec3 = [a[0], a[1], height]
        triangles.push([a0, b0, b1])
        triangles.push([a0, b1, a1])
      }
    }
  }

  return triangles
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

/** Deduplicates vertices by rounded coordinates so identical corners share edges. */
function indexTriangles(triangles: readonly Triangle[]): {
  points: Vec3[]
  faces: Array<[number, number, number]>
  degenerate: number
} {
  const lookup = new Map<string, number>()
  const points: Vec3[] = []
  const faces: Array<[number, number, number]> = []
  let degenerate = 0

  const keyOf = (point: Vec3): string =>
    `${point[0].toFixed(9)}|${point[1].toFixed(9)}|${point[2].toFixed(9)}`
  const indexOf = (point: Vec3): number => {
    const key = keyOf(point)
    const existing = lookup.get(key)
    if (existing !== undefined) return existing
    const index = points.length
    points.push(point)
    lookup.set(key, index)
    return index
  }

  for (const triangle of triangles) {
    const a = indexOf(triangle[0])
    const b = indexOf(triangle[1])
    const c = indexOf(triangle[2])
    if (a === b || b === c || a === c) {
      degenerate++
      continue
    }
    const normal = cross(sub(triangle[1], triangle[0]), sub(triangle[2], triangle[0]))
    if (Math.hypot(normal[0], normal[1], normal[2]) < 1e-12) {
      degenerate++
      continue
    }
    faces.push([a, b, c])
  }

  return { points, faces, degenerate }
}

export function inspectMesh(triangles: readonly Triangle[]): ManifoldReport {
  const { points, faces, degenerate } = indexTriangles(triangles)
  const directed = new Map<string, number>()
  for (const [a, b, c] of faces) {
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const key = `${from}:${to}`
      directed.set(key, (directed.get(key) ?? 0) + 1)
    }
  }

  const undirected = new Set<string>()
  let badEdges = 0
  for (const [key, count] of directed) {
    const [from, to] = key.split(':').map(Number) as [number, number]
    const pair = edgeKey(from, to)
    if (undirected.has(pair)) continue
    undirected.add(pair)
    const reverse = directed.get(`${to}:${from}`) ?? 0
    if (count !== 1 || reverse !== 1) badEdges++
  }

  // Connected components over the vertex graph.
  const parent = Array.from({ length: points.length }, (_, index) => index)
  const find = (value: number): number => {
    let root = value
    while (parent[root] !== root) root = parent[root]!
    while (parent[value] !== value) {
      const next = parent[value]!
      parent[value] = root
      value = next
    }
    return root
  }
  const unite = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }
  for (const [a, b, c] of faces) {
    unite(a, b)
    unite(b, c)
  }
  const roots = new Set<number>()
  for (let index = 0; index < points.length; index++) roots.add(find(index))

  let volume = 0
  const box: MeshBox = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  }
  for (const [a, b, c] of faces) {
    const pa = points[a]!
    const pb = points[b]!
    const pc = points[c]!
    volume += signedTriangleVolume(pa, pb, pc)
    for (const point of [pa, pb, pc]) {
      if (point[0] < box.minX) box.minX = point[0]
      if (point[1] < box.minY) box.minY = point[1]
      if (point[2] < box.minZ) box.minZ = point[2]
      if (point[0] > box.maxX) box.maxX = point[0]
      if (point[1] > box.maxY) box.maxY = point[1]
      if (point[2] > box.maxZ) box.maxZ = point[2]
    }
  }
  if (!Number.isFinite(box.minX)) {
    box.minX = box.minY = box.minZ = box.maxX = box.maxY = box.maxZ = 0
  }

  return {
    vertices: points.length,
    triangles: faces.length,
    closed: badEdges === 0 && faces.length > 0,
    connected: roots.size === 1,
    components: roots.size,
    badEdges,
    degenerateTriangles: degenerate,
    volume,
    box,
  }
}

/** Flips every triangle when the signed volume came out negative. */
export function outward(triangles: Triangle[]): Triangle[] {
  const report = inspectMesh(triangles)
  if (report.volume >= 0) return triangles
  return triangles.map(([a, b, c]) => [a, c, b])
}
