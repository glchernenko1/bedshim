#!/usr/bin/env node
// Headless CLI stub (SPEC §11): proves `src/core` runs under Node with no
// browser globals. The STL writer joins it in P5.
//
//   npm run cli -- parse fixtures/neptune4-mesh.cfg [--profile default]
//   npm run cli -- lattice fixtures/neptune4-mesh.cfg --out /tmp/lattice.stl
import { readFileSync, writeFileSync } from 'node:fs'
import { CoreError } from '../src/core/errors'
import { buildLattice } from '../src/core/geometry/lattice'
import { writeBinaryStl } from '../src/core/geometry/stl'
import { buildGrid } from '../src/core/grid'
import { createSurface } from '../src/core/mesh/interpolate'
import { parseMesh } from '../src/core/mesh/parse'

const USAGE = `bedshim — Klipper bed mesh tools (headless)

Usage:
  bedshim parse <file> [--profile <name>]   Parse a mesh and print its report
  bedshim lattice <file> [options]          Write the reference lattice STL
    --out <path>       output STL (default: bedshim-lattice.stl)
    --tape <mm>        tape width (default: 20)
    --plate <w>x<h>    plate size in mm (default: 235x235)
    --wall <mm>        wall between cells (default: 0.8)
    --height <mm>      lattice thickness (default: 0.6)
  bedshim --help                            Show this help

Build the CLI with \`npm run cli -- <args>\`.
`

interface Command {
  file: string
  profile?: string
}

interface LatticeCommand {
  file: string
  out: string
  tapeWidth: number
  plateW: number
  plateH: number
  wall: number
  height: number
}

function readNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) throw new Error(`not a positive number: ${value}`)
  return number
}

function parsePlate(value: string | undefined): { w: number; h: number } {
  if (value === undefined) return { w: 235, h: 235 }
  const match = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/i.exec(value)
  if (!match) throw new Error(`--plate expects WxH, got ${value}`)
  return { w: Number(match[1]), h: Number(match[2]) }
}

function parseArgs(args: string[]): Command | { error: string } {
  let file: string | undefined
  let profile: string | undefined
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ''
    if (arg === '--profile') {
      profile = args[i + 1]
      i++
      if (!profile) return { error: '--profile needs a value' }
      continue
    }
    if (arg.startsWith('--profile=')) {
      profile = arg.slice('--profile='.length)
      continue
    }
    if (arg.startsWith('-')) return { error: `unknown option: ${arg}` }
    if (file !== undefined) return { error: `unexpected argument: ${arg}` }
    file = arg
  }
  if (file === undefined) return { error: 'missing <file>' }
  return profile === undefined ? { file } : { file, profile }
}

function parseLatticeArgs(args: string[]): LatticeCommand | { error: string } {
  let file: string | undefined
  let out = 'bedshim-lattice.stl'
  let tapeWidth = 20
  let plate = { w: 235, h: 235 }
  let wall = 0.8
  let height = 0.6
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? ''
    const value = args[index + 1]
    try {
      if (arg === '--out') {
        if (!value) return { error: '--out needs a value' }
        out = value
        index++
      } else if (arg === '--tape') {
        tapeWidth = readNumber(value, tapeWidth)
        index++
      } else if (arg === '--plate') {
        plate = parsePlate(value)
        index++
      } else if (arg === '--wall') {
        wall = readNumber(value, wall)
        index++
      } else if (arg === '--height') {
        height = readNumber(value, height)
        index++
      } else if (arg.startsWith('-')) {
        return { error: `unknown option: ${arg}` }
      } else if (file === undefined) {
        file = arg
      } else {
        return { error: `unexpected argument: ${arg}` }
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }
  if (file === undefined) return { error: 'missing <file>' }
  return { file, out, tapeWidth, plateW: plate.w, plateH: plate.h, wall, height }
}

function report(file: string, command: Command): unknown {
  const text = readFileSync(command.file, 'utf8')
  const { mesh, profiles } = parseMesh(text, command.profile === undefined ? {} : { profile: command.profile })
  const values = mesh.points.flat()
  const surface = mesh.bounds ? createSurface(mesh) : null
  return {
    file,
    profiles: profiles.map((profile) => profile.name),
    mesh: {
      name: mesh.name,
      source: mesh.source,
      grid: { xCount: mesh.xCount, yCount: mesh.yCount },
      bounds: mesh.bounds,
      algo: mesh.algo,
      tension: mesh.tension,
      meshPps: { x: mesh.meshXPps, y: mesh.meshYPps },
      inferred: mesh.inferred,
      ignoredKeys: mesh.ignoredKeys,
      nodes: { min: Math.min(...values), max: Math.max(...values) },
      notices: mesh.notices,
    },
    surface: surface
      ? {
          algo: surface.algo,
          sampled: { x: surface.sampledX, y: surface.sampledY },
          atCenter: surface.at(
            mesh.bounds!.minX + (mesh.bounds!.maxX - mesh.bounds!.minX) / 2,
            mesh.bounds!.minY + (mesh.bounds!.maxY - mesh.bounds!.minY) / 2,
          ),
          notices: surface.notices,
        }
      : null,
  }
}

function latticeReport(command: LatticeCommand): unknown {
  const text = readFileSync(command.file, 'utf8')
  const { mesh } = parseMesh(text)
  if (!mesh.bounds) throw new CoreError('surface.error.noBounds')
  const grid = buildGrid({
    plate: { w: command.plateW, h: command.plateH },
    meshBounds: mesh.bounds,
    tapeWidth: command.tapeWidth,
    meshXCount: mesh.xCount,
    meshYCount: mesh.yCount,
  })
  const lattice = buildLattice(grid, { wallThickness: command.wall, height: command.height })
  writeFileSync(command.out, writeBinaryStl(lattice.triangles))
  return {
    file: command.file,
    out: command.out,
    triangles: lattice.manifold.triangles,
    volumeMM3: Math.round(lattice.manifold.volume * 100) / 100,
    weightG: Math.round((lattice.manifold.volume / 1000) * 1.24 * 10) / 10,
    manifold: {
      closed: lattice.manifold.closed,
      connected: lattice.manifold.connected,
      components: lattice.manifold.components,
      badEdges: lattice.manifold.badEdges,
    },
    box: lattice.manifold.box,
    warnings: lattice.warnings,
  }
}

function main(argv: string[]): number {
  const [command, ...rest] = argv
  if (command === undefined || command === '--help' || command === '-h') {
    process.stdout.write(USAGE)
    return 0
  }
  if (command === 'parse') {
    const args = parseArgs(rest)
    if ('error' in args) {
      process.stderr.write(`${args.error}\n\n${USAGE}`)
      return 2
    }
    process.stdout.write(`${JSON.stringify(report(args.file, args), null, 2)}\n`)
    return 0
  }
  if (command === 'lattice') {
    const args = parseLatticeArgs(rest)
    if ('error' in args) {
      process.stderr.write(`${args.error}\n\n${USAGE}`)
      return 2
    }
    process.stdout.write(`${JSON.stringify(latticeReport(args), null, 2)}\n`)
    return 0
  }
  process.stderr.write(`unknown command: ${command}\n\n${USAGE}`)
  return 2
}

try {
  process.exitCode = main(process.argv.slice(2))
} catch (error) {
  if (error instanceof CoreError) {
    process.stderr.write(
      `error: ${error.code}${error.line === undefined ? '' : ` (line ${error.line})`} ${JSON.stringify(error.params)}\n`,
    )
    process.exitCode = 1
  } else {
    throw error
  }
}
