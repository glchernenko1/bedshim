import {
  difference as clipDifference,
  intersection as clipIntersection,
  union as clipUnion,
} from 'polygon-clipping'

/** A closed ring of `[x, y]` points in mm. The first point is not repeated. */
export type Ring = Array<[number, number]>
/** Outer ring first, holes after it. */
export type Polygon = Ring[]
export type MultiPolygon = Polygon[]

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Signed area of a ring: positive for counter-clockwise (in a Y-up frame). */
export function signedArea(ring: Ring): number {
  let area = 0
  for (let index = 0; index < ring.length; index++) {
    const [x0, y0] = ring[index]!
    const [x1, y1] = ring[(index + 1) % ring.length]!
    area += x0 * y1 - x1 * y0
  }
  return area / 2
}

/** Removes the repeated closing point and consecutive duplicates. */
export function cleanRing(ring: Ring): Ring {
  const points: Ring = []
  for (const point of ring) {
    const last = points[points.length - 1]
    if (!last || Math.abs(last[0] - point[0]) > 1e-9 || Math.abs(last[1] - point[1]) > 1e-9) {
      points.push([point[0], point[1]])
    }
  }
  if (points.length > 1) {
    const first = points[0]!
    const last = points[points.length - 1]!
    if (Math.abs(first[0] - last[0]) <= 1e-9 && Math.abs(first[1] - last[1]) <= 1e-9) points.pop()
  }
  return points
}

/** Points a ring in the requested direction. */
export function orient(ring: Ring, counterClockwise: boolean): Ring {
  const points = cleanRing(ring)
  const positive = signedArea(points) >= 0
  return positive === counterClockwise ? points : [...points].reverse()
}

export function rectangle(x0: number, y0: number, x1: number, y1: number): Ring {
  const left = Math.min(x0, x1)
  const right = Math.max(x0, x1)
  const bottom = Math.min(y0, y1)
  const top = Math.max(y0, y1)
  return [
    [left, bottom],
    [right, bottom],
    [right, top],
    [left, top],
  ]
}

export function rectToRing(rect: Rect): Ring {
  return rectangle(rect.x0, rect.y0, rect.x1, rect.y1)
}

/** Outer rings CCW and holes CW, which the extruder relies on for side walls. */
export function normalizePolygon(polygon: Polygon): Polygon {
  if (polygon.length === 0) return []
  const outer = orient(polygon[0]!, true)
  const holes = polygon.slice(1).map((hole) => orient(hole, false))
  return [outer, ...holes].filter((ring) => ring.length >= 3)
}

export function normalizeMultiPolygon(multi: MultiPolygon): MultiPolygon {
  return multi.map(normalizePolygon).filter((polygon) => polygon.length > 0 && polygon[0]!.length >= 3)
}

/** Plate minus a set of hole polygons, with rings normalised for extrusion. */
export function difference(subject: Polygon, holes: readonly Polygon[]): MultiPolygon {
  if (holes.length === 0) return normalizeMultiPolygon([subject])
  const result = clipDifference([subject], holes as unknown as MultiPolygon) as MultiPolygon
  return normalizeMultiPolygon(result)
}

/** Union of stroke rectangles and other glyph pieces. */
export function union(polygons: readonly Polygon[]): MultiPolygon {
  if (polygons.length === 0) return []
  const result = clipUnion(polygons[0]!, ...(polygons.slice(1) as unknown as Polygon[])) as MultiPolygon
  return normalizeMultiPolygon(result)
}

/** Overlap of two whole geometries, including polygons that already have holes. */
export function intersection(a: MultiPolygon, b: MultiPolygon): MultiPolygon {
  if (a.length === 0 || b.length === 0) return []
  const result = clipIntersection(a, b) as MultiPolygon
  return normalizeMultiPolygon(result)
}

/** Subtracts whole geometries (holes are allowed in both operands). */
export function differenceGeom(subject: MultiPolygon, cutters: readonly MultiPolygon[]): MultiPolygon {
  if (subject.length === 0 || cutters.length === 0) return normalizeMultiPolygon(subject)
  const result = clipDifference(subject, ...cutters) as MultiPolygon
  return normalizeMultiPolygon(result)
}

/** Union of whole geometries, including polygons that already have holes. */
export function unionGeoms(parts: ReadonlyArray<Polygon | MultiPolygon>): MultiPolygon {
  if (parts.length === 0) return []
  const result = clipUnion(parts[0]!, ...(parts.slice(1) as Array<Polygon | MultiPolygon>)) as MultiPolygon
  return normalizeMultiPolygon(result)
}

/** Smallest axis-aligned rectangle containing every ring. */
export function boundsOf(multi: MultiPolygon): Rect | null {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const polygon of multi) {
    for (const ring of polygon) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  return Number.isFinite(minX) ? { x0: minX, y0: minY, x1: maxX, y1: maxY } : null
}
