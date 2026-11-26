import type { Grid } from '../grid'
import type { CoreMessage } from '../messages'
import { extrude, inspectMesh, outward, type ManifoldReport, type Triangle } from './extrude'
import {
  difference,
  orient,
  rectangle,
  unionGeoms,
  type MultiPolygon,
  type Polygon,
  type Rect,
  type Ring,
} from './polygon'

export interface LatticeStyle {
  /** Printed wall between two cell holes, mm. Default 0.8 (two 0.4 perimeters). */
  wallThickness?: number
  /** Plate thickness, mm. Default 0.6 (three 0.2 layers). */
  height?: number
  /** Cut a FRONT arrow or notch. Default true. */
  front?: boolean
  /**
   * 'auto' uses the frame + bridges when the cell grid is inset from the plate
   * by more than 5 mm, otherwise a tight grid. 'frame', 'grid' and 'plate'
   * force one shape. Default 'auto'.
   */
  outline?: 'auto' | 'frame' | 'grid' | 'plate'
  /** Border around the grid for the tight outline, mm. Default 5. */
  margin?: number
  /** Thickness of the outer frame in the frame design, mm. Default 6. */
  frame?: number
  /** Solid rim around the cell holes, mm. Default 2. */
  rim?: number
  /** Bridges per side. Default 4. */
  bridges?: number
  /** Width of one bridge, mm. Default 2. */
  bridgeWidth?: number
  /** Cut row/column stencil labels in the cell rim. Default true. */
  labels?: boolean
  /**
   * X centre of the FRONT arrow/notch. Defaults to the sheet centre. The
   * composite lattice moves it away from the split so the edge dovetail has
   * solid frame material.
   */
  frontCentre?: number
}

export interface LatticeResult {
  triangles: Triangle[]
  manifold: ManifoldReport
  style: Required<LatticeStyle>
  /** Rectangle of the sheet in plate coordinates. */
  sheet: Rect
  /** 2D sheet with every cutout. */
  outline: MultiPolygon
  /** True when the full-plate frame + bridges design was used. */
  framed: boolean
  warnings: CoreMessage[]
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function cellBounds(grid: Grid): Rect {
  return {
    x0: Math.min(...grid.cells.map((cell) => cell.x0)),
    y0: Math.min(...grid.cells.map((cell) => cell.y0)),
    x1: Math.max(...grid.cells.map((cell) => cell.x1)),
    y1: Math.max(...grid.cells.map((cell) => cell.y1)),
  }
}

/** Axis-aligned rounded rectangle, used for bridges (light fillet, no sharp corners). */
function roundedRect(x0: number, y0: number, x1: number, y1: number, radius: number, segments = 4): Polygon {
  const r = Math.min(radius, (x1 - x0) / 2, (y1 - y0) / 2)
  const points: Ring = []
  const pushArc = (cx: number, cy: number, from: number, to: number): void => {
    for (let index = 0; index <= segments; index++) {
      const angle = from + ((to - from) * index) / segments
      points.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)])
    }
  }
  points.push([x0 + r, y0])
  pushArc(x1 - r, y0 + r, -Math.PI / 2, 0)
  pushArc(x1 - r, y1 - r, 0, Math.PI / 2)
  pushArc(x0 + r, y1 - r, Math.PI / 2, Math.PI)
  pushArc(x0 + r, y0 + r, Math.PI, (3 * Math.PI) / 2)
  return [orient(points, true)]
}

/** 3×5 stencil pixels for the labels used on the cell rim (A–J, 0–9). */
const PIXEL_GLYPHS: Record<string, readonly string[]> = {
  A: ['010', '101', '111', '101', '101'],
  B: ['110', '101', '110', '101', '110'],
  C: ['011', '100', '100', '100', '011'],
  D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'],
  F: ['111', '100', '110', '100', '100'],
  G: ['011', '100', '101', '101', '011'],
  H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'],
  J: ['001', '001', '001', '101', '010'],
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
}

/**
 * Pixel-stencil text as isolated square holes. A 3×5 glyph at 5 mm height gives
 * 1 mm pitch, 0.62 mm holes and 0.38 mm walls — printable with a 0.4 nozzle and
 * with no floating counters (unlike a closed outline font).
 */
function pixelLabelHoles(text: string, centreX: number, centreY: number, height = 5): Polygon[] {
  const pitch = height / 5
  const hole = pitch * 0.62
  const glyphWidth = pitch * 3
  const spacing = pitch * 1.1
  const total = text.length * glyphWidth + (text.length - 1) * spacing
  const left = centreX - total / 2
  const bottom = centreY - height / 2
  const holes: Polygon[] = []
  for (let charIndex = 0; charIndex < text.length; charIndex++) {
    const bitmap = PIXEL_GLYPHS[text[charIndex]!] ?? PIXEL_GLYPHS['?'] ?? []
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        if (bitmap[row]?.[col] !== '1') continue
        const x = left + charIndex * (glyphWidth + spacing) + col * pitch + (pitch - hole) / 2
        const y = bottom + (4 - row) * pitch + (pitch - hole) / 2
        holes.push([orient(rectangle(x, y, x + hole, y + hole), true)])
      }
    }
  }
  return holes
}

