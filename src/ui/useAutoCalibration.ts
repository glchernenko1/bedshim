import { useEffect, useMemo } from 'react'
import { autoCalibration, calibrationMeasuresTape, type AutoCalibrationState } from '../core/calibration'
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
  const ts = useAppStore((state) => state.material.ts)
  const sigma = useAppStore((state) => state.sigma)

  const state = useMemo(
    () =>
      mode === 'auto'
        ? autoCalibration({
            measurements,
            fixedT1: calibrated ? t1 : undefined,
            fixedTs: calibrated && ts !== null ? ts : undefined,
            fallbackSigma: sigma,
          })
        : null,
    [mode, measurements, calibrated, t1, ts, sigma],
  )

  useEffect(() => {
    if (!state || state.status !== 'ready') return
    const { values } = state
    const current = useAppStore.getState()
    // The latest applied pair defines what the forecast may trust: a first-layer
    // change plus a measured ts (this pair or the previous calibration) and an
    // identifiable σ. A one-layer fit with no previous ts leaves ts = t1.
    const measured = calibrationMeasuresTape(state.result)
    if (measured) {
      if (!current.bridgingMeasured) current.setBridgingMeasured(true)
    } else if (!(state.result.fit.tsSource === 'previous' && current.bridgingMeasured)) {
      // A pair that only re-fitted t1 keeps the previously measured ts and σ.
      current.setBridgingMeasured(false)
    }
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
