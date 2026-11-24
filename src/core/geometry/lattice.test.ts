import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildGrid } from '../grid'
import { parseMesh } from '../mesh/parse'
import { buildLattice } from './lattice'
import { inspectMesh } from './extrude'
import { writeBinaryStl } from './stl'

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

describe('buildLattice — automatic frame', () => {
  const lattice = buildLattice(fixtureGrid())

  it('is one closed, connected manifold solid', () => {
    expect(lattice.framed).toBe(true)
    expect(lattice.manifold.closed).toBe(true)
    expect(lattice.manifold.connected).toBe(true)
    expect(lattice.manifold.components).toBe(1)
    expect(lattice.manifold.badEdges).toBe(0)
    expect(lattice.manifold.degenerateTriangles).toBe(0)
    expect(lattice.warnings).toEqual([])
  })

  it('keeps the full plate for positioning but cuts the gap out', () => {
    expect(lattice.manifold.box.minX).toBeCloseTo(0, 6)
    expect(lattice.manifold.box.minY).toBeCloseTo(0, 6)
    expect(lattice.manifold.box.maxX).toBeCloseTo(235, 6)
    expect(lattice.manifold.box.maxY).toBeCloseTo(235, 6)
    expect(lattice.manifold.box.maxZ).toBeCloseTo(0.6, 6)
    const solidPlate = 235 * 235 * 0.6
    expect(lattice.manifold.volume).toBeGreaterThan(0)
    expect(lattice.manifold.volume).toBeLessThan(solidPlate * 0.6)
  })

  it('cuts labels into the back, front, left and right rims', () => {
    const grid = fixtureGrid()
    const cells = {
      x0: Math.min(...grid.cells.map((cell) => cell.x0)),
      y0: Math.min(...grid.cells.map((cell) => cell.y0)),
      x1: Math.max(...grid.cells.map((cell) => cell.x1)),
      y1: Math.max(...grid.cells.map((cell) => cell.y1)),
    }
    const pixels = lattice.outline
      .flatMap((polygon) => polygon)
      .map((ring) => {
        const xs = ring.map(([x]) => x)
        const ys = ring.map(([, y]) => y)
        return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
      })
      .filter((box) => box.x1 - box.x0 < 2 && box.y1 - box.y0 < 6 && box.x1 - box.x0 > 0.1)

    expect(pixels.length).toBeGreaterThan(100)
    expect(pixels.some((box) => box.y0 >= cells.y1)).toBe(true)
    expect(pixels.some((box) => box.y1 <= cells.y0)).toBe(true)
    expect(pixels.some((box) => box.x1 <= cells.x0)).toBe(true)
    expect(pixels.some((box) => box.x0 >= cells.x1)).toBe(true)
  })

  it('writes a binary STL with the triangle count in the header', () => {
    const stl = writeBinaryStl(lattice.triangles)
    expect(stl.byteLength).toBe(84 + lattice.manifold.triangles * 50)
    const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength)
    expect(view.getUint32(80, true)).toBe(lattice.manifold.triangles)
    const nx = view.getFloat32(84, true)
    const ny = view.getFloat32(88, true)
    const nz = view.getFloat32(92, true)
    expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 5)
  })
})

describe('buildLattice — explicit shapes', () => {
  it('trims to the grid plus margin when asked', () => {
    const lattice = buildLattice(fixtureGrid(), { outline: 'grid' })
    expect(lattice.framed).toBe(false)
    expect(lattice.manifold.closed).toBe(true)
    expect(lattice.manifold.connected).toBe(true)
    expect(lattice.manifold.box.minX).toBeCloseTo(5, 6)
    expect(lattice.manifold.box.minY).toBeCloseTo(16, 6)
    expect(lattice.manifold.box.maxX).toBeCloseTo(215, 6)
    expect(lattice.manifold.box.maxY).toBeCloseTo(216, 6)
    expect(lattice.manifold.volume).toBeLessThan(5_000)
  })

  it('keeps the full plate with a solid border when asked', () => {
    const lattice = buildLattice(fixtureGrid(), { outline: 'plate' })
    expect(lattice.framed).toBe(false)
    expect(lattice.manifold.closed).toBe(true)
    expect(lattice.manifold.connected).toBe(true)
    expect(lattice.manifold.box.minX).toBeCloseTo(0, 6)
    expect(lattice.manifold.box.maxX).toBeCloseTo(235, 6)
    const plateArea = 235 * 235
    const holes = 100 * (20 - 0.8) * (19 - 0.8)
    const approximate = (plateArea - holes) * 0.6
    expect(lattice.manifold.volume).toBeGreaterThan(approximate * 0.95)
    expect(lattice.manifold.volume).toBeLessThan(approximate * 1.01)
  })

  it('uses the tight grid when every margin is 5 mm or less', () => {
    const grid = buildGrid({
      plate: { w: 204, h: 194 },
      meshBounds: { minX: 0, maxX: 200, minY: 0, maxY: 190 },
      tapeWidth: 20,
      meshXCount: 11,
      meshYCount: 11,
    })
    const lattice = buildLattice(grid)
    expect(lattice.framed).toBe(false)
    expect(lattice.manifold.closed).toBe(true)
    expect(lattice.manifold.connected).toBe(true)
    expect(lattice.manifold.box.maxX).toBeCloseTo(204, 6)
    expect(lattice.manifold.box.maxY).toBeCloseTo(194, 6)
  })

  it('drops the frame when the plan is extended to the plate edges', () => {
    const { mesh } = parseMesh(fixture)
    const grid = buildGrid({
      plate: { w: 235, h: 235 },
      meshBounds: mesh.bounds!,
      tapeWidth: 20,
      meshXCount: mesh.xCount,
      meshYCount: mesh.yCount,
      extendToPlate: true,
    })
    const lattice = buildLattice(grid)
    expect(lattice.framed).toBe(false)
    expect(lattice.manifold.closed).toBe(true)
    expect(lattice.manifold.connected).toBe(true)
    expect(lattice.manifold.box.minX).toBeCloseTo(0, 6)
    expect(lattice.manifold.box.maxX).toBeCloseTo(235, 6)
    expect(lattice.manifold.volume).toBeLessThan(5_000)
  })
})

describe('buildLattice — walls', () => {
  it('collapses to a plain plate when the walls would swallow every cell', () => {
    const lattice = buildLattice(fixtureGrid(), {
      wallThickness: 25,
      height: 0.6,
      front: false,
      outline: 'plate',
    })
    expect(lattice.manifold.closed).toBe(true)
    expect(lattice.manifold.connected).toBe(true)
    expect(lattice.manifold.volume).toBeCloseTo(235 * 235 * 0.6, 3)
    expect(inspectMesh(lattice.triangles).triangles).toBe(12)
  })

  it('is still manifold with a thinner wall', () => {
    const lattice = buildLattice(fixtureGrid(), { wallThickness: 0.4, height: 0.4, outline: 'grid' })
    expect(lattice.manifold.closed).toBe(true)
    expect(lattice.manifold.connected).toBe(true)
    expect(lattice.manifold.volume).toBeGreaterThan(0)
  })
})
