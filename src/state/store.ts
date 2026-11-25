import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Lang } from '../i18n'
import type { Mesh, MeshProfileRef } from '../core/mesh/types'
import { DEFAULT_MATERIAL, type Material } from '../core/material'
import type { Rounding } from '../core/plan'

/** Geometry of a plan the user says they applied to the bed. */
export interface AppliedPlan {
  layers: number[][]
  tapeWidth: number
  plateW: number
  plateH: number
  /** The plan included cells in the unprobed margin. */
  extendToPlate: boolean
}

export interface Measurement {
  id: string
  label: string
  createdAt: string
  /** Text as pasted, kept for inspection. */
  text: string
  mesh: Mesh
  profiles: MeshProfileRef[]
  /**
   * Absolute layers physically on the bed when this mesh was taken.
   * null = unknown (no plan was applied yet).
   */
  layers: number[][] | null
  /** Plan applied after this measurement; it is the state of the next mesh. */
  applied: AppliedPlan | null
}

let counter = 0

/**
 * Pro exposes every calibration control; Auto fits and applies t1/ts/σ itself
 * and keeps only the physical plan inputs (SPEC §9.2).
 */
export type AppMode = 'pro' | 'auto'

export interface PlanSettings {
  tapeWidth: number
  plateW: number
  plateH: number
  percentile: number
  maxLayers: number
  /** Add margin cells up to the plate edges and plan them from the nearest edge. */
  extendToPlate: boolean
}

export interface AppState {
  lang: Lang
  setLang: (lang: Lang) => void
  /** Pro shows all knobs; Auto calibrates by itself. */
  mode: AppMode
  setMode: (mode: AppMode) => void
  material: Material
  setMaterial: (material: Material) => void
  /** Geometry and target choices shared by the Plan and Lattice tabs. */
  planSettings: PlanSettings
  setPlanSettings: (patch: Partial<PlanSettings>) => void
  /** Bridging width of the plate, mm. Fitted by calibration, adjustable on the Plan tab. */
  sigma: number
  setSigma: (sigma: number) => void
  rounding: Rounding
  setRounding: (rounding: Rounding) => void

  /** Text in the paste box, kept across reloads. */
  draftText: string
  setDraftText: (text: string) => void

  measurements: Measurement[]
  selectedId: string | null
  /** A plan marked as glued after the selected measurement, waiting for a new mesh. */
  pending: AppliedPlan | null

  addMeasurement: (mesh: Mesh, text: string, profiles: MeshProfileRef[]) => void
  selectMeasurement: (id: string) => void
  removeMeasurement: (id: string) => void
  applyPlan: (plan: AppliedPlan) => void
  clearMeasurements: () => void
  /** Recovery: attach a known layer state to a measurement (e.g. a forgotten apply). */
  setMeasurementLayers: (id: string, layers: number[][]) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      lang: 'en',
      setLang: (lang) => set({ lang }),
      mode: 'pro',
      setMode: (mode) => set({ mode }),
      material: DEFAULT_MATERIAL,
      setMaterial: (material) => set({ material }),
      planSettings: {
        tapeWidth: 20,
        plateW: 235,
        plateH: 235,
        percentile: 0.85,
        maxLayers: 6,
        extendToPlate: false,
      },
      setPlanSettings: (patch) =>
        set((state) => ({ planSettings: { ...state.planSettings, ...patch } })),
      sigma: 22,
      setSigma: (sigma) => set({ sigma }),
      rounding: 'floor',
      setRounding: (rounding) => set({ rounding }),

      draftText: '',
      setDraftText: (draftText) => set({ draftText }),

      measurements: [],
      selectedId: null,
      pending: null,

      addMeasurement: (mesh, text, profiles) =>
        set((state) => {
          const selected = state.measurements.find((item) => item.id === state.selectedId)
          const layers = state.pending?.layers ?? selected?.layers ?? null
          const id = `m-${Date.now().toString(36)}-${counter++}`
          const measurement: Measurement = {
            id,
            label: `M${state.measurements.length + 1}`,
            createdAt: new Date().toISOString(),
            text,
            mesh,
            profiles,
            layers,
            applied: null,
          }
          return {
            measurements: [...state.measurements, measurement],
            selectedId: id,
            pending: null,
          }
        }),

      selectMeasurement: (selectedId) => set({ selectedId }),

      removeMeasurement: (id) =>
        set((state) => {
          const measurements = state.measurements.filter((item) => item.id !== id)
          const selectedId =
            state.selectedId === id ? (measurements[measurements.length - 1]?.id ?? null) : state.selectedId
          return { measurements, selectedId }
        }),

      applyPlan: (plan) =>
        set((state) => ({
          pending: plan,
          measurements: state.measurements.map((item) =>
            item.id === state.selectedId ? { ...item, applied: plan } : item,
          ),
        })),

      clearMeasurements: () =>
        set({
          measurements: [],
          selectedId: null,
          pending: null,
          // Calibration is derived from the measurements: clearing them must not
          // leave a "measured" material, round rounding or a fitted σ behind.
          material: { ...DEFAULT_MATERIAL },
          rounding: 'floor',
          sigma: 22,
        }),

      setMeasurementLayers: (id, layers) =>
        set((state) => ({
          measurements: state.measurements.map((item) => (item.id === id ? { ...item, layers } : item)),
        })),
    }),
    {
      name: 'bedshim.settings',
      version: 7,
      // Older builds stored a single mesh; missing keys fall back to the defaults.
      migrate: (persisted) => persisted as AppState,
    },
  ),
)
