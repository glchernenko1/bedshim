import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createSurface } from './interpolate'
import { parseMesh } from './parse'
import { surfaceStats } from './stats'
import type { Mesh } from './types'

function mesh(points: number[][], algo: Mesh['algo'] = 'bilinear'): Mesh {
  return {
    name: 'test',
    version: 1,
    xCount: points[0]!.length,
    yCount: points.length,
    points,
    bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 },
    algo,
    tension: 0.2,
    meshXPps: 2,
    meshYPps: 2,
    source: 'block',
    inferred: { counts: false, bounds: false, algo: false, tension: false, pps: false },
    ignoredKeys: [],
    notices: [],
  }
}

describe('surfaceStats', () => {
  it('reports an empty spread for a flat surface', () => {
    const flat = createSurface(mesh([[5, 5, 5], [5, 5, 5], [5, 5, 5]]))
    const stats = surfaceStats(flat, 32)
    expect(stats.min).toBeCloseTo(5, 12)
    expect(stats.max).toBeCloseTo(5, 12)
    expect(stats.delta).toBeCloseTo(0, 12)
    expect(stats.median).toBeCloseTo(5, 12)
    expect(stats.mean).toBeCloseTo(5, 12)
    expect(stats.mad).toBeCloseTo(0, 12)
    expect(stats.samples).toBe(32 * 32)
  })

  it('measures a plane: delta is the full range, median is the centre value', () => {
    // z = 2x + 3y over 0..10 mm
    const plane = createSurface(mesh([[0, 10, 20], [15, 25, 35], [30, 40, 50]]))
    const stats = surfaceStats(plane, 64)
    expect(stats.delta).toBeCloseTo(50, 9)
    expect(stats.min).toBeCloseTo(0, 9)
    expect(stats.max).toBeCloseTo(50, 9)
    expect(stats.median).toBeCloseTo(25, 9)
    expect(stats.mean).toBeCloseTo(25, 9)
    // Symmetric spread: the median deviation is below half the range.
    expect(stats.mad).toBeGreaterThan(0)
    expect(stats.mad).toBeLessThan(stats.delta / 2)
  })

  it('stays consistent on the real fixture', () => {
    const text = readFileSync(new URL('../../../fixtures/neptune4-mesh.cfg', import.meta.url), 'utf8')
    const { mesh: fixture } = parseMesh(text)
    const stats = surfaceStats(createSurface(fixture), 64)
    // Node range is 0.165 mm (SPEC Appendix A); the surface may overshoot slightly.
    expect(stats.delta).toBeGreaterThan(0.16)
    expect(stats.delta).toBeLessThan(0.25)
    expect(stats.min).toBeLessThanOrEqual(stats.median)
    expect(stats.median).toBeLessThanOrEqual(stats.max)
    expect(stats.median).toBeGreaterThan(-0.02)
    expect(stats.median).toBeLessThan(0.05)
    expect(stats.mad).toBeGreaterThan(0)
    expect(stats.mad).toBeLessThan(stats.delta / 2)
    expect(stats.mean).toBeGreaterThan(-0.01)
    expect(stats.mean).toBeLessThan(0.05)
  })

  it('converges with the sampling resolution', () => {
    const plane = createSurface(mesh([[0, 10, 20], [15, 25, 35], [30, 40, 50]]))
    const coarse = surfaceStats(plane, 64)
    const fine = surfaceStats(plane, 256)
    expect(coarse.delta).toBeCloseTo(fine.delta, 6)
    expect(coarse.median).toBeCloseTo(fine.median, 6)
    // MAD is a median of quantised deviations, so it converges within a small
    // fraction of the range rather than exactly.
    expect(Math.abs(coarse.mad - fine.mad)).toBeLessThan(fine.delta * 0.02)
  })
})
