import { EXTEND_LABEL_BORDER, type Grid } from '../grid'
import type { CoreMessage } from '../messages'
import { extrude, inspectMesh, outward, type ManifoldReport, type Triangle } from './extrude'
import { buildLattice, type LatticeResult, type LatticeStyle } from './lattice'
import {
  boundsOf,
  differenceGeom,
  intersection,
  orient,
  rectToRing,
  unionGeoms,
  type MultiPolygon,
  type Rect,
  type Ring,
} from './polygon'

export type LatticePartId = 'TL' | 'TR' | 'BL' | 'BR'

export interface LatticeJoint {
  id: 'top' | 'bottom' | 'left' | 'right'
  axis: 'vertical' | 'horizontal'
  /** Part that carries the tenon (the tab). */
  tenon: LatticePartId
  /** Part that carries the matching mortise (the pocket). */
  mortise: LatticePartId
  /** x for a vertical joint, y for a horizontal one. */
  at: number
  /** Centre of the joint along the seam. */
  centre: number
  /** +1 when the tenon points to +x/+y, -1 otherwise. */
  direction: 1 | -1
  /** Nominal neck width along the seam, mm. */
  width: number
  /** Nominal depth across the seam, mm. */
  depth: number
  /** Nominal width of the flared head along the seam, mm. */
  tip: number
  /** Actual clearance applied to the tenon, mm. */
  clearance: number
  /** Solid frame band the joint sits in, mm. */
  band: number
}

export interface LatticePart {
  id: LatticePartId
  /** 1-based position in the download list. */
  index: number
  /** Human-readable position, stable for the UI. */
  position: 'backLeft' | 'backRight' | 'frontLeft' | 'frontRight'
  outline: MultiPolygon
  triangles: Triangle[]
  manifold: ManifoldReport
  /** Bounds in the assembled sheet, for the preview. */
  sheet: Rect
}

/**
 * Separate cross key for the centre. It sits on top of the four cut walls: the
 * cross-shaped tunnel on its underside receives the walls, and the solid top
 * connects the four quadrants.
 */
export interface LatticeCross {
  /** Top face of the cross, in assembled coordinates. */
  outline: MultiPolygon
  triangles: Triangle[]
  /** Same solid in assembled coordinates, for the combined preview mesh. */
  assembledTriangles: Triangle[]
  manifold: ManifoldReport
  sheet: Rect
  /** Width of the cross-shaped tunnel (sum of the two cut half-walls + offset). */
  slot: number
  /** Arm half-length from the centre, mm. */
  arm: number
  /** Overall width of one arm, mm. */
  armWidth: number
  /** Thickness of the top skin, mm. */
  thickness: number
  clearance: number
}

export interface CompositeLatticeOptions {
  /** Clearance added only to the outer dovetail tenons, mm. Default 0. */
  clearance?: number
  /** Clearance inside the centre cross tunnel, mm. Default 0. */
  centerClearance?: number
}

export interface CompositeLatticeResult {
  parts: LatticePart[]
  cross: LatticeCross | null
  /** The assembled sheet (the full lattice). */
  sheet: Rect
  splitX: number
  splitY: number
  joints: LatticeJoint[]
  clearance: number
  centerClearance: number
  /** Four parts plus the cross, in assembled coordinates. */
  triangles: Triangle[]
  manifold: ManifoldReport
  warnings: CoreMessage[]
}

/** Keep the split away from the outer edge by at least this much. */
const MIN_PART = 15