/** A solid strip between the cell grid and the sheet edge: [low, high]. */
type Band = readonly [number, number]

/**
 * Column numbers on the top/bottom bands and row letters on the left/right
 * bands. A side whose band is too narrow for the glyph is simply skipped, so
 * the same helper serves the framed design (labels in the cell rim) and the
 * extended tight sheet (labels in the plate border).
 */
function cellLabelHoles(
  grid: Grid,
  labelHeight: number,
  bands: { top?: Band; bottom?: Band; left?: Band; right?: Band },
): Polygon[] {
  if (labelHeight <= 2.5) return []
  const columns = new Map<number, number>()
  for (const cell of grid.cells) {
    if (!columns.has(cell.col)) columns.set(cell.col, (cell.x0 + cell.x1) / 2)
  }
  const rows = new Map<number, { centreY: number; label: string }>()
  for (const cell of grid.cells) {
    if (!rows.has(cell.row)) {
      rows.set(cell.row, {
        centreY: (cell.y0 + cell.y1) / 2,
        label: cell.label.replace(/\d+$/, ''),
      })
    }
  }
  const holes: Polygon[] = []
  const numbers = (band: Band): void => {
    if (band[1] - band[0] < labelHeight + 0.8) return
    const centreY = (band[0] + band[1]) / 2
    for (const [col, centreX] of columns) {
      holes.push(...pixelLabelHoles(String(col + 1), centreX, centreY, labelHeight))
    }
  }
  const letters = (band: Band): void => {
    if (band[1] - band[0] < labelHeight * 0.7) return
    const centreX = (band[0] + band[1]) / 2
    for (const { centreY, label } of rows.values()) {
      holes.push(...pixelLabelHoles(label, centreX, centreY, labelHeight))
    }
  }
  if (bands.top) numbers(bands.top)
  if (bands.bottom) numbers(bands.bottom)
  if (bands.left) letters(bands.left)
  if (bands.right) letters(bands.right)
  return holes
}

/** Arrow cut in the front margin of a plate-sized sheet. */
function frontArrow(plateW: number, margin: number, frontCentre?: number): Polygon | null {
  if (margin < 2.5) return null
  const centre = frontCentre ?? plateW / 2
  const bottom = Math.max(0.8, Math.min(margin - 1.5, margin * 0.25))
  const top = Math.min(margin - 1, margin * 0.75)
  const shaft = Math.min(1.2, (top - bottom) * 0.18)
  const head = Math.min(4.5, (top - bottom) * 0.55, plateW * 0.04)
  if (top - bottom < 1) return null
  const points: Array<[number, number]> = [
    [centre - shaft, top],
    [centre + shaft, top],
    [centre + shaft, bottom + (top - bottom) * 0.45],
    [centre + head, bottom + (top - bottom) * 0.45],
    [centre, bottom],
    [centre - head, bottom + (top - bottom) * 0.45],
    [centre - shaft, bottom + (top - bottom) * 0.45],
  ]
  return [orient(points, true)]
}

/** V-shaped notch in the front edge, used for tight sheets and the frame. */
function edgeNotch(sheet: Rect, depth = 2.5, frontCentre?: number): Polygon | null {
  const width = Math.min(3, (sheet.x1 - sheet.x0) * 0.06)
  if (depth < 0.8 || width < 0.8) return null
  const centre = frontCentre ?? (sheet.x0 + sheet.x1) / 2
  return [orient([[centre - width, sheet.y0], [centre + width, sheet.y0], [centre, sheet.y0 + depth]], true)]
}

function cellHoles(grid: Grid, wallThickness: number): Polygon[] {
  const holes: Polygon[] = []
  const inset = wallThickness / 2
  for (const cell of grid.cells) {
    const x0 = cell.x0 + inset
    const y0 = cell.y0 + inset
    const x1 = cell.x1 - inset
    const y1 = cell.y1 - inset
    if (x1 - x0 < 0.1 || y1 - y0 < 0.1) continue
    holes.push([orient(rectangle(x0, y0, x1, y1), true)])
  }
  return holes
}

interface Shape {
  outline: MultiPolygon
  sheet: Rect
}

