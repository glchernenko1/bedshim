import { useEffect } from 'react'
import { Button, Space, notification } from 'antd'
import type { CoreMessage } from '../core/messages'
import { useT } from '../i18n'
import { useAppStore, type Measurement } from '../state/store'

const KEY = 'plan-ceiling'

/**
 * Floating layer-headroom warning: it sits above every card, offers the
 * suggested max-layers value, and can be acknowledged for this measurement so
 * it does not nag again for the same bed.
 */
export function PlanCeilingNotice({
  message,
  measurement,
}: {
  message: CoreMessage
  measurement: Measurement
}) {
  const t = useT()
  const [api, contextHolder] = notification.useNotification()
  const setPlanSettings = useAppStore((state) => state.setPlanSettings)
  const dismissCeiling = useAppStore((state) => state.dismissCeiling)
  const suggest = Number(message.params?.suggest ?? 0)
  const dismissed = measurement.ceilingDismissed === true

  useEffect(() => {
    if (dismissed || !(suggest > 0)) {
      api.destroy(KEY)
      return
    }
    const close = (): void => {
      api.destroy(KEY)
      dismissCeiling(measurement.id)
    }
    api.warning({
      key: KEY,
      placement: 'top',
      duration: false,
      closable: true,
      title: t('plan.ceiling.title'),
      description: t(message.code, message.params),
      actions: (
        <Space size={8} wrap>
          <Button
            size="small"
            type="primary"
            onClick={() => {
              api.destroy(KEY)
              setPlanSettings({ maxLayers: suggest })
            }}
          >
            {t('plan.ceiling.raise', { count: suggest })}
          </Button>
          <Button size="small" onClick={close}>
            {t('plan.ceiling.ok')}
          </Button>
        </Space>
      ),
      onClose: close,
      style: { width: 'min(384px, calc(100vw - 32px))' },
    })
  }, [
    api,
    dismissCeiling,
    dismissed,
    measurement.id,
    message.code,
    message.params,
    setPlanSettings,
    suggest,
    t,
  ])

  return contextHolder
}
