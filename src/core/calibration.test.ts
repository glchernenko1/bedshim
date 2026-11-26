import { describe, expect, it } from 'vitest'
import {
  autoCalibration,
  calibrationMeasuresTape,
  calibrationProblem,
  calibrationValues,
  fitCalibrationPair,
  lastPair,
  type CalibrationMeasurement,
  type CalibrationPlan,
} from './calibration'
import { buildGrid } from './grid'
import { DEFAULT_MATERIAL, type Material } from './material'
import { createSurface } from './mesh/interpolate'
import type { Mesh } from './mesh/types'
import { plan } from './plan'

const bounds = { minX: 10, maxX: 210, minY: 21, maxY: 211 }
const TRUE_MATERIAL: Material = { nominal: 0.05, t1: 0.025, ts: 0.04, calibrated: true }

function grid() {
  return buildGrid({ plate: { w: 235, h: 235 }, meshBounds: bounds, tapeWidth: 20, meshXCount: 11, meshYCount: 11 })
}

function flatMesh(value: number): Mesh {
  return {
    name: 'flat',
    version: 1,
    xCount: 11,
    yCount: 11,
    points: Array.from({ length: 11 }, () => new Array<number>(11).fill(value)),
    bounds,
    algo: 'bicubic',
    tension: 0.2,
    meshXPps: 4,
    meshYPps: 4,
    source: 'block',
    inferred: { counts: false, bounds: false, algo: false, tension: false, pps: false },
    ignoredKeys: [],
    notices: [],
  }
}

/** Nested bands: 1 layer across the middle, 2 in a narrower band, 3 in the centre. */
function layerPattern(): number[][] {
  const layers = Array.from({ length: 10 }, () => new Array<number>(10).fill(0))
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 10; col++) {
      if (col >= 2 && col <= 7) layers[row]![col] = 1
      if (col >= 3 && col <= 6) layers[row]![col] = 2
      if (col >= 4 && col <= 5) layers[row]![col] = 3
    }
  }
  return layers
}

function blurredLiftAt(x: number, y: number, layers: number[][], sigma: number): number {
  const g = grid()
  const inv = 1 / (2 * sigma * sigma)
  let sum = 0
  let weight = 0
  for (const cell of g.cells) {
    const dx = (cell.x0 + cell.x1) / 2 - x
    const dy = (cell.y0 + cell.y1) / 2 - y
    const w = Math.exp(-(dx * dx + dy * dy) * inv)
    const n = layers[cell.row]?.[cell.col] ?? 0
    const lift = n === 0 ? 0 : TRUE_MATERIAL.t1 + (n - 1) * TRUE_MATERIAL.ts!
    sum += w * lift
    weight += w
  }
  return weight > 0 ? sum / weight : 0
}

function meshFromField(layers: number[][], sigma: number): Mesh {
  const points: number[][] = []
  for (let row = 0; row < 11; row++) {
    const y = bounds.minY + (row / 10) * (bounds.maxY - bounds.minY)
    const line: number[] = []
    for (let col = 0; col < 11; col++) {
      const x = bounds.minX + (col / 10) * (bounds.maxX - bounds.minX)
      line.push(blurredLiftAt(x, y, layers, sigma))
    }
    points.push(line)
  }
  return { ...flatMesh(0), points }
}

function measurement(
  id: string,
  mesh: Mesh,
  layers: number[][] | null,
  applied: CalibrationPlan | null = null,
): CalibrationMeasurement {
  return { id, label: id.toUpperCase(), createdAt: '2026-01-01T00:00:00.000Z', mesh, layers, applied }
}

const layers = layerPattern()

const appliedPlan: CalibrationPlan = {
  layers,
  tapeWidth: 20,
  plateW: 235,
  plateH: 235,
  extendToPlate: false,
}

/** M1 was taken on a bare bed, the plan was glued, M2 saw it with σ = 30 mm. */
const m1 = measurement('m1', flatMesh(0), null, appliedPlan)
const m2 = measurement('m2', meshFromField(layers, 30), layers)

describe('calibrationMeasuresTape', () => {
  it('matches the identifiability of a pair that changed a second layer', () => {
    const fit = fitCalibrationPair({ from: m1, to: m2, fallbackSigma: 22 })
    expect(fit).not.toBeNull()
    expect(fit!.fit.singleParameter).toBe(false)
    expect(calibrationMeasuresTape(fit!)).toBe(fit!.identifiable)
  })

  it('stays locked when the plan never put a second layer anywhere', () => {
    const oneLayer = layers.map((row) => row.map((value) => Math.min(value, 1)))
    const flatPlan = measurement('m2flat', meshFromField(oneLayer, 30), oneLayer)
    const fit = fitCalibrationPair({ from: m1, to: flatPlan, fallbackSigma: 22 })
    expect(fit).not.toBeNull()
    expect(fit!.fit.singleParameter).toBe(true)
    expect(calibrationMeasuresTape(fit!)).toBe(false)
  })
})

