import { useEffect, useMemo } from 'react'
import { autoCalibration, type AutoCalibrationState } from '../core/calibration'
import { useAppStore } from '../state/store'

/**
 * Auto mode's calibration loop: fit the last pair and apply t1/ts/σ/rounding
 * as soon as the pair is complete and conclusive. The guard compares the stored
 * values with the fitted ones, so a pending effect cannot overwrite a value it
 * has just written and the hook is idempotent across re-renders.
 */
export function useAutoCalibration(): AutoCalibrationState | null {
  const mode = useAppStore((state) => state.mode)
  const measurements = useAppStore((state) => state.measurements)
  const calibrated = useAppStore((state) => state.material.calibrated)
  const t1 = useAppStore((state) => state.material.t1)
  const sigma = useAppStore((state) => state.sigma)

  const state = useMemo(
    () =>
      mode === 'auto'
        ? autoCalibration({
            measurements,
            fixedT1: calibrated ? t1 : undefined,
            fallbackSigma: sigma,
          })
        : null,
    [mode, measurements, calibrated, t1, sigma],
  )

  useEffect(() => {
    if (!state || state.status !== 'ready') return
    const { values } = state
    const current = useAppStore.getState()
    const material = current.material
    const sameMaterial =
      material.calibrated && material.t1 === values.t1 && material.ts === values.ts
    if (sameMaterial && current.sigma === values.sigma && current.rounding === values.rounding) return

    useAppStore.getState().setMaterial({
      ...material,
      t1: values.t1,
      ts: values.ts,
      calibrated: true,
    })
    if (current.sigma !== values.sigma) useAppStore.getState().setSigma(values.sigma)
    if (current.rounding !== values.rounding) useAppStore.getState().setRounding(values.rounding)
  }, [state])

  return state
}
