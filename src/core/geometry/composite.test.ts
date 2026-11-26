import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildGrid } from '../grid'
import { parseMesh } from '../mesh/parse'
import { buildCompositeLattice, buildCompositeSvg, type LatticePart } from './composite'
import { buildLattice } from './lattice'
import { intersection, signedArea, type MultiPolygon } from './polygon'

function overlapArea(a: MultiPolygon, b: MultiPolygon): number {
  return intersection(a, b)
    .flatMap((polygon) => polygon)
    .reduce((sum, ring) => sum + Math.abs(signedArea(ring)), 0)
}

const JOINED: Array<[LatticePart['id'], LatticePart['id']]> = [
  ['TL', 'TR'],
  ['TR', 'BR'],
  ['BR', 'BL'],
  ['BL', 'TL'],
]

const fixture = readFileSync(new URL('../../../fixtures/neptune4-mesh.cfg', import.meta.url), 'utf8')

function fixtureGrid() {
  const { mesh } = parseMesh(fixture)
  return buildGrid({
    plate: { w: 235, h: 235 },
    meshBounds: mesh.bounds!,
    tapeWidth: 20,
    meshXCount: mesh.xCount,
    meshYCount: mesh.yCount,
  })
}

describe('buildCompositeLattice', () => {
  const grid = fixtureGrid()
  const result = buildCompositeLattice(grid, {}, { centerClearance: 0.2 })

  it('returns four closed, connected parts and a closed cross', () => {
    expect(result.parts).toHaveLength(4)
    for (const part of result.parts) {
      expect(part.manifold.closed).toBe(true)
      expect(part.manifold.connected).toBe(true)
      expect(part.manifold.degenerateTriangles).toBe(0)
      expect(part.outline.length).toBeGreaterThan(0)
      // Each downloaded part starts at the printable origin.
      expect(part.manifold.box.minX).toBeCloseTo(0, 6)
      expect(part.manifold.box.minY).toBeCloseTo(0, 6)
    }
    expect(result.cross).not.toBeNull()
    expect(result.cross!.manifold.closed).toBe(true)
    expect(result.cross!.manifold.connected).toBe(true)
    expect(result.cross!.manifold.box.minX).toBeCloseTo(0, 6)
    expect(result.cross!.manifold.box.minY).toBeCloseTo(0, 6)
    expect(result.warnings).toEqual([])
  })

  it('splits along cell boundaries near the middle of the sheet', () => {
    const xs = new Set<number>()
    const ys = new Set<number>()
    for (const cell of grid.cells) {
      xs.add(cell.x0)
      xs.add(cell.x1)
      ys.add(cell.y0)
      ys.add(cell.y1)
    }
    expect(xs.has(result.splitX)).toBe(true)
    expect(ys.has(result.splitY)).toBe(true)
    expect(Math.abs(result.splitX - (result.sheet.x0 + result.sheet.x1) / 2)).toBeLessThan(30)
    expect(Math.abs(result.splitY - (result.sheet.y0 + result.sheet.y1) / 2)).toBeLessThan(30)
  })

  it('puts one dovetail at each outer seam end, one tenon and one mortise per part', () => {
    expect(result.joints).toHaveLength(4)
    for (const part of result.parts) {
      expect(result.joints.filter((joint) => joint.tenon === part.id)).toHaveLength(1)
      expect(result.joints.filter((joint) => joint.mortise === part.id)).toHaveLength(1)
    }
    for (const joint of result.joints) {
      expect(joint.tip).toBeGreaterThan(joint.width)
      expect(joint.depth).toBeGreaterThan(0)
      // The joint sits in the solid outer band, not in the cell field.
      const distance =
        joint.id === 'top'
          ? result.sheet.y1 - joint.centre
          : joint.id === 'bottom'
            ? joint.centre - result.sheet.y0
            : joint.id === 'left'
              ? joint.centre - result.sheet.x0
              : result.sheet.x1 - joint.centre
      expect(distance).toBeCloseTo(joint.band / 2, 6)
      expect(joint.band).toBeGreaterThanOrEqual(4)
    }
  })

  it('spans the whole sheet without adding material in the cell field', () => {
    const base = buildLattice(grid)
    const tight = buildCompositeLattice(grid)
    const partsVolume = tight.parts.reduce((sum, part) => sum + part.manifold.volume, 0)
    expect(partsVolume).toBeCloseTo(base.manifold.volume, 3)
    expect(tight.parts[0]!.sheet.x0).toBeCloseTo(tight.sheet.x0, 6)
    expect(tight.parts[1]!.sheet.x1).toBeCloseTo(tight.sheet.x1, 6)
    expect(tight.parts[2]!.sheet.y0).toBeCloseTo(tight.sheet.y0, 6)
    expect(tight.parts[0]!.sheet.y1).toBeCloseTo(tight.sheet.y1, 6)
  })

  it('does not overlap its neighbours, with or without dovetail clearance', () => {
    for (const clearance of [0, 0.2]) {
      const split = buildCompositeLattice(grid, {}, { clearance })
      const byId = new Map(split.parts.map((part) => [part.id, part]))
      for (const [a, b] of JOINED) {
        expect(overlapArea(byId.get(a)!.outline, byId.get(b)!.outline)).toBeLessThan(1e-6)
      }
    }
  })

  it('applies dovetail clearance only to the outer tenon', () => {
    const tight = buildCompositeLattice(grid, {}, { clearance: 0 })
    const loose = buildCompositeLattice(grid, {}, { clearance: 0.2 })
    expect(tight.joints.every((joint) => joint.clearance === 0)).toBe(true)
    expect(loose.joints.every((joint) => joint.clearance > 0)).toBe(true)
    const tightVolume = tight.parts.reduce((sum, part) => sum + part.manifold.volume, 0)
    const looseVolume = loose.parts.reduce((sum, part) => sum + part.manifold.volume, 0)
    expect(looseVolume).toBeLessThan(tightVolume)
    expect(tightVolume - looseVolume).toBeGreaterThan(0)
    expect(tightVolume - looseVolume).toBeLessThan(50)
    for (const part of loose.parts) {
      expect(part.manifold.closed).toBe(true)
      expect(part.manifold.connected).toBe(true)
    }
  })

  it('sizes the centre cross tunnel from the wall sum plus its own clearance', () => {
    const tight = buildCompositeLattice(grid, {}, { centerClearance: 0 })
    const loose = buildCompositeLattice(grid, {}, { centerClearance: 0.2 })
    const wall = tight.parts.length > 0 ? buildLattice(grid).style.wallThickness : 0.8
    expect(tight.cross!.slot).toBeCloseTo(wall, 6)
    expect(loose.cross!.slot).toBeCloseTo(wall + 0.4, 6)
    expect(loose.cross!.manifold.volume).toBeLessThan(tight.cross!.manifold.volume)
    expect(tight.cross!.arm).toBeGreaterThan(tight.cross!.slot / 2)
    expect(tight.cross!.armWidth).toBeGreaterThan(tight.cross!.slot)
    // The cross lives in the four cell holes around the split, not on the sheet edge.
    expect(tight.cross!.sheet.x0).toBeGreaterThan(tight.sheet.x0)
    expect(tight.cross!.sheet.y0).toBeGreaterThan(tight.sheet.y0)
    expect(tight.cross!.sheet.x1).toBeLessThan(tight.sheet.x1)
    expect(tight.cross!.sheet.y1).toBeLessThan(tight.sheet.y1)
  })

  it('draws four separated parts, the centre cross and its label', () => {
    const svg = buildCompositeSvg(result)
    expect(svg).toContain('<svg')
    expect((svg.match(/<path /g) ?? [])).toHaveLength(5)
    for (const part of result.parts) expect(svg).toContain(`>${part.index}</text>`)
    expect(svg).toContain('>C</text>')
  })

  it('warns when a tiny grid leaves no usable split line', () => {
    const tiny = buildGrid({
      plate: { w: 30, h: 30 },
      meshBounds: { minX: 0, maxX: 20, minY: 0, maxY: 20 },
      tapeWidth: 20,
      meshXCount: 2,
      meshYCount: 2,
    })
    const split = buildCompositeLattice(tiny)
    expect(split.warnings.map((warning) => warning.code)).toContain('lattice.warn.compositeNoGridLine')
  })
})
