import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Lang } from '../i18n'
import type { Mesh, MeshProfileRef } from '../core/mesh/types'

export interface AppState {
  lang: Lang
  setLang: (lang: Lang) => void
  /** Text as pasted, kept so the Mesh tab survives a reload. */
  meshText: string
  setMeshText: (text: string) => void
  /** Parsed mesh, shared with the Plan tab. */
  mesh: Mesh | null
  profiles: MeshProfileRef[]
  setMesh: (mesh: Mesh | null, profiles?: MeshProfileRef[]) => void
}

// UI preferences and the current project data. Persisted to localStorage.
export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      lang: 'en',
      setLang: (lang) => set({ lang }),
      meshText: '',
      setMeshText: (meshText) => set({ meshText }),
      mesh: null,
      profiles: [],
      setMesh: (mesh, profiles = []) => set({ mesh, profiles }),
    }),
    { name: 'bedshim.settings', version: 2 },
  ),
)
