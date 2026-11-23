import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CoreError } from '../errors'
import type { MessageCode } from '../messages'
import { parseMesh } from './parse'

function fixture(name: string): string {
  return readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), 'utf8')
}

function caught(fn: () => unknown): CoreError {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(CoreError)
    return error as CoreError
  }
  throw new Error('expected a CoreError')
}

function expectCode(fn: () => unknown, code: MessageCode): CoreError {
  const error = caught(fn)
  expect(error.code).toBe(code)
  return error
}

const saveConfigText = fixture('neptune4-mesh.cfg')
const blockText = fixture('neptune4-mesh.block')
const pointsText = fixture('neptune4-mesh.points')

describe('parseMesh — the three shapes of SPEC §5.1', () => {
  it('parses SAVE_CONFIG, block and bare numbers into the same 11×11 matrix', () => {
    const fromCfg = parseMesh(saveConfigText).mesh
    const fromBlock = parseMesh(blockText).mesh
    const fromPoints = parseMesh(pointsText).mesh
    expect(fromCfg.points).toHaveLength(11)
    expect(fromCfg.points.every((row) => row.length === 11)).toBe(true)
    expect(fromBlock.points).toEqual(fromCfg.points)
    expect(fromPoints.points).toEqual(fromCfg.points)
  })

  it('reads SAVE_CONFIG metadata and geometry', () => {
    const { mesh, profiles } = parseMesh(saveConfigText)
    expect(mesh.source).toBe('save_config')
    expect(mesh.name).toBe('default')
    expect(profiles).toEqual([{ name: 'default' }])
    expect(mesh.version).toBe(1)
    expect(mesh.algo).toBe('bicubic')
    expect(mesh.tension).toBeCloseTo(0.2)
    expect(mesh.meshXPps).toBe(4)
    expect(mesh.meshYPps).toBe(4)
    expect(mesh.bounds).toEqual({ minX: 10, maxX: 210, minY: 21, maxY: 211 })
    expect(mesh.inferred).toEqual({
      counts: false,
      bounds: false,
      algo: false,
      tension: false,
      pps: false,
    })
    expect(mesh.ignoredKeys).toEqual([])
    expect(mesh.notices).toEqual([])
  })

  it('reads the block shape with the same result', () => {
    const { mesh } = parseMesh(blockText)
    expect(mesh.source).toBe('block')
    expect(mesh.bounds).toEqual({ minX: 10, maxX: 210, minY: 21, maxY: 211 })
    expect(mesh.xCount).toBe(11)
    expect(mesh.yCount).toBe(11)
  })

  it('infers counts from bare numbers and reports it', () => {
    const { mesh } = parseMesh(pointsText)
    expect(mesh.source).toBe('points')
    expect(mesh.xCount).toBe(11)
    expect(mesh.yCount).toBe(11)
    expect(mesh.inferred.counts).toBe(true)
    expect(mesh.bounds).toBeNull()
    expect(mesh.inferred.bounds).toBe(true)
    const codes = mesh.notices.map((notice) => notice.code)
    expect(codes).toContain('parse.notice.inferredCounts')
    expect(codes).toContain('parse.notice.missingBounds')
  })

  it('keeps mesh order: row 0 is min_y, column 0 is min_x', () => {
    const { mesh } = parseMesh(saveConfigText)
    expect(mesh.points[0]?.[0]).toBe(0.09)
    expect(mesh.points[2]?.[0]).toBe(0.1175)
    expect(mesh.points[10]?.[3]).toBe(-0.04)
    expect(mesh.xCount).toBe(11)
  })

  it('preserves negative zero', () => {
    const { mesh } = parseMesh(saveConfigText)
    expect(Object.is(mesh.points[0]?.[8], -0)).toBe(true)
  })

  it('accepts key=value without spaces and tabs as indentation', () => {
    const text = [
      '[bed_mesh test]',
      'points=',
      '\t0.5 0.25',
      '\t0.125 0',
      'x_count=2',
      'y_count=2',
      'min_x=0',
      'max_x=10',
      'min_y=0',
      'max_y=10',
    ].join('\n')
    const { mesh } = parseMesh(text)
    expect(mesh.points).toEqual([
      [0.5, 0.25],
      [0.125, 0],
    ])
    expect(mesh.bounds).toEqual({ minX: 0, maxX: 10, minY: 0, maxY: 10 })
  })

  it('chunks a single long points line using the declared counts', () => {
    const text = ['[bed_mesh x]', 'points: 1, 2, 3, 4, 5, 6', 'x_count: 3', 'y_count: 2'].join('\n')
    const { mesh } = parseMesh(text)
    expect(mesh.points).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ])
  })
})