describe('Auto / Pro calibration parity', () => {
  it('Auto applies exactly the values Pro fits and applies', () => {
    expect(calibrationProblem(m1, m2)).toBeNull()

    const manual = fitCalibrationPair({ from: m1, to: m2, fallbackSigma: 22 })
    expect(manual).not.toBeNull()
    const proValues = calibrationValues(manual!)

    const auto = autoCalibration({ measurements: [m1, m2], fallbackSigma: 22 })
    expect(auto.status).toBe('ready')
    if (auto.status !== 'ready') return
    expect(auto.values).toEqual(proValues)

    const proMaterial: Material = {
      ...DEFAULT_MATERIAL,
      t1: proValues.t1,
      ts: proValues.ts,
      calibrated: true,
    }
    const autoMaterial: Material = {
      ...DEFAULT_MATERIAL,
      t1: auto.values.t1,
      ts: auto.values.ts,
      calibrated: true,
    }

    const options = {
      surface: createSurface(m2.mesh),
      grid: grid(),
      referencePercentile: 0.85,
      rounding: 'round' as const,
      maxLayers: 6,
      baseLayers: m2.layers ?? undefined,
    }
    const proPlan = plan({ ...options, material: proMaterial })
    const autoPlan = plan({ ...options, material: autoMaterial })

    expect(autoPlan.layers).toEqual(proPlan.layers)
    expect(autoPlan.stats).toEqual(proPlan.stats)
    expect(Math.abs(auto.values.t1 - TRUE_MATERIAL.t1) / TRUE_MATERIAL.t1).toBeLessThan(0.02)
    expect(Math.abs(auto.values.ts - TRUE_MATERIAL.ts!) / TRUE_MATERIAL.ts!).toBeLessThan(0.02)
  })

  it('uses the last two measurements, like the Pro defaults', () => {
    const older = measurement('m0', flatMesh(0), null, null)
    const pair = lastPair([older, m1, m2])
    expect(pair?.from.id).toBe('m1')
    expect(pair?.to.id).toBe('m2')

    const auto = autoCalibration({ measurements: [older, m1, m2], fallbackSigma: 22 })
    expect(auto.status).toBe('ready')
    if (auto.status !== 'ready') return
    expect(auto.from.id).toBe('m1')
    expect(auto.to.id).toBe('m2')
  })
})

describe('autoCalibration waiting states', () => {
  it('waits for a second measurement', () => {
    expect(autoCalibration({ measurements: [] })).toEqual({ status: 'noPair' })
    expect(autoCalibration({ measurements: [m1] })).toEqual({ status: 'noPair' })
  })

  it('reports a missing plan without touching the material', () => {
    const noPlan = measurement('m1', flatMesh(0), null, null)
    const auto = autoCalibration({ measurements: [noPlan, m2] })
    expect(auto.status).toBe('blocked')
    if (auto.status !== 'blocked') return
    expect(auto.problem).toBe('fromNoPlan')
  })

  it('reports a missing layer state on the new measurement', () => {
    const noLayers = measurement('m2', meshFromField(layers, 30), null)
    const auto = autoCalibration({ measurements: [m1, noLayers] })
    expect(auto.status).toBe('blocked')
    if (auto.status !== 'blocked') return
    expect(auto.problem).toBe('toNoLayers')
  })

  it('refuses a pair with different probe geometry', () => {
    const other = measurement('m2', { ...meshFromField(layers, 30), xCount: 9 }, layers)
    const auto = autoCalibration({ measurements: [m1, other] })
    expect(auto.status).toBe('blocked')
    if (auto.status !== 'blocked') return
    expect(auto.problem).toBe('geometry')
  })

  it('does not apply an inconclusive fit', () => {
    const unchanged = measurement('m2', flatMesh(0), layers)
    const auto = autoCalibration({ measurements: [m1, unchanged], fallbackSigma: 22 })
    expect(auto.status).toBe('inconclusive')
    if (auto.status !== 'inconclusive') return
    expect(auto.result.fit.conclusive).toBe(false)
  })

  it('keeps a measured ts when the new plan only changed the first layer', () => {
    const oneLayer = layers.map((row) => row.map((value) => Math.min(value, 1)))
    const flat = measurement('m2flat', meshFromField(oneLayer, 30), oneLayer)
    const auto = autoCalibration({
      measurements: [m1, flat],
      fixedT1: TRUE_MATERIAL.t1,
      fixedTs: TRUE_MATERIAL.ts!,
      fallbackSigma: 30,
    })
    expect(auto.status).toBe('ready')
    if (auto.status !== 'ready') return
    expect(auto.result.fit.tsSource).toBe('previous')
    expect(auto.values.ts).toBeCloseTo(TRUE_MATERIAL.ts!, 2)
    expect(auto.values.t1).toBeCloseTo(TRUE_MATERIAL.t1, 2)
  })
})

