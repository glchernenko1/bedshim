import { CoreError } from '../errors'
import type { CoreMessage } from '../messages'
import type {
  Mesh,
  MeshAlgo,
  MeshBounds,
  MeshProfileRef,
  MeshSource,
  ParseResult,
} from './types'

export interface ParseOptions {
  /** Profile to use when the text holds several `[bed_mesh <name>]` blocks. Default: the last. */
  profile?: string
}

interface SourceLine {
  text: string
  no: number
}

interface RawEntry {
  key: string
  value: string
  line: number
}

interface RawBlock {
  name: string
  entries: RawEntry[]
  line: number
}

const HEADER = /^\[([^\]]+)\]$/
const KEY = /^([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*(.*)$/
const STRICT_NUMBER = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/
const NUMERIC_LINE = /^[\s\d.,;+\-eE]+$/
const SEPARATORS = /[\s,;]+/

const KNOWN_KEYS = new Set([
  'version',
  'points',
  'x_count',
  'y_count',
  'mesh_x_pps',
  'mesh_y_pps',
  'algo',
  'algorithm',
  'tension',
  'bicubic_tension',
  'min_x',
  'max_x',
  'min_y',
  'max_y',
])

const ALGOS: readonly MeshAlgo[] = ['bicubic', 'bilinear', 'lagrange', 'direct']

// Klipper's SAVE_CONFIG block prefixes every line with "#*# " (SPEC §5.1 shape B).
const SAVE_CONFIG_LINE = /^\s*#\*#/

function stripSaveConfigPrefix(raw: string): string {
  return raw.replace(/^\s*#\*#\s*/, '')
}

function stripInlineComment(value: string): string {
  const hash = value.indexOf('#')
  return (hash === -1 ? value : value.slice(0, hash)).trim()
}

function preprocess(text: string): { lines: SourceLine[]; saveConfig: boolean } {
  const lines: SourceLine[] = []
  let saveConfig = false
  const rawLines = text.split(/\r?\n/)
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i] ?? ''
    const isSaveLine = SAVE_CONFIG_LINE.test(raw)
    if (isSaveLine) saveConfig = true
    const stripped = isSaveLine ? stripSaveConfigPrefix(raw) : raw
    // Comments (and the SAVE_CONFIG banner text) carry no data.
    if (/^\s*#/.test(stripped)) continue
    const trimmed = stripped.trim()
    if (!trimmed) continue
    lines.push({ text: trimmed, no: i + 1 })
  }
  return { lines, saveConfig }
}

function isNumericContinuation(text: string): boolean {
  return NUMERIC_LINE.test(text) && /\d/.test(text)
}

/** Reads `key: value` / `key = value` entries, including multi-line `points`. */
function readEntries(lines: SourceLine[], start = 0): RawEntry[] {
  const entries: RawEntry[] = []
  let i = start
  while (i < lines.length) {
    const line = lines[i]!
    const keyMatch = KEY.exec(line.text)
    if (!keyMatch) {
      i++
      continue
    }
    const key = (keyMatch[1] ?? '').toLowerCase()
    const chunks = [stripInlineComment(keyMatch[2] ?? '')]
    i++
    if (key === 'points') {
      while (i < lines.length && isNumericContinuation(lines[i]!.text)) {
        chunks.push(lines[i]!.text)
        i++
      }
    }
    entries.push({ key, value: chunks.join('\n'), line: line.no })
  }
  return entries
}

function readBlocks(lines: SourceLine[]): RawBlock[] {
  const blocks: RawBlock[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const header = HEADER.exec(line.text)
    if (!header) {
      i++
      continue
    }
    const section = (header[1] ?? '').trim()
    const meshSection = /^bed_mesh(?:\s+(.+))?$/i.exec(section)
    const name = meshSection?.[1]?.trim()
    // `[bed_mesh]` without a name is printer configuration, not a saved profile.
    if (!name) {
      i++
      continue
    }
    const body: SourceLine[] = []
    i++
    while (i < lines.length && !HEADER.test(lines[i]!.text)) {
      body.push(lines[i]!)
      i++
    }
    blocks.push({ name, entries: readEntries(body), line: line.no })
  }
  return blocks
}

function readNumberRows(raw: string, line: number): number[][] {
  const rows: number[][] = []
  const chunks = raw.split('\n')
  for (let i = 0; i < chunks.length; i++) {
    const chunk = (chunks[i] ?? '').trim()
    if (!chunk) continue
    const tokens = chunk.split(SEPARATORS).filter(Boolean)
    const values: number[] = []
    for (const token of tokens) {
      if (!STRICT_NUMBER.test(token)) {
        throw new CoreError('parse.error.badNumber', { value: token, line: line + i }, line + i)
      }
      values.push(Number(token))
    }
    if (values.length > 0) rows.push(values)
  }
  return rows
}

function chunkRows(values: number[], xCount: number, yCount: number): number[][] {
  const rows: number[][] = []
  for (let r = 0; r < yCount; r++) rows.push(values.slice(r * xCount, (r + 1) * xCount))
  return rows
}

function buildMatrix(
  rows: number[][],
  declaredX: number | null,
  declaredY: number | null,
): { points: number[][]; inferredCounts: boolean } {
  if (rows.length === 0 || (rows.length === 1 && (rows[0]?.length ?? 0) === 0)) {
    throw new CoreError('parse.error.noPoints')
  }
  const total = rows.reduce((sum, row) => sum + row.length, 0)
  const oneLine = rows.length === 1
  let x = declaredX
  let y = declaredY
  let inferred = false

  if (x === null && y === null) {
    inferred = true
    if (!oneLine) {
      const width = rows[0]!.length
      rows.forEach((row, index) => {
        if (row.length !== width) {
          throw new CoreError('parse.error.ragged', {
            row: index + 1,
            expected: width,
            actual: row.length,
          })
        }
      })
      x = width
      y = rows.length
    } else {
      const side = Math.round(Math.sqrt(total))
      if (side * side !== total || side < 2) {
        throw new CoreError('parse.error.ambiguousGrid', { count: total })
      }
      x = side
      y = side
    }
  } else if (x !== null && y === null) {
    if (oneLine) {
      if (total % x !== 0) {
        throw new CoreError('parse.error.colCount', { declared: x, actual: total, row: 1 })
      }
      y = total / x
    } else {
      y = rows.length
    }
  } else if (x === null && y !== null) {
    if (oneLine) {
      if (total % y !== 0) {
        throw new CoreError('parse.error.rowCount', { declared: y, actual: 1 })
      }
      x = total / y
    } else {
      if (rows.length !== y) {
        throw new CoreError('parse.error.rowCount', { declared: y, actual: rows.length })
      }
      x = rows[0]!.length
    }
  }

  if (x === null || y === null) throw new CoreError('parse.error.ambiguousGrid', { count: total })

  let points: number[][]
  if (rows.length !== y) {
    if (oneLine && total === x * y) {
      points = chunkRows(rows[0]!, x, y)
    } else {
      throw new CoreError('parse.error.rowCount', { declared: y, actual: rows.length })
    }
  } else {
    rows.forEach((row, index) => {
      if (row.length !== x) {
        throw new CoreError('parse.error.colCount', { declared: x, actual: row.length, row: index + 1 })
      }
    })
    points = rows
  }
  return { points, inferredCounts: inferred }
}

function entryOf(entries: Map<string, RawEntry>, ...keys: string[]): RawEntry | undefined {
  for (const key of keys) {
    const entry = entries.get(key)
    if (entry) return entry
  }
  return undefined
}

function readInt(entry: RawEntry | undefined, fallback: number): number {
  if (!entry) return fallback
  const value = Number(entry.value.trim())
  if (!Number.isInteger(value)) {
    throw new CoreError('parse.error.badNumber', { value: entry.value, line: entry.line }, entry.line)
  }
  return value
}

function readFloat(entry: RawEntry | undefined, fallback: number): number {
  if (!entry) return fallback
  const text = entry.value.trim()
  if (!STRICT_NUMBER.test(text)) {
    throw new CoreError('parse.error.badNumber', { value: text, line: entry.line }, entry.line)
  }
  return Number(text)
}

function readBounds(entries: Map<string, RawEntry>): MeshBounds | null {
  const minX = entries.get('min_x')
  const maxX = entries.get('max_x')
  const minY = entries.get('min_y')
  const maxY = entries.get('max_y')
  if (!minX || !maxX || !minY || !maxY) return null
  const bounds: MeshBounds = {
    minX: readFloat(minX, Number.NaN),
    maxX: readFloat(maxX, Number.NaN),
    minY: readFloat(minY, Number.NaN),
    maxY: readFloat(maxY, Number.NaN),
  }
  if (!(bounds.maxX > bounds.minX) || !(bounds.maxY > bounds.minY)) {
    throw new CoreError('parse.error.badBounds', {
      minX: bounds.minX,
      maxX: bounds.maxX,
      minY: bounds.minY,
      maxY: bounds.maxY,
    })
  }
  return bounds
}

/**
 * Parses Klipper bed mesh text in all three shapes of SPEC §5.1:
 * A a pasted block (`key: value`), B a real SAVE_CONFIG tail (`#*# ` + `key = value`),
 * C bare numbers with no keys at all.
 */
export function parseMesh(text: string, options: ParseOptions = {}): ParseResult {
  if (text.trim() === '') throw new CoreError('parse.error.empty')
  const { lines, saveConfig } = preprocess(text)
  const hadHeader = lines.some((line) => HEADER.test(line.text))
  const rawBlocks = readBlocks(lines)

  const hasPointsKey = /(^|\n)\s*points\s*[:=]/i.test(text)
  if (rawBlocks.length === 0) {
    if (hasPointsKey) {
      // Keys without a `[bed_mesh ...]` header: treat the whole text as one profile.
      const body = lines.filter((line) => !HEADER.test(line.text))
      rawBlocks.push({ name: 'default', entries: readEntries(body), line: 1 })
    } else {
      // Shape C: bare numbers, nothing else (SPEC §5.1).
      const numeric = lines.filter((line) => isNumericContinuation(line.text))
      if (numeric.length === 0) throw new CoreError('parse.error.noPoints')
      rawBlocks.push({
        name: 'default',
        entries: [{ key: 'points', value: numeric.map((line) => line.text).join('\n'), line: numeric[0]!.no }],
        line: numeric[0]!.no,
      })
    }
  }

  const profiles: MeshProfileRef[] = rawBlocks.map((block) => ({ name: block.name }))
  let block: RawBlock
  if (options.profile !== undefined) {
    const found = rawBlocks.find((candidate) => candidate.name === options.profile)
    if (!found) {
      throw new CoreError('parse.error.profileNotFound', {
        name: options.profile,
        available: profiles.map((profile) => profile.name).join(', '),
      })
    }
    block = found
  } else {
    block = rawBlocks[rawBlocks.length - 1]!
  }

  const entries = new Map<string, RawEntry>()
  for (const entry of block.entries) entries.set(entry.key, entry)

  const pointsEntry = entries.get('points')
  if (!pointsEntry) throw new CoreError('parse.error.noPoints')

  const ignoredKeys = [...entries.keys()].filter((key) => !KNOWN_KEYS.has(key)).sort()

  const notices: CoreMessage[] = []
  const rows = readNumberRows(pointsEntry.value, pointsEntry.line)
  const xCountEntry = entries.get('x_count')
  const yCountEntry = entries.get('y_count')
  const declaredX = xCountEntry ? readInt(xCountEntry, 0) : null
  const declaredY = yCountEntry ? readInt(yCountEntry, 0) : null
  const { points, inferredCounts } = buildMatrix(rows, declaredX, declaredY)
  const yCount = points.length
  const xCount = points[0]?.length ?? 0

  const algoEntry = entryOf(entries, 'algo', 'algorithm')
  let algo: MeshAlgo = 'bicubic'
  let inferredAlgo = true
  if (algoEntry) {
    const raw = algoEntry.value.trim().toLowerCase()
    if ((ALGOS as readonly string[]).includes(raw)) {
      algo = raw as MeshAlgo
      inferredAlgo = false
    } else {
      notices.push({ code: 'parse.notice.unknownAlgo', params: { algo: raw } })
    }
  }

  const tensionEntry = entryOf(entries, 'tension', 'bicubic_tension')
  const tension = readFloat(tensionEntry, 0.2)

  const ppsXEntry = entries.get('mesh_x_pps')
  const ppsYEntry = entries.get('mesh_y_pps')
  const meshXPps = readInt(ppsXEntry, 2)
  const meshYPps = readInt(ppsYEntry, 2)

  const bounds = readBounds(entries)

  if (inferredCounts) {
    notices.push({ code: 'parse.notice.inferredCounts', params: { x: xCount, y: yCount } })
  }
  if (!bounds) notices.push({ code: 'parse.notice.missingBounds' })
  if (inferredAlgo) notices.push({ code: 'parse.notice.inferredAlgo', params: { algo } })
  if (!tensionEntry) notices.push({ code: 'parse.notice.inferredTension', params: { tension } })
  if (!ppsXEntry || !ppsYEntry) {
    notices.push({ code: 'parse.notice.inferredPps', params: { x: meshXPps, y: meshYPps } })
  }
  if (ignoredKeys.length > 0) {
    notices.push({ code: 'parse.notice.ignoredKeys', params: { keys: ignoredKeys.join(', ') } })
  }
  if (profiles.length > 1) {
    notices.push({ code: 'parse.notice.profiles', params: { count: profiles.length, name: block.name } })
  }

  const source: MeshSource = saveConfig ? 'save_config' : hadHeader ? 'block' : 'points'

  const mesh: Mesh = {
    name: block.name,
    version: readInt(entries.get('version'), 1),
    xCount,
    yCount,
    points,
    bounds,
    algo,
    tension,
    meshXPps,
    meshYPps,
    source,
    inferred: {
      counts: inferredCounts,
      bounds: bounds === null,
      algo: inferredAlgo,
      tension: tensionEntry === undefined,
      pps: ppsXEntry === undefined || ppsYEntry === undefined,
    },
    ignoredKeys,
    notices,
  }
  return { mesh, profiles }
}
