import { Flex, Typography } from 'antd'
import type { Surface } from '../core/mesh/interpolate'
import { useT } from '../i18n'
import { MeshHeatmap } from './MeshHeatmap'

/**
 * Predicted bed after taping, drawn exactly like the measured-mesh 2D map:
 * interpolated surface, probe nodes, hover readout and a colour bar. Colour is
 * centred on the median height so the common level (which the Z offset removes)
 * does not flood the whole plate with one hue.
 */
export function PredictedRelief({
  surface,
  baseline,
  maxAbs,
}: {
  surface: Surface
  baseline: number
  maxAbs: number
}) {
  const t = useT()
  const min = baseline - maxAbs
  const max = baseline + maxAbs

  return (
    <div style={{ width: '100%' }}>
      <Flex align="center" justify="flex-end" gap={8} wrap style={{ marginBottom: 8 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('plan.forward.map.relief.range', { min: min.toFixed(3), max: max.toFixed(3) })}
        </Typography.Text>
      </Flex>

      <MeshHeatmap surface={surface} maxAbs={maxAbs} baseline={baseline} />

      <div
        style={{
          height: 10,
          marginTop: 10,
          borderRadius: 5,
          background: 'linear-gradient(90deg, rgb(43, 108, 176), rgb(247, 247, 247), rgb(197, 48, 48))',
        }}
      />
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
        {t('plan.forward.map.relief.note', { baseline: baseline.toFixed(3) })}
        <br />
        {t('heatmap.probeMarkers')}
      </Typography.Text>
    </div>
  )
}