function buildSimple(
  grid: Grid,
  holes: Polygon[],
  mode: 'grid' | 'plate',
  margin: number,
  front: boolean,
  labels: boolean,
  frontCentre?: number,
): Shape | null {
  const plate = grid.plate
  const cells = cellBounds(grid)
  // An extended grid already reaches the label border; the sheet is the plate,
  // so the border becomes the printable space for numbers and letters.
  const fullPlate = mode === 'plate' || grid.extendToPlate
  const sheet: Rect = fullPlate
    ? { x0: 0, y0: 0, x1: plate.w, y1: plate.h }
    : {
        x0: Math.max(0, cells.x0 - margin),
        y0: Math.max(0, cells.y0 - margin),
        x1: Math.min(plate.w, cells.x1 + margin),
        y1: Math.min(plate.h, cells.y1 + margin),
      }
  if (sheet.x1 - sheet.x0 < 1 || sheet.y1 - sheet.y0 < 1) return null
  const labelHoles: Polygon[] = []
  if (labels && grid.extendToPlate) {
    const bands = {
      top: [cells.y1, sheet.y1] as Band,
      bottom: [sheet.y0, cells.y0] as Band,
      left: [sheet.x0, cells.x0] as Band,
      right: [cells.x1, sheet.x1] as Band,
    }
    const widest = Math.max(
      bands.top[1] - bands.top[0],
      bands.bottom[1] - bands.bottom[0],
      bands.left[1] - bands.left[0],
      bands.right[1] - bands.right[0],
    )
    labelHoles.push(...cellLabelHoles(grid, Math.min(5, widest - 0.8), bands))
  }
  const cutouts = [...holes, ...labelHoles]
  if (front) {
    const marker =
      mode === 'plate'
        ? frontArrow(sheet.x1 - sheet.x0, grid.meshBounds.minY, frontCentre)
        : edgeNotch(sheet, 2.5, frontCentre)
    if (marker) cutouts.push(marker)
  }
  return { outline: difference([orient(rectangle(sheet.x0, sheet.y0, sheet.x1, sheet.y1), true)], cutouts), sheet }
}

/**
 * Full-plate frame with a cut-out gap and bridges to the inner lattice. The
 * frame gives positioning and a place for labels; the bridges only locate the
 * lattice and carry no load.
 */
function buildFrame(
  grid: Grid,
  holes: Polygon[],
  style: Required<LatticeStyle>,
): Shape | null {
  const plate = grid.plate
  const cells = cellBounds(grid)
  const frame = clamp(style.frame, 1.5, Math.min(plate.w, plate.h) / 4)
  const rim = clamp(style.rim, 0.4, Math.min(plate.w, plate.h) / 6)
  const innerFrame: Rect = { x0: frame, y0: frame, x1: plate.w - frame, y1: plate.h - frame }
  const rimRect: Rect = {
    x0: Math.max(innerFrame.x0, cells.x0 - rim),
    y0: Math.max(innerFrame.y0, cells.y0 - rim),
    x1: Math.min(innerFrame.x1, cells.x1 + rim),
    y1: Math.min(innerFrame.y1, cells.y1 + rim),
  }
  if (rimRect.x1 - rimRect.x0 < 2 || rimRect.y1 - rimRect.y0 < 2) return null

  const width = clamp(style.bridgeWidth, 0.8, 4)
  const mergeGap = Math.max(3, width * 1.5)

  // Where the gap is too narrow for a clean bridge, fuse the lattice rim with
  // the frame instead of leaving a tiny tab. The left side of the fixture is
  // the usual case.
  if (rimRect.x0 - innerFrame.x0 < mergeGap) innerFrame.x0 = rimRect.x0
  if (innerFrame.x1 - rimRect.x1 < mergeGap) innerFrame.x1 = rimRect.x1
  if (rimRect.y0 - innerFrame.y0 < mergeGap) innerFrame.y0 = rimRect.y0
  if (innerFrame.y1 - rimRect.y1 < mergeGap) innerFrame.y1 = rimRect.y1

  const notch = style.front
    ? edgeNotch({ x0: 0, y0: 0, x1: plate.w, y1: plate.h }, 2.5, style.frontCentre)
    : null
  const frameHoles: Polygon[] = [[orient(rectangle(innerFrame.x0, innerFrame.y0, innerFrame.x1, innerFrame.y1), true)]]
  if (notch) frameHoles.push(notch)
  const frameRing = difference([orient(rectangle(0, 0, plate.w, plate.h), true)], frameHoles)

  const labelHoles: Polygon[] = []
  if (style.labels) {
    const labelHeight = Math.min(5, rim - 0.8)
    labelHoles.push(
      ...cellLabelHoles(grid, labelHeight, {
        top: [cells.y1, rimRect.y1],
        bottom: [rimRect.y0, cells.y0],
        left: [rimRect.x0, cells.x0],
        right: [cells.x1, rimRect.x1],
      }),
    )
  }

  const inner = difference(
    [orient(rectangle(rimRect.x0, rimRect.y0, rimRect.x1, rimRect.y1), true)],
    [...holes, ...labelHoles],
  )

  const bridges: Polygon[] = []
  const count = clamp(Math.round(style.bridges), 0, 10)
  const radius = width / 2
  const overlap = Math.min(1, width / 2)
  const gapTop = innerFrame.y1 - rimRect.y1
  const gapBottom = rimRect.y0 - innerFrame.y0
  const gapLeft = rimRect.x0 - innerFrame.x0
  const gapRight = innerFrame.x1 - rimRect.x1

  for (let index = 0; index < count; index++) {
    const fraction = (index + 0.5) / count
    const x = rimRect.x0 + fraction * (rimRect.x1 - rimRect.x0)
    const y = rimRect.y0 + fraction * (rimRect.y1 - rimRect.y0)
    if (gapTop > 0.6) {
      bridges.push(roundedRect(x - width / 2, rimRect.y1 - overlap, x + width / 2, innerFrame.y1 + overlap, radius))
    }
    if (gapBottom > 0.6) {
      bridges.push(roundedRect(x - width / 2, innerFrame.y0 - overlap, x + width / 2, rimRect.y0 + overlap, radius))
    }
    if (gapLeft > 0.6) {
      bridges.push(roundedRect(innerFrame.x0 - overlap, y - width / 2, rimRect.x0 + overlap, y + width / 2, radius))
    }
    if (gapRight > 0.6) {
      bridges.push(roundedRect(rimRect.x1 - overlap, y - width / 2, innerFrame.x1 + overlap, y + width / 2, radius))
    }
  }

  const outline = unionGeoms([frameRing, inner, ...bridges])
  if (outline.length === 0) return null
  return { outline, sheet: { x0: 0, y0: 0, x1: plate.w, y1: plate.h } }
}

