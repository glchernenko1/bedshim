#!/usr/bin/env node
// Headless CLI stub (SPEC §11): proves `src/core` runs under Node with no
// browser globals. The STL writer joins it in P5.
//
//   npm run cli -- parse fixtures/neptune4-mesh.cfg [--profile default]
import { readFileSync } from 'node:fs'
import { CoreError } from '../src/core/errors'
import { createSurface } from '../src/core/mesh/interpolate'
import { parseMesh } from '../src/core/mesh/parse'

const USAGE = `bedshim — Klipper bed mesh tools (headless)

Usage:
  bedshim parse <file> [--profile <name>]   Parse a mesh and print its report
  bedshim --help                            Show this help

Build the CLI with \`npm run cli -- <args>\`.
`

interface Command {
  file: string
  profile?: string
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

function main(argv: string[]): number {
  const [command, ...rest] = argv
  if (command === undefined || command === '--help' || command === '-h') {
    process.stdout.write(USAGE)
    return 0
  }
  if (command !== 'parse') {
    process.stderr.write(`unknown command: ${command}\n\n${USAGE}`)
    return 2
  }
  const args = parseArgs(rest)
  if ('error' in args) {
    process.stderr.write(`${args.error}\n\n${USAGE}`)
    return 2
  }
  process.stdout.write(`${JSON.stringify(report(args.file, args), null, 2)}\n`)
  return 0
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
