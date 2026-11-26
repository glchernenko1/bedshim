import { Alert, Button, Space } from 'antd'
import type { AutoCalibrationState } from '../core/calibration'
import { useT } from '../i18n'
import { useAppStore } from '../state/store'

/**
 * One-line explanation of what Auto mode did, or why it is still waiting for
 * data. It replaces the Calibration tab in Auto mode (SPEC §9.2).
 */
export function AutoCalibrationStatus({ state }: { state: AutoCalibrationState | null }) {
  const t = useT()
  const setMeasurementLayers = useAppStore((app) => app.setMeasurementLayers)

  if (!state) return null

  if (state.status === 'noPair') {
    return (
      <Alert
        type="info"
        showIcon
        title={t('auto.status.noPair.title')}
        description={t('auto.status.noPair.body')}
      />
    )
  }

  const params = { previous: state.from.label, current: state.to.label }

  if (state.status === 'blocked') {
    const isRecoverable = state.problem === 'toNoLayers' && state.from.applied !== null
    return (
      <Alert
        type={isRecoverable ? 'warning' : 'info'}
        showIcon
        title={t('auto.status.blocked.title', {
          reason: t(`calib.reason.${state.problem}.title`, params),
        })}
        description={
          <Space orientation="vertical" size={8}>
            <span>{t(`calib.reason.${state.problem}.body`, params)}</span>
            {isRecoverable && (
              <Button
                size="small"
                onClick={() => setMeasurementLayers(state.to.id, state.from.applied!.layers)}
              >
                {t('calib.reason.currentNoLayers.action', { previous: state.from.label })}
              </Button>
            )}
          </Space>
        }
      />
    )
  }

  if (state.status === 'inconclusive') {
    return (
      <Alert
        type="warning"
        showIcon
        title={t('auto.status.inconclusive.title', params)}
        description={t('auto.status.inconclusive.body', {
          ...params,
          noise: state.result.fit.noise.toFixed(4),
          r2: state.result.fit.r2.toFixed(2),
        })}
      />
    )
  }

  return (
    <Alert
      type="success"
      showIcon
      title={t('auto.status.done.title', params)}
      description={
        <Space orientation="vertical" size={4}>
          <span>
            {t('auto.status.done.body', {
              ...params,
              sigma: state.values.sigma.toFixed(1),
            })}
          </span>
          {state.result.fit.tsSource === 'previous' && (
            <span>{t('auto.status.done.tsKept', { ts: state.result.fit.ts.toFixed(4) })}</span>
          )}
          {state.result.fit.tsSource === 'fallback' && (
            <span>{t('auto.status.done.firstOnly')}</span>
          )}
        </Space>
      }
    />
  )
}