interface JointSize {
  /** Neck width along the seam. */
  width: number
  /** Head width along the seam. */
  tip: number
  /** Protrusion across the seam. */
  depth: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Move one part to the origin so a slicer places it on the bed. */
function toOrigin(triangles: readonly Triangle[]): Triangle[] {
  if (triangles.length === 0) return []
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  for (const triangle of triangles) {
    for (const [x, y] of triangle) {
      if (x < minX) minX = x
      if (y < minY) minY = y
    }
  }
  return triangles.map((triangle) => {
    const [a, b, c] = triangle
    return [
      [a[0] - minX, a[1] - minY, a[2]],
      [b[0] - minX, b[1] - minY, b[2]],
      [c[0] - minX, c[1] - minY, c[2]],
    ] as Triangle
  })
}

function rectPolygon(rect: Rect): MultiPolygon {
  return [[orient(rectToRing(rect), true)]]
}

function ringPolygon(points: Ring): MultiPolygon {
  return [[orient(points, true)]]
}

function translateZ(triangles: readonly Triangle[], dz: number): Triangle[] {
  return triangles.map((triangle) => {
    const [a, b, c] = triangle
    return [
      [a[0], a[1], a[2] + dz],
      [b[0], b[1], b[2] + dz],
      [c[0], c[1], c[2] + dz],
    ] as Triangle
  })
}

function hasFlatZ(triangle: Triangle, z: number): boolean {
  return triangle.every((vertex) => Math.abs(vertex[2] - z) < 1e-7)
}

function normalZ(triangle: Triangle): number {
  const [a, b, c] = triangle
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

/** Drop the top (+Z) or bottom (−Z) face, keeping the side walls. */
function withoutFace(triangles: readonly Triangle[], z: number, top: boolean): Triangle[] {
  return triangles.filter((triangle) => {
    if (!hasFlatZ(triangle, z)) return true
    return top ? normalZ(triangle) < 0 : normalZ(triangle) > 0
  })
}

/** Pick the cell boundary closest to the middle of the sheet. */
function splitLine(grid: Grid, axis: 'x' | 'y', sheet: Rect, warnings: CoreMessage[]): number {
  const low = axis === 'x' ? sheet.x0 : sheet.y0
  const high = axis === 'x' ? sheet.x1 : sheet.y1
  const target = (low + high) / 2
  const values = new Set<number>()
  for (const cell of grid.cells) {
    values.add(axis === 'x' ? cell.x0 : cell.y0)
    values.add(axis === 'x' ? cell.x1 : cell.y1)
  }
  const usable = [...values]
    .filter((value) => value > low + MIN_PART && value < high - MIN_PART)
    .sort((a, b) => Math.abs(a - target) - Math.abs(b - target))
  if (usable[0] !== undefined) return usable[0]

  // One very wide cell, or a sheet barely larger than the grid: fall back to
  // the geometric middle and warn, because that cut runs through a cell.
  warnings.push({
    code: 'lattice.warn.compositeNoGridLine',
    params: { axis: axis === 'x' ? 'X' : 'Y' },
  })
  return clamp(target, low + MIN_PART, high - MIN_PART)
}

/** Solid band at the sheet edge: frame ring, label border or tight margin. */
function solidBand(base: LatticeResult, grid: Grid): number {
  if (base.framed) return clamp(base.style.frame, 1.5, 12)
  if (grid.extendToPlate) return EXTEND_LABEL_BORDER
  return clamp(base.style.margin, 0.4, 12)
}

/**
 * The dovetail sits in the solid outer band. Its head runs along the seam and
 * must stay inside the band; its depth runs along the edge, where the frame is
 * continuous.
 */
function outerJointSize(band: number): JointSize | null {
  const head = Math.min(band - 1.8, 6)
  if (head < 2.5) return null
  return {
    width: Math.max(1.2, head - 2),
    tip: head,
    depth: clamp(head * 1.5, 4, 8),
  }
}

/** Keep the FRONT marker away from the bottom dovetail. */
function safeFrontCentre(splitX: number, sheet: Rect, depth: number): number {
  const margin = Math.max(10, depth + 8)
  const low = sheet.x0 + 8
  const high = sheet.x1 - 8
  const left = clamp(sheet.x0 + (sheet.x1 - sheet.x0) * 0.25, low, high)
  const right = clamp(sheet.x0 + (sheet.x1 - sheet.x0) * 0.75, low, high)
  const chosen = Math.abs(left - splitX) >= Math.abs(right - splitX) ? left : right
  if (Math.abs(chosen - splitX) >= margin) return chosen
  return splitX < (sheet.x0 + sheet.x1) / 2 ? high : low
}

/**
 * The tenon as a flat dovetail. `clearance` is a perpendicular offset of the
 * flared sides and the tip; the base stays on the seam so the tab remains
 * attached to its part. The mortise uses the nominal shape, so only the tenon
 * gets the gap.
 */
function jointPoints(size: JointSize, clearance: number, direction: 1 | -1, attachment = 0): Ring {
  const neck = size.width / 2
  const tip = size.tip / 2
  const depth = Math.max(0.2, size.depth)
  const slope = (tip - neck) / depth
  const sideOffset = clearance * Math.sqrt(1 + slope * slope)
  const neckReal = Math.max(0.15, neck - sideOffset)
  const tipReal = Math.max(neckReal + 0.15, tip - slope * clearance - sideOffset)
  const tipDepth = Math.max(0.2, depth - clearance)
  const base = -direction * attachment
  return [
    [base, -neckReal],
    [direction * tipDepth, -tipReal],
    [direction * tipDepth, tipReal],
    [base, neckReal],
  ]
}

function jointMap(axis: 'vertical' | 'horizontal', at: number, centre: number, points: Ring): Ring {
  return points.map(([u, v]) =>
    axis === 'vertical'
      ? ([at + u, centre + v] as [number, number])
      : ([centre + v, at + u] as [number, number]),
  )
}

/** A plus-shaped ring; `slot` adds collinear points on the four end edges. */
function plusRing(halfWidth: number, halfLength: number, slot = 0): Ring {
  const w = halfWidth
  const l = halfLength
  const s = Math.min(slot, w)
  const top: Ring = s > 0 ? [[w, l], [s, l], [-s, l], [-w, l]] : [[w, l], [-w, l]]
  const left: Ring = s > 0 ? [[-l, w], [-l, s], [-l, -s], [-l, -w]] : [[-l, w], [-l, -w]]
  const bottom: Ring = s > 0 ? [[-w, -l], [-s, -l], [s, -l], [w, -l]] : [[-w, -l], [w, -l]]
  const right: Ring = s > 0 ? [[l, -w], [l, -s], [l, s], [l, w]] : [[l, -w], [l, w]]
  return [
    [w, w],
    ...top,
    [-w, w],
    ...left,
    [-w, -w],
    ...bottom,
    [w, -w],
    ...right,
  ]
}

const POSITION: Record<LatticePartId, LatticePart['position']> = {
  TL: 'backLeft',
  TR: 'backRight',
  BL: 'frontLeft',
  BR: 'frontRight',
}

interface CrossCells {
  width: number
  height: number
}

/** Dimensions of the four cell holes around the centre crossing. */
function crossCells(grid: Grid, x: number, y: number): CrossCells | null {
  const widths: number[] = []
  const heights: number[] = []
  for (const cell of grid.cells) {
    const touchesX = Math.abs(cell.x0 - x) < 1e-6 || Math.abs(cell.x1 - x) < 1e-6
    const touchesY = Math.abs(cell.y0 - y) < 1e-6 || Math.abs(cell.y1 - y) < 1e-6
    if (touchesX && touchesY) {
      widths.push(cell.x1 - cell.x0)
      heights.push(cell.y1 - cell.y0)
    }
  }
  if (widths.length < 2 || heights.length < 2) return null
  return { width: Math.min(...widths), height: Math.min(...heights) }
}

/**
 * Cross-shaped key that fills the four cell holes around the centre. Its
 * underside has a cross tunnel that receives the four cut half-walls; the solid
 * top joins the four quadrants.
 */
function buildCenterCross(
  base: LatticeResult,
  grid: Grid,
  splitX: number,
  splitY: number,
  centerClearance: number,
  warnings: CoreMessage[],
): LatticeCross | null {
  const wall = base.style.wallThickness
  const height = base.style.height
  const cells = crossCells(grid, splitX, splitY)
  if (!cells) {
    warnings.push({ code: 'lattice.warn.crossNoCells' })
    return null
  }
  const holeW = cells.width - wall
  const holeH = cells.height - wall
  const span = Math.min(holeW, holeH)
  // Long, thin arms: they run almost the whole cell along the seams but take
  // little width from the four centre cells.
  const arm = clamp(span * 0.44, 1.5, 8.5)
  // The outer body stays fixed; only the tunnel widens with its clearance.
  const armWidth = clamp(wall + 2 * Math.max(1.4, span * 0.08), wall + 2.8, 4.4)
  const slot = Math.min(
    wall + 2 * Math.max(0, centerClearance),
    // Keep at least 0.8 mm of solid rail on each side of the tunnel.
    Math.max(wall, armWidth - 1.6),
  )
  if (arm <= slot / 2 + 1 || armWidth - slot < 1.6) {
    warnings.push({ code: 'lattice.warn.crossNoRoom' })
    return null
  }
  const actualClearance = Math.max(0, (slot - wall) / 2)

  const atCentre = (points: Ring): Ring =>
    points.map(([x, y]) => [x + splitX, y + splitY] as [number, number])
  const outer = ringPolygon(atCentre(plusRing(armWidth / 2, arm, slot / 2)))
  const tunnel = ringPolygon(atCentre(plusRing(slot / 2, arm)))
  const legs = differenceGeom(outer, [tunnel])
  if (legs.length === 0) {
    warnings.push({ code: 'lattice.warn.crossNoRoom' })
    return null
  }

  const thickness = Math.max(0.4, height)
  // Legs stand on the bed; the top skin spans them and closes the tunnel.
  const legTriangles = translateZ(withoutFace(extrude(legs, height), height, true), 0)
  const skinTriangles = translateZ(withoutFace(extrude(outer, thickness), 0, false), height)
  const ceiling = translateZ(
    extrude(tunnel, 1).filter((triangle) => hasFlatZ(triangle, 0)),
    height,
  )
  const assembled = [...legTriangles, ...skinTriangles, ...ceiling]
  const triangles = toOrigin(assembled)
  const manifold = inspectMesh(triangles)
  if (!manifold.closed) {
    warnings.push({ code: 'lattice.warn.crossNotClosed', params: { edges: manifold.badEdges } })
  }
  if (!manifold.connected) {
    warnings.push({ code: 'lattice.warn.crossDisconnected', params: { parts: manifold.components } })
  }
  const sheet = boundsOf(outer) ?? { x0: splitX - arm, y0: splitY - arm, x1: splitX + arm, y1: splitY + arm }
  return {
    outline: outer,
    triangles,
    assembledTriangles: assembled,
    manifold,
    sheet,
    slot,
    arm,
    armWidth,
    thickness,
    clearance: actualClearance,
  }
}

/**
 * Split the finished lattice into four printable quadrants. The cuts run along
 * the cell boundary nearest the middle. Dovetails sit in the solid outer band
 * at the four ends of the seams; a separate cross key fills the centre holes
 * and locks the quadrants together.
 */
export function buildCompositeLattice(
  grid: Grid,
  style: LatticeStyle = {},
  options: CompositeLatticeOptions = {},
): CompositeLatticeResult {
  const provisional = buildLattice(grid, { ...style, front: false })
  const sheet = provisional.sheet
  const splitWarnings: CoreMessage[] = []
  const splitX = splitLine(grid, 'x', sheet, splitWarnings)
  const splitY = splitLine(grid, 'y', sheet, splitWarnings)

  const band = solidBand(provisional, grid)
  const size = outerJointSize(band)
  const frontCentre = size ? safeFrontCentre(splitX, sheet, size.depth) : undefined
  const base = buildLattice(grid, { ...style, frontCentre })
  const warnings: CoreMessage[] = [...base.warnings, ...splitWarnings]

  const rects: Record<LatticePartId, Rect> = {
    TL: { x0: sheet.x0, y0: splitY, x1: splitX, y1: sheet.y1 },
    TR: { x0: splitX, y0: splitY, x1: sheet.x1, y1: sheet.y1 },
    BL: { x0: sheet.x0, y0: sheet.y0, x1: splitX, y1: splitY },
    BR: { x0: splitX, y0: sheet.y0, x1: sheet.x1, y1: splitY },
  }

  const definitions: Array<{
    id: LatticeJoint['id']
    axis: 'vertical' | 'horizontal'
    tenon: LatticePartId
    mortise: LatticePartId
    at: number
    centre: number
    direction: 1 | -1
  }> = [
    {
      id: 'top',
      axis: 'vertical',
      tenon: 'TL',
      mortise: 'TR',
      at: splitX,
      centre: sheet.y1 - band / 2,
      direction: 1,
    },
    {
      id: 'bottom',
      axis: 'vertical',
      tenon: 'BR',
      mortise: 'BL',
      at: splitX,
      centre: sheet.y0 + band / 2,
      direction: -1,
    },
    {
      id: 'left',
      axis: 'horizontal',
      tenon: 'BL',
      mortise: 'TL',
      at: splitY,
      centre: sheet.x0 + band / 2,
      direction: 1,
    },
    {
      id: 'right',
      axis: 'horizontal',
      tenon: 'TR',
      mortise: 'BR',
      at: splitY,
      centre: sheet.x1 - band / 2,
      direction: -1,
    },
  ]

  const clearance = Math.max(0, options.clearance ?? 0)
  const joints: LatticeJoint[] = []
  const tenonPoints = new Map<LatticePartId, Ring[]>()
  const mortisePoints = new Map<LatticePartId, Ring[]>()

  for (const definition of definitions) {
    if (!size) {
      warnings.push({
        code: 'lattice.warn.compositePlainSeam',
        params: { a: definition.tenon, b: definition.mortise },
      })
      continue
    }
    const actual = clamp(clearance, 0, size.width * 0.25)
    const tenon = jointMap(
      definition.axis,
      definition.at,
      definition.centre,
      jointPoints(size, actual, definition.direction, 0.02),
    )
    const mortise = jointMap(
      definition.axis,
      definition.at,
      definition.centre,
      jointPoints(size, 0, definition.direction, 0.02),
    )
    const listTenon = tenonPoints.get(definition.tenon) ?? []
    listTenon.push(tenon)
    tenonPoints.set(definition.tenon, listTenon)
    const listMortise = mortisePoints.get(definition.mortise) ?? []
    listMortise.push(mortise)
    mortisePoints.set(definition.mortise, listMortise)
    joints.push({
      id: definition.id,
      axis: definition.axis,
      tenon: definition.tenon,
      mortise: definition.mortise,
      at: definition.at,
      centre: definition.centre,
      direction: definition.direction,
      width: size.width,
      depth: size.depth,
      tip: size.tip,
      clearance: actual,
      band,
    })
  }

  const parts: LatticePart[] = []
  const allTriangles: Triangle[] = []
  const ids: LatticePartId[] = ['TL', 'TR', 'BL', 'BR']

  for (const [order, id] of ids.entries()) {
    let region: MultiPolygon = rectPolygon(rects[id])
    const tenons = tenonPoints.get(id) ?? []
    if (tenons.length > 0) region = unionGeoms([region, ...tenons.map((ring) => ringPolygon(ring))])
    const mortises = mortisePoints.get(id) ?? []
    if (mortises.length > 0) {
      region = differenceGeom(region, mortises.map((ring) => ringPolygon(ring)))
    }
    const outline = intersection(base.outline, region)
    if (outline.length === 0) {
      warnings.push({ code: 'lattice.warn.compositeEmptyPart', params: { part: id } })
      continue
    }
    const assembled = outward(extrude(outline, base.style.height))
    const triangles = toOrigin(assembled)
    const manifold = inspectMesh(triangles)
    const partSheet = boundsOf(outline) ?? rects[id]
    if (!manifold.closed) {
      warnings.push({
        code: 'lattice.warn.partNotClosed',
        params: { part: id, edges: manifold.badEdges },
      })
    }
    if (!manifold.connected) {
      warnings.push({
        code: 'lattice.warn.partDisconnected',
        params: { part: id, parts: manifold.components },
      })
    }
    parts.push({
      id,
      index: order + 1,
      position: POSITION[id],
      outline,
      triangles,
      manifold,
      sheet: partSheet,
    })
    allTriangles.push(...assembled)
  }

  const centerClearance = Math.max(0, options.centerClearance ?? 0)
  const cross = buildCenterCross(base, grid, splitX, splitY, centerClearance, warnings)
  if (cross) allTriangles.push(...cross.assembledTriangles)

  const combined = inspectMesh(allTriangles)
  return {
    parts,
    cross,
    sheet,
    splitX,
    splitY,
    joints,
    clearance,
    centerClearance,
    triangles: allTriangles,
    manifold: combined,
    warnings,
  }
}

/** 1:1 preview: four quadrants pulled apart, with the centre cross marked. */
export function buildCompositeSvg(result: CompositeLatticeResult, gap = 8): string {
  const { parts, cross, sheet } = result
  if (parts.length === 0) return ''
  const hasLeft = parts.some((part) => part.id === 'TL' || part.id === 'BL')
  const hasRight = parts.some((part) => part.id === 'TR' || part.id === 'BR')
  const hasTop = parts.some((part) => part.id === 'TL' || part.id === 'TR')
  const hasBottom = parts.some((part) => part.id === 'BL' || part.id === 'BR')
  const shiftX = hasLeft && hasRight ? gap : 0
  const shiftY = hasTop && hasBottom ? gap : 0

  const width = sheet.x1 - sheet.x0 + shiftX
  const height = sheet.y1 - sheet.y0 + shiftY
  if (!(width > 0) || !(height > 0)) return ''
  const ox = sheet.x0
  const oy = sheet.y1 + shiftY
  const mm = (value: number): string => String(Math.round(value * 1000) / 1000)
  const sx = (x: number): string => mm(x - ox)
  const sy = (y: number): string => mm(oy - y)
  const colours = ['#d9d9d9', '#cfcfcf', '#c6c6c6', '#bdbdbd']

  const pathOf = (outline: MultiPolygon, dx: number, dy: number): string =>
    outline
      .map((polygon) =>
        polygon
          .map((ring) => {
            const commands = ring.map(
              ([x, y], pointIndex) => `${pointIndex === 0 ? 'M' : 'L'} ${sx(x + dx)} ${sy(y + dy)}`,
            )
            return `${commands.join(' ')} Z`
          })
          .join(' '),
      )
      .join(' ')

  const paths = parts.map((part, index) => {
    const dx = part.id === 'TR' || part.id === 'BR' ? shiftX : 0
    const dy = part.id === 'TL' || part.id === 'TR' ? shiftY : 0
    return `<path d="${pathOf(part.outline, dx, dy)}" fill="${colours[index % colours.length]}" fill-rule="evenodd" stroke="#616161" stroke-width="0.2"/>`
  })

  const labels = parts
    .map((part) => {
      const dx = part.id === 'TR' || part.id === 'BR' ? shiftX : 0
      const dy = part.id === 'TL' || part.id === 'TR' ? shiftY : 0
      const x = sx((part.sheet.x0 + part.sheet.x1) / 2 + dx)
      const y = sy((part.sheet.y0 + part.sheet.y1) / 2 + dy)
      return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-family="system-ui, sans-serif" font-size="6" fill="#7a7a7a">${part.index}</text>`
    })
    .join('\n')

  const crossPath = cross
    ? `<path d="${pathOf(cross.outline, 0, 0)}" fill="#f5b041" fill-opacity="0.85" fill-rule="evenodd" stroke="#b9770e" stroke-width="0.3"/>\n` +
      `<text x="${sx((cross.sheet.x0 + cross.sheet.x1) / 2)}" y="${sy((cross.sheet.y0 + cross.sheet.y1) / 2)}" text-anchor="middle" dominant-baseline="middle" font-family="system-ui, sans-serif" font-size="5" fill="#5b3a00">C</text>`
    : ''

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${mm(width)}mm" height="${mm(height)}mm" viewBox="0 0 ${mm(width)} ${mm(height)}">`,
    `<rect width="${mm(width)}" height="${mm(height)}" fill="#ffffff"/>`,
    ...paths,
    crossPath,
    labels,
    '</svg>',
  ].join('\n')
}
