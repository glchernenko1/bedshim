/**
 * Tape as a physical material (SPEC §1.3, §9.3).
 * `lift(n)` is the effective height of `n` layers: the first layer compresses
 * more than the rest, so the model needs two parameters, not one.
 */
export interface Material {
  nominal: number
  /** Effective mm added by the first layer. */
  t1: number
  /**
   * Effective mm added by every further layer. null = not measured yet; the
   * calculation then treats further layers as t1 instead of inventing a value.
   */
  ts: number | null
  calibrated: boolean
}

/** SPEC §9.3 fallback while the material is not measured. */
export const DEFAULT_MATERIAL: Material = {
  nominal: 0.05,
  t1: 0.03,
  ts: null,
  calibrated: false,
}

/** Effective lift of every layer after the first: ts when known, otherwise t1. */
export function furtherLayer(material: Material): number {
  return material.ts ?? material.t1
}

export function lift(material: Material, layers: number): number {
  if (layers <= 0) return 0
  return material.t1 + (layers - 1) * furtherLayer(material)
}

/** Corrections below this are not worth a layer (SPEC §1.4). */
export function deadbandOf(material: Material): number {
  return 0.4 * furtherLayer(material)
}
