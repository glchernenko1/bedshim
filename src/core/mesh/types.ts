import type { CoreMessage } from '../messages'

/** Interpolation algorithms Klipper can store in a mesh profile. */
export type MeshAlgo = 'bicubic' | 'bilinear' | 'lagrange' | 'direct'

/** How the text was recognised (SPEC §5.1 shapes A, B, C). */
export type MeshSource = 'save_config' | 'block' | 'points'

export interface MeshBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/**
 * A parsed Klipper bed mesh. `points[row][col]` follows the mesh file:
 * row 0 is `min_y` (front), column 0 is `min_x` (left). SPEC §2, §5.1.
 */
export interface Mesh {
  name: string
  version: number
  xCount: number
  yCount: number
  points: number[][]
  /** null when the text carried no min/max keys (shape C); the UI asks for them. */
  bounds: MeshBounds | null
  algo: MeshAlgo
  tension: number
  meshXPps: number
  meshYPps: number
  source: MeshSource
  /** Which values were absent from the text and filled with defaults. */
  inferred: {
    counts: boolean
    bounds: boolean
    algo: boolean
    tension: boolean
    pps: boolean
  }
  /** Keys present in the block but not used by bedshim (SPEC §5.1). */
  ignoredKeys: string[]
  notices: CoreMessage[]
}

export interface MeshProfileRef {
  name: string
}

export interface ParseResult {
  mesh: Mesh
  /** Every `[bed_mesh <name>]` block found, in file order. */
  profiles: MeshProfileRef[]
}
