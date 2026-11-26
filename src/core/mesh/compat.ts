import type { Mesh, MeshAlgo, MeshBounds } from './types'

/** Bounds are compared at a thousandth of a micron: text formatting must not matter. */
export const BOUNDS_TOLERANCE_MM = 1e-6

/** The mesh fields that must be identical for two maps to be compared node by node. */
export type ComparableMesh = Pick<Mesh, 'xCount' | 'yCount' | 'bounds' | 'algo'>

export interface StoredMesh {
  /** Measurement label shown to the user, e.g. `M1`. */
  label: string
  mesh: ComparableMesh
}

export type MeshDifference =
  | {
      field: 'grid'
      label: string
      stored: { x: number; y: number }
      incoming: { x: number; y: number }
    }
  | { field: 'bounds'; label: string; stored: MeshBounds; incoming: MeshBounds }
  | { field: 'algo'; label: string; stored: MeshAlgo; incoming: MeshAlgo }

export function sameBounds(
  a: MeshBounds,
  b: MeshBounds,
  tolerance = BOUNDS_TOLERANCE_MM,
): boolean {
  return (
    Math.abs(a.minX - b.minX) < tolerance &&
    Math.abs(a.maxX - b.maxX) < tolerance &&
    Math.abs(a.minY - b.minY) < tolerance &&
    Math.abs(a.maxY - b.maxY) < tolerance
  )
}

/**
 * Why an incoming mesh cannot join the stored measurements, or an empty list
 * when it can. Klipper re-probes on a new grid after `probe_count`, the
 * `mesh_min`/`mesh_max` bounds or `algo` changes, so those maps cannot be
 * aligned node by node: calibration and plan differences across them would mix
 * probes. The UI refuses the add and offers a fresh start (SPEC §5.1).
 *
 * One difference per field, naming the first stored measurement that differs.
 * Bounds are skipped when either side has none (shape C), because there is
 * nothing to compare and the missing-bounds warning covers that case.
 */
export function meshMismatches(
  incoming: ComparableMesh,
  stored: readonly StoredMesh[],
  tolerance = BOUNDS_TOLERANCE_MM,
): MeshDifference[] {
  const grid = stored.find(
    (item) => item.mesh.xCount !== incoming.xCount || item.mesh.yCount !== incoming.yCount,
  )
  const bounds = stored.find(
    (item) =>
      incoming.bounds !== null &&
      item.mesh.bounds !== null &&
      !sameBounds(incoming.bounds, item.mesh.bounds, tolerance),
  )
  const algo = stored.find((item) => item.mesh.algo !== incoming.algo)

  const differences: MeshDifference[] = []
  if (grid) {
    differences.push({
      field: 'grid',
      label: grid.label,
      stored: { x: grid.mesh.xCount, y: grid.mesh.yCount },
      incoming: { x: incoming.xCount, y: incoming.yCount },
    })
  }
  if (bounds && incoming.bounds && bounds.mesh.bounds) {
    differences.push({
      field: 'bounds',
      label: bounds.label,
      stored: bounds.mesh.bounds,
      incoming: incoming.bounds,
    })
  }
  if (algo) {
    differences.push({
      field: 'algo',
      label: algo.label,
      stored: algo.mesh.algo,
      incoming: incoming.algo,
    })
  }
  return differences
}
