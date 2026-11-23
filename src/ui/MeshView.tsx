import { useMemo, useState } from 'react'
import { Flex, Segmented, Typography } from 'antd'
import type { Surface } from '../core/mesh/interpolate'
import { useT } from '../i18n'
import { MeshHeatmap } from './MeshHeatmap'
import { MeshSurface3D } from './MeshSurface3D'

export type ChartMode = '2d' | '3d'

/** 2D/3D switch for the measured mesh. Both views read the same surface. */
export function MeshView({ surface }: { surface: Surface }) {
  const t = useT()
  const [mode, setMode] = useState<ChartMode>('2d')

  const maxAbs = useMemo(() => {
    let max = 0
    for (const row of surface.sampled) {
      for (const value of row) max = Math.max(max, Math.abs(value))
    }
    return max
  }, [surface])

  return (
    <div style={{ width: '100%' }}>
      <Flex align="center" justify="space-between" gap={8} wrap style={{ marginBottom: 8 }}>
        <Segmented<ChartMode>
          value={mode}
          onChange={(value) => setMode(value)}
          options={[
            { label: t('mesh.view.2d'), value: '2d' },
            { label: t('mesh.view.3d'), value: '3d' },
          ]}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('heatmap.legend.value', { min: (-maxAbs).toFixed(3), max: maxAbs.toFixed(3) })}
        </Typography.Text>
      </Flex>

      {mode === '2d' ? (
        <MeshHeatmap surface={surface} maxAbs={maxAbs} />
      ) : (
        <MeshSurface3D surface={surface} maxAbs={maxAbs} />
      )}

      <div
        style={{
          height: 10,
          marginTop: 10,
          borderRadius: 5,
          background: 'linear-gradient(90deg, rgb(43, 108, 176), rgb(247, 247, 247), rgb(197, 48, 48))',
        }}
      />
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
        {mode === '2d' ? t('heatmap.probeMarkers') : t('mesh.view.markers3d')}
        <br />
        {t('heatmap.legend.note')}
      </Typography.Text>
    </div>
  )
}
