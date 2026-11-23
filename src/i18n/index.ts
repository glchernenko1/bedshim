import { useMemo } from 'react'
import { useAppStore } from '../state/store'
import { en, type Dict } from './en'
import { ru } from './ru'

export type Lang = 'en' | 'ru'

export const DICTS: Record<Lang, Dict> = { en, ru }

export type TParams = Record<string, string | number>

/** Looks a key up and fills `{name}` placeholders. Unknown keys fall back to the key itself. */
export function translate(lang: Lang, key: string, params?: TParams): string {
  const template = DICTS[lang][key] ?? en[key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name]),
  )
}

export function useT(): (key: string, params?: TParams) => string {
  const lang = useAppStore((state) => state.lang)
  return useMemo(() => (key: string, params?: TParams) => translate(lang, key, params), [lang])
}

export function useLang(): Lang {
  return useAppStore((state) => state.lang)
}

export { en, ru }
