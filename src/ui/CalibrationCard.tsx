import { useState } from 'react'
import { Alert, Button, Card, Col, Row, Space, Statistic, Typography } from 'antd'
import { fitMaterial, type FitResult } from '../core/calibrate'
import { buildGrid } from '../core/grid'
import { createSurface } from '../core/mesh/interpolate'
import { useT } from '../i18n'
import { useAppStore } from '../state/store'

function boundsMatch(
  a: { minX: number; maxX: number; minY: number; maxY: number },
  b: { minX: number; maxX: number; minY: number; maxY: number },
): boolean {
  return (
    Math.abs(a.minX - b.minX) < 1e-6 &&
    Math.abs(a.maxX - b.maxX) < 1e-6 &&
    Math.abs(a.minY - b.minY) < 1e-6 &&
    Math.abs(a.maxY - b.maxY) < 1e-6
  )
}

/**
 * Fits t1/ts from two stored meshes and the layer states between them (SPEC §9.2).
 * The pair is always "the previous measurement → the selected one".
 */
export function CalibrationCard() {
  const t = useT()
  const measurements = useAppStore((state) => state.measurements)
  const selectedId = useAppStore((state) => state.selectedId)
  const material = useAppStore((state) => state.material)
  const setMaterial = useAppStore((state) => state.setMaterial)
  const [fit, setFit] = useState<FitResult | null>(null)

  if (measurements.length < 2) return null
  const index = measurements.findIndex((item) => item.id === selectedId)
  const current = index >= 0 ? measurements[index] : null
  const previous = index > 0 ? measurements[index - 1] : null

  // The first measurement is a bare bed by assumption: if no layer state was
  // recorded, zeros are the state before the applied plan.
  const previousLayers =
    previous?.layers ??
    (previous?.applied ? previous.applied.layers.map((row) => row.map(() => 0)) : null)

  const canFit = Boolean(
    current &&
      previous &&
      previousLayers &&
      current.layers &&
      previous.applied &&
      previous.mesh.bounds &&
      current.mesh.bounds &&
      previous.mesh.xCount === current.mesh.xCount &&
      previous.mesh.yCount === current.mesh.yCount &&
      boundsMatch(previous.mesh.bounds, current.mesh.bounds),
  )

  const run = (): void => {
    if (!current || !previous || !previousLayers || !current.layers || !previous.applied) return
    if (!previous.mesh.bounds) return
    const grid = buildGrid({
      plate: { w: previous.applied.plateW, h: previous.applied.plateH },
      meshBounds: previous.mesh.bounds,
      tapeWidth: previous.applied.tapeWidth,
      meshXCount: previous.mesh.xCount,
      meshYCount: previous.mesh.yCount,
    })
    setFit(
      fitMaterial({
        oldSurface: createSurface(previous.mesh),
        newSurface: createSurface(current.mesh),
        oldLayers: previousLayers,
        newLayers: current.layers,
        grid,
      }),
    )
  }

  const apply = (): void => {
    if (!fit) return
    setMaterial({ ...material, t1: fit.t1, ts: fit.ts, calibrated: true })
  }

  return (
    <Card title={t('calib.title')}>
      <Space orientation="vertical" size={10} style={{ width: '100%' }}>
        {!canFit ? (
          <Alert type="info" showIcon title={t('calib.needPair.title')} description={t('calib.needPair.body')} />
        ) : (
          <>
            <Typography.Text type="secondary">
              {t('calib.pair', { from: previous?.label ?? '', to: current?.label ?? '' })}
            </Typography.Text>
            <Space size={8} wrap>
              <Button type="primary" onClick={run}>
                {t('calib.run')}
              </Button>
              {material.calibrated && <Typography.Text type="secondary">{t('calib.current', { t1: material.t1.toFixed(4), ts: material.ts.toFixed(4) })}</Typography.Text>}
            </Space>

            {fit && (
              <>
                <Row gutter={[12, 8]}>
                  <Col xs={12} md={6}>
                    <Statistic title={t('calib.t1')} value={fit.t1} precision={4} suffix="mm" />
                  </Col>
                  <Col xs={12} md={6}>
                    <Statistic title={t('calib.ts')} value={fit.ts} precision={4} suffix="mm" />
                  </Col>
                  <Col xs={12} md={6}>
                    <Statistic title={t('calib.r2')} value={fit.r2} precision={3} />
                  </Col>
                  <Col xs={12} md={6}>
                    <Statistic title={t('calib.noise')} value={fit.noise} precision={4} suffix="mm" />
                  </Col>
                </Row>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('calib.counts', {
                    counts:
                      fit.counts
                        .filter((item) => item.delta !== 0)
                        .map((item) => `${item.delta > 0 ? '+' : ''}${item.delta}: ${item.cells}`)
                        .join(', ') || '—',
                  })}
                </Typography.Text>
                {fit.warnings.map((warning, index) => (
                  <Alert
                    key={`${warning.code}-${index}`}
                    type={
                      warning.code === 'calibrate.error.noChanges' || warning.code === 'calibrate.warn.negative'
                        ? 'error'
                        : warning.code === 'calibrate.warn.inconclusive'
                          ? 'warning'
                          : 'info'
                    }
                    showIcon
                    title={t(warning.code, warning.params)}
                  />
                ))}
                <Space size={8} wrap>
                  <Button type="primary" onClick={apply} disabled={!fit.conclusive}>
                    {t('calib.apply')}
                  </Button>
                  {material.calibrated && <Typography.Text type="secondary">{t('calib.applied')}</Typography.Text>}
                </Space>
              </>
            )}
          </>
        )}
      </Space>
    </Card>
  )
}
