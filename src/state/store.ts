import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Lang } from '../i18n'
import type { Mesh, MeshProfileRef } from '../core/mesh/types'
import { DEFAULT_MATERIAL, type Material } from '../core/material'
import { fitPlateToMesh } from '../core/grid'
import type { Rounding } from '../core/plan'

/** The tape roll the plan is cut from, mm (owner limit). */
export const TAPE_WIDTH_MIN = 5
export const TAPE_WIDTH_MAX = 50

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
  /** The user accepted the tight max-layer headroom for this mesh. */
  ceilingDismissed?: boolean
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
  /** Stop showing the low max-layer headroom notice for this measurement. */
  dismissCeiling: (id: string) => void

  /** The probe-grid hint was acknowledged; cleared for a new tape width or a fresh list. */
  probeNoticeDismissed: boolean
  dismissProbeNotice: () => void
  resetProbeNotice: () => void

  /** A calibration measured σ and the further-layer lift, so the forecast is not a guess. */
  bridgingMeasured: boolean
  setBridgingMeasured: (measured: boolean) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      lang: 'en',
      setLang: (lang) => set({ lang }),
      mode: 'auto',
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
      probeNoticeDismissed: false,
      bridgingMeasured: false,

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
          // A mesh is measured on the plate, so it can never be larger than it.
          const plate = mesh.bounds
            ? fitPlateToMesh({ w: state.planSettings.plateW, h: state.planSettings.plateH }, mesh.bounds)
            : null
          return {
            measurements: [...state.measurements, measurement],
            selectedId: id,
            pending: null,
            ...(plate
              ? { planSettings: { ...state.planSettings, plateW: plate.w, plateH: plate.h } }
              : {}),
          }
        }),

      selectMeasurement: (selectedId) =>
        set((state) => {
          const selected = state.measurements.find((item) => item.id === selectedId)
          if (!selected?.mesh.bounds) return { selectedId }
          const plate = fitPlateToMesh(
            { w: state.planSettings.plateW, h: state.planSettings.plateH },
            selected.mesh.bounds,
          )
          if (plate.w === state.planSettings.plateW && plate.h === state.planSettings.plateH) {
            return { selectedId }
          }
          return {
            selectedId,
            planSettings: { ...state.planSettings, plateW: plate.w, plateH: plate.h },
          }
        }),

      removeMeasurement: (id) =>
        set((state) => {
          const measurements = state.measurements.filter((item) => item.id !== id)
          const selectedId =
            state.selectedId === id ? (measurements[measurements.length - 1]?.id ?? null) : state.selectedId
          // Removing the last bed is a fresh start: hints may appear again.
          return { measurements, selectedId, ...(measurements.length === 0 ? { probeNoticeDismissed: false } : {}) }
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
          probeNoticeDismissed: false,
          bridgingMeasured: false,
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

      dismissCeiling: (id) =>
        set((state) => ({
          measurements: state.measurements.map((item) =>
            item.id === id ? { ...item, ceilingDismissed: true } : item,
          ),
        })),

      dismissProbeNotice: () => set({ probeNoticeDismissed: true }),
      resetProbeNotice: () => set({ probeNoticeDismissed: false }),
      setBridgingMeasured: (bridgingMeasured) => set({ bridgingMeasured }),
    }),
    {
      name: 'bedshim.settings',
      version: 8,
      // Older builds stored a single mesh; missing keys fall back to the defaults.
      // v8 introduces Pro/Auto with Auto as the starting mode, including for
      // states written before the switch existed.
      migrate: (persisted) => ({ ...(persisted as AppState), mode: 'auto' }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<AppState>
        const merged = { ...current, ...saved } as AppState
        const tape = Number(merged.planSettings?.tapeWidth)
        const tapeWidth = Number.isFinite(tape)
          ? Math.min(TAPE_WIDTH_MAX, Math.max(TAPE_WIDTH_MIN, tape))
          : current.planSettings.tapeWidth
        let plate = {
          w: Number(merged.planSettings?.plateW) || current.planSettings.plateW,
          h: Number(merged.planSettings?.plateH) || current.planSettings.plateH,
        }
        const selected = merged.measurements?.find((item) => item.id === merged.selectedId)
        if (selected?.mesh.bounds) plate = fitPlateToMesh(plate, selected.mesh.bounds)
        merged.planSettings = {
          ...current.planSettings,
          ...merged.planSettings,
          tapeWidth,
          plateW: plate.w,
          plateH: plate.h,
        }
        return merged
      },
    },
  ),
)
