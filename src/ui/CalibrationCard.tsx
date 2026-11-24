import { useState } from 'react'
import { Alert, Button, Card, Col, Row, Select, Space, Statistic, Typography } from 'antd'
import { fitBridging, type BridgingResult } from '../core/calibrate'
import { buildGrid } from '../core/grid'
import { createSurface } from '../core/mesh/interpolate'
import type { Measurement } from '../state/store'
import { useAppStore } from '../state/store'
import { useT } from '../i18n'

function boundsMatch(a: Measurement['mesh']['bounds'], b: Measurement['mesh']['bounds']): boolean {
  if (!a || !b) return false
  return (
    Math.abs(a.minX - b.minX) < 1e-6 &&
    Math.abs(a.maxX - b.maxX) < 1e-6 &&
    Math.abs(a.minY - b.minY) < 1e-6 &&
    Math.abs(a.maxY - b.maxY) < 1e-6
  )
}

type Reason = 'same' | 'fromNoPlan' | 'toNoLayers' | 'geometry' | null

/**
 * Fits t1/ts from two stored meshes and the layer states between them (SPEC §9.2).
 * The pair defaults to the last two measurements and can be changed explicitly,
 * so marking a plan on the older mesh does not require re-selecting anything.
 */
export function CalibrationCard() {
  const t = useT()
  const measurements = useAppStore((state) => state.measurements)
  const material = useAppStore((state) => state.material)
  const setMaterial = useAppStore((state) => state.setMaterial)
  const sigma = useAppStore((state) => state.sigma)
  const setSigma = useAppStore((state) => state.setSigma)
  const setMeasurementLayers = useAppStore((state) => state.setMeasurementLayers)
  const setRounding = useAppStore((state) => state.setRounding)
  const [fromId, setFromId] = useState<string | null>(null)
  const [toId, setToId] = useState<string | null>(null)
  const [result, setResult] = useState<BridgingResult | null>(null)
  const fit = result?.fit ?? null

  if (measurements.length < 2) {
    return (
      <Card title={t('calib.title')}>
        <Alert type="info" showIcon title={t('calib.reason.noPair.title')} description={t('calib.reason.noPair.body')} />
      </Card>
    )
  }

  const defaultFrom = measurements[measurements.length - 2]!
  const defaultTo = measurements[measurements.length - 1]!
  const from = measurements.find((item) => item.id === fromId) ?? defaultFrom
  const to = measurements.find((item) => item.id === toId) ?? defaultTo

  const fromLayers =
    from.layers ?? (from.applied ? from.applied.layers.map((row) => row.map(() => 0)) : null)

  const reason: Reason = (() => {
    if (from.id === to.id) return 'same'
    if (!from.applied || !fromLayers) return 'fromNoPlan'
    if (!to.layers) return 'toNoLayers'
    if (
      from.mesh.xCount !== to.mesh.xCount ||
      from.mesh.yCount !== to.mesh.yCount ||
      !boundsMatch(from.mesh.bounds, to.mesh.bounds)
    ) {
      return 'geometry'
    }
    return null
  })()

  const options = [...measurements].reverse().map((item) => ({
    value: item.id,
    label: `${item.label} · ${new Date(item.createdAt).toLocaleDateString()}`,
  }))

  const run = (): void => {
    if (reason !== null || !from.applied || !fromLayers || !to.layers || !from.mesh.bounds) return
    const grid = buildGrid({
      plate: { w: from.applied.plateW, h: from.applied.plateH },
      meshBounds: from.mesh.bounds,
      tapeWidth: from.applied.tapeWidth,
      meshXCount: from.mesh.xCount,
      meshYCount: from.mesh.yCount,
      extendToPlate: from.applied.extendToPlate,
    })
    setResult(
      fitBridging({
        oldSurface: createSurface(from.mesh),
        newSurface: createSurface(to.mesh),
        oldLayers: fromLayers,
        newLayers: to.layers,
        grid,
        fixedT1: material.calibrated ? material.t1 : undefined,
        fallbackSigma: sigma,
      }),
    )
  }

  const apply = (): void => {
    if (!result) return
    const round = (value: number): number => Math.round(value * 10000) / 10000
    setMaterial({ ...material, t1: round(result.fit.t1), ts: round(result.fit.ts), calibrated: true })
    // The same pair also measures the bridging width and applies it at once.
    setSigma(Math.round(result.sigma * 10) / 10)
    // With both values measured, nearest-layer rounding is safe and expected.
    setRounding('round')
  }

  const params = { previous: from.label, current: to.label }

  return (
    <Card title={t('calib.title')}>
      <Space orientation="vertical" size={10} style={{ width: '100%' }}>
        <Row gutter={[12, 8]}>
          <Col xs={12} md={6}>
            <Typography.Text type="secondary">{t('calib.from')}</Typography.Text>
            <Select style={{ width: '100%' }} value={from.id} options={options} onChange={(value) => setFromId(value)} />
          </Col>
          <Col xs={12} md={6}>
            <Typography.Text type="secondary">{t('calib.to')}</Typography.Text>
            <Select style={{ width: '100%' }} value={to.id} options={options} onChange={(value) => setToId(value)} />
          </Col>
        </Row>

        {reason ? (
          <Alert
            type="info"
            showIcon
            title={t(`calib.reason.${reason}.title`, params)}
            description={
              <Space orientation="vertical" size={8}>
                <span>{t(`calib.reason.${reason}.body`, params)}</span>
                {reason === 'toNoLayers' && from.applied && (
                  <Button size="small" onClick={() => setMeasurementLayers(to.id, from.applied!.layers)}>
                    {t('calib.reason.currentNoLayers.action', { previous: from.label })}
                  </Button>
                )}
              </Space>
            }
          />
        ) : (
          <>
            <Space size={8} wrap>
              <Button type="primary" onClick={run}>
                {t('calib.run')}
              </Button>
              {material.calibrated && (
                <Typography.Text type="secondary">
                  {t('calib.current', {
                    t1: material.t1.toFixed(4),
                    ts: material.ts === null ? '—' : material.ts.toFixed(4),
                    sigma: sigma.toFixed(1),
                  })}
                </Typography.Text>
              )}
            </Space>

            {fit && (
              <>
                <Row gutter={[12, 8]}>
                  <Col xs={12} md={4}>
                    <Statistic title={t('calib.t1')} value={fit.t1} precision={4} suffix="mm" />
                  </Col>
                  <Col xs={12} md={4}>
                    <Statistic title={t('calib.ts')} value={fit.ts} precision={4} suffix="mm" />
                  </Col>
                  <Col xs={12} md={4}>
                    <Statistic title={t('calib.sigma')} value={result?.sigma ?? sigma} precision={1} suffix="mm" />
                  </Col>
                  <Col xs={12} md={4}>
                    <Statistic title={t('calib.r2')} value={fit.r2} precision={3} />
                  </Col>
                  <Col xs={12} md={4}>
                    <Statistic title={t('calib.noise')} value={fit.noise} precision={4} suffix="mm" />
                  </Col>
                </Row>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('calib.sigma.note')}
                </Typography.Text>
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
                        : warning.code === 'calibrate.warn.inconclusive' || warning.code === 'calibrate.warn.sigmaWeak'
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
