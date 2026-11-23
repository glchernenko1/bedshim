import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Lang } from '../i18n'
import type { Mesh, MeshProfileRef } from '../core/mesh/types'
import { DEFAULT_MATERIAL, type Material } from '../core/material'

/** Geometry of a plan the user says they applied to the bed. */
export interface AppliedPlan {
  layers: number[][]
  tapeWidth: number
  plateW: number
  plateH: number
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

export interface AppState {
  lang: Lang
  setLang: (lang: Lang) => void
  material: Material
  setMaterial: (material: Material) => void

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
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      lang: 'en',
      setLang: (lang) => set({ lang }),
      material: DEFAULT_MATERIAL,
      setMaterial: (material) => set({ material }),

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

      clearMeasurements: () => set({ measurements: [], selectedId: null, pending: null }),
    }),
    {
      name: 'bedshim.settings',
      version: 4,
      // Older builds stored a single mesh; missing keys fall back to the defaults.
      migrate: (persisted) => persisted as AppState,
    },
  ),
)