describe('first-layer reference zone loop', () => {
  it('recovers t1 and ts from a plan that would otherwise tape every cell twice', () => {
    const base = Array.from({ length: 10 }, () => new Array<number>(10).fill(2))
    const surface = createSurface(flatMesh(0))
    const result = plan({
      surface,
      grid: grid(),
      material: { ...TRUE_MATERIAL, calibrated: false },
      referencePercentile: 0.85,
      rounding: 'round',
      baseLayers: base,
    })
    expect(result.referenceZone).not.toBeNull()

    const applied: CalibrationPlan = {
      layers: result.layers,
      tapeWidth: 20,
      plateW: 235,
      plateH: 235,
      extendToPlate: false,
    }
    const before = measurement('r1', meshFromField(base, 22), base, applied)
    const after = measurement('r2', meshFromField(result.layers, 22), result.layers)
    const fit = fitCalibrationPair({ from: before, to: after, fallbackSigma: 22 })

    expect(fit).not.toBeNull()
    expect(fit!.identifiable).toBe(true)
    expect(fit!.fit.singleParameter).toBe(false)
    expect(fit!.fit.tsSource).toBe('fit')
    expect(fit!.fit.conclusive).toBe(true)
    expect(fit!.fit.t1).toBeCloseTo(TRUE_MATERIAL.t1, 2)
    expect(fit!.fit.ts).toBeCloseTo(TRUE_MATERIAL.ts!, 2)
  })

  it('does not turn a noisy witness into a conclusive fit', () => {
    const base = Array.from({ length: 10 }, () => new Array<number>(10).fill(2))
    const surface = createSurface(flatMesh(0))
    const result = plan({
      surface,
      grid: grid(),
      material: { ...TRUE_MATERIAL, calibrated: false },
      referencePercentile: 0.85,
      rounding: 'round',
      baseLayers: base,
    })
    const applied: CalibrationPlan = {
      layers: result.layers,
      tapeWidth: 20,
      plateW: 235,
      plateH: 235,
      extendToPlate: false,
    }
    const before = measurement('r1', meshFromField(base, 22), base, applied)
    const clean = meshFromField(result.layers, 22)
    const noisy = {
      ...clean,
      points: clean.points.map((row, r) =>
        row.map((value, c) => value + 0.03 * Math.sin(r * 12.9898 + c * 78.233)),
      ),
    }
    const after = measurement('r2', noisy, result.layers)
    const fit = fitCalibrationPair({ from: before, to: after, fallbackSigma: 22 })
    expect(fit).not.toBeNull()
    expect(fit!.fit.conclusive).toBe(false)
  })

  it('measures t1 by filling an existing zero cell and keeps the known ts', () => {
    // Everything already has two layers except one cell at 0: no second-layer
    // change, so ts is not identifiable, but a 0 -> 1 fill measures t1.
    const base = Array.from({ length: 10 }, () => new Array<number>(10).fill(2))
    base[5]![5] = 0
    const surface = createSurface(flatMesh(0))
    const result = plan({
      surface,
      grid: grid(),
      material: { ...TRUE_MATERIAL, calibrated: false },
      referencePercentile: 0.85,
      rounding: 'round',
      baseLayers: base,
    })
    expect(result.referenceZone).not.toBeNull()
    expect(result.referenceZone!.zero).toBeNull()
    expect(result.referenceZone!.first).toEqual(['F6'])
    expect(result.layers[5]![5]).toBe(1)
    expect(result.warnings.map((warning) => warning.code)).toContain('plan.notice.referenceCell')

    const applied: CalibrationPlan = {
      layers: result.layers,
      tapeWidth: 20,
      plateW: 235,
      plateH: 235,
      extendToPlate: false,
    }
    const before = measurement('f1', meshFromField(base, 22), base, applied)
    const after = measurement('f2', meshFromField(result.layers, 22), result.layers)
    const fit = fitCalibrationPair({
      from: before,
      to: after,
      fixedTs: TRUE_MATERIAL.ts!,
      fallbackSigma: 22,
    })
    expect(fit).not.toBeNull()
    expect(fit!.fit.tsSource).toBe('previous')
    expect(fit!.fit.t1).toBeCloseTo(TRUE_MATERIAL.t1, 2)
    expect(fit!.fit.ts).toBe(TRUE_MATERIAL.ts)
  })
})
