import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Lang } from '../i18n'

export interface AppState {
  lang: Lang
  setLang: (lang: Lang) => void
}

// Only UI preferences live here for now; project data (meshes, layers,
// iterations) gets its own persisted slice when the plan lands in P2.
export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      lang: 'en',
      setLang: (lang) => set({ lang }),
    }),
    { name: 'bedshim.settings', version: 1 },
  ),
)