/**
 * The printable reference lattice (SPEC §10.1). `auto` keeps the full plate and
 * cuts a frame + bridges when the measured cell grid is inset by more than
 * 5 mm; otherwise it trims to the cells + border. The sheet is one closed,
 * manifold solid; labels are cut later in the frame.
 */
export function buildLattice(grid: Grid, style: LatticeStyle = {}): LatticeResult {
  const wallThickness = Math.max(0.1, style.wallThickness ?? 0.8)
  const height = Math.max(0.05, style.height ?? 0.6)
  const front = style.front ?? true
  const outlineMode = style.outline ?? 'auto'
  const margin = Math.max(0.4, style.margin ?? 5)
  const frame = Math.max(1.5, style.frame ?? 6)
  const rim = Math.max(0.4, style.rim ?? 6)
  const bridges = Math.max(0, Math.round(style.bridges ?? 4))
  const bridgeWidth = Math.max(0.8, style.bridgeWidth ?? 2)
  const labels = style.labels ?? true
  const plate = grid.plate
  const holes = cellHoles(grid, wallThickness)
  const cells = cellBounds(grid)
  const margins = [cells.x0, cells.y0, plate.w - cells.x1, plate.h - cells.y1]
  // In extended mode the cells already sit on the label border, so there is no
  // room for a separate frame + gap + rim: the plate sheet carries the labels.
  const useFrame =
    !grid.extendToPlate &&
    (outlineMode === 'frame' || (outlineMode === 'auto' && Math.max(...margins) > 5))

  const resolved: Required<LatticeStyle> = {
    wallThickness,
    height,
    front,
    outline: outlineMode,
    margin,
    frame,
    rim,
    bridges,
    bridgeWidth,
    labels,
    frontCentre: style.frontCentre ?? plate.w / 2,
  }

  const shape = useFrame
    ? (buildFrame(grid, holes, resolved) ??
      buildSimple(grid, holes, 'grid', margin, front, labels, style.frontCentre))
    : buildSimple(
        grid,
        holes,
        outlineMode === 'plate' ? 'plate' : 'grid',
        margin,
        front,
        labels,
        style.frontCentre,
      )

  if (!shape) {
    return {
      triangles: [],
      manifold: inspectMesh([]),
      style: resolved,
      sheet: { x0: 0, y0: 0, x1: plate.w, y1: plate.h },
      outline: [],
      framed: useFrame,
      warnings: [{ code: 'lattice.warn.notClosed', params: { edges: 0 } }],
    }
  }

  const triangles = outward(extrude(shape.outline, height))
  const manifold = inspectMesh(triangles)
  const warnings: CoreMessage[] = []
  if (!manifold.closed) warnings.push({ code: 'lattice.warn.notClosed', params: { edges: manifold.badEdges } })
  if (!manifold.connected) warnings.push({ code: 'lattice.warn.disconnected', params: { parts: manifold.components } })

  return {
    triangles,
    manifold,
    style: resolved,
    sheet: shape.sheet,
    outline: shape.outline,
    framed: useFrame,
    warnings,
  }
}
