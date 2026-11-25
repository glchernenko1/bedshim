/**
 * Dev-only sample meshes.
 *
 * Loaded through a dynamic import guarded by `import.meta.env.DEV`, so the
 * production build (GitHub Pages) drops this module, its fixture text and the
 * "Load example" button. Tests import the fixtures themselves.
 */
import original from '../../fixtures/neptune4-mesh.block?raw'
import pass1 from '../../fixtures/test-after-pass1.cfg?raw'
import pass2 from '../../fixtures/test-after-pass2.cfg?raw'

export type ExampleKey = '1' | '2' | '3'

export const EXAMPLES: Record<ExampleKey, string> = {
  '1': original,
  '2': pass1,
  '3': pass2,
}

export function isExampleKey(key: string): key is ExampleKey {
  return key === '1' || key === '2' || key === '3'
}