describe('parseMesh — profiles', () => {
  const twoProfiles = [
    '[bed_mesh first]',
    'points:',
    '  1 2',
    '  3 4',
    'x_count: 2',
    'y_count: 2',
    '',
    '[bed_mesh second]',
    'points:',
    '  5 6',
    '  7 8',
    'x_count: 2',
    'y_count: 2',
  ].join('\n')

  it('lists profiles and uses the last one by default', () => {
    const { mesh, profiles } = parseMesh(twoProfiles)
    expect(profiles.map((profile) => profile.name)).toEqual(['first', 'second'])
    expect(mesh.name).toBe('second')
    expect(mesh.points[0]).toEqual([5, 6])
    expect(mesh.notices.map((notice) => notice.code)).toContain('parse.notice.profiles')
  })

  it('uses the requested profile', () => {
    const { mesh } = parseMesh(twoProfiles, { profile: 'first' })
    expect(mesh.name).toBe('first')
    expect(mesh.points[0]).toEqual([1, 2])
  })

  it('reports an unknown profile with the available names', () => {
    const error = expectCode(() => parseMesh(twoProfiles, { profile: 'nope' }), 'parse.error.profileNotFound')
    expect(error.params.available).toBe('first, second')
  })
})

describe('parseMesh — unknown keys and notices', () => {
  it('lists keys it ignores instead of failing', () => {
    const text = [
      '[bed_mesh default]',
      'points:',
      '  1 2',
      '  3 4',
      'x_count: 2',
      'y_count: 2',
      'zero_reference_position: 100, 100',
      'relative_reference_index: 60',
    ].join('\n')
    const { mesh } = parseMesh(text)
    expect(mesh.ignoredKeys).toEqual(['relative_reference_index', 'zero_reference_position'])
    const notice = mesh.notices.find((item) => item.code === 'parse.notice.ignoredKeys')
    expect(notice?.params?.keys).toBe('relative_reference_index, zero_reference_position')
  })

  it('falls back to bicubic when the algo is unknown', () => {
    const text = ['[bed_mesh d]', 'points: 1 2 3 4', 'x_count: 2', 'y_count: 2', 'algo: spline'].join('\n')
    const { mesh } = parseMesh(text)
    expect(mesh.algo).toBe('bicubic')
    expect(mesh.notices.map((notice) => notice.code)).toContain('parse.notice.unknownAlgo')
  })
})

describe('parseMesh — malformed input gives a useful error', () => {
  it('rejects empty text', () => {
    expectCode(() => parseMesh('   '), 'parse.error.empty')
  })

  it('rejects text without any points', () => {
    expectCode(() => parseMesh('hello world'), 'parse.error.noPoints')
  })

  it('reports a short row with its number', () => {
    const text = ['[bed_mesh d]', 'points:', '  1 2 3', '  4 5', 'x_count: 3', 'y_count: 2'].join('\n')
    const error = expectCode(() => parseMesh(text), 'parse.error.colCount')
    expect(error.params).toMatchObject({ declared: 3, actual: 2, row: 2 })
  })

  it('reports too few rows against y_count', () => {
    const text = ['[bed_mesh d]', 'points:', '  1 2 3', 'x_count: 3', 'y_count: 2'].join('\n')
    const error = expectCode(() => parseMesh(text), 'parse.error.rowCount')
    expect(error.params).toMatchObject({ declared: 2, actual: 1 })
  })

  it('reports ragged rows when counts are absent', () => {
    const text = ['[bed_mesh d]', 'points:', '  1 2 3', '  4 5'].join('\n')
    const error = expectCode(() => parseMesh(text), 'parse.error.ragged')
    expect(error.params).toMatchObject({ row: 2, expected: 3, actual: 2 })
  })

  it('refuses to guess a grid from a non-square count', () => {
    expectCode(() => parseMesh('1 2 3 4 5'), 'parse.error.ambiguousGrid')
  })

  it('points at the number it cannot parse', () => {
    const text = ['[bed_mesh d]', 'points: 1 2 3 oops', 'x_count: 4', 'y_count: 1'].join('\n')
    const error = expectCode(() => parseMesh(text), 'parse.error.badNumber')
    expect(error.params.value).toBe('oops')
    expect(error.line).toBe(2)
  })

  it('rejects inverted bounds', () => {
    const text = [
      '[bed_mesh d]',
      'points: 1 2 3 4',
      'x_count: 2',
      'y_count: 2',
      'min_x: 200',
      'max_x: 100',
      'min_y: 0',
      'max_y: 10',
    ].join('\n')
    expectCode(() => parseMesh(text), 'parse.error.badBounds')
  })
})
