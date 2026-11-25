import { useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  Divider,
  InputNumber,
  Row,
  Segmented,
  Slider,
  Switch,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd'
import { buildGrid } from '../core/grid'
import { deadbandOf, furtherLayer } from '../core/material'
import { createSurface } from '../core/mesh/interpolate'
import { diffAgainstPhysical, plan, type Rounding } from '../core/plan'
import { predictPlan, predictedMeshBlock } from '../core/forward'
import type { AutoCalibrationState } from '../core/calibration'
import { bedMeshSnippet, idealProbeCount, probeAdvice, probeEstimate } from '../core/probe'
import { useT } from '../i18n'
import { useAppStore } from '../state/store'
import { AutoCalibrationStatus } from './AutoCalibrationStatus'
import { LayerLegend, PlanGridCanvas } from './PlanGridCanvas'
import { PredictedRelief } from './PredictedRelief'
import { ResidualMapCanvas } from './ResidualMapCanvas'
import { StripsCard } from './StripsCard'

type Verdict = 'coarse' | 'good' | 'fine' | 'slow'
type MapMode = 'residual' | 'relief'

function verdictOf(points: number): Verdict {
  if (points <= 25) return 'coarse'
  if (points <= 121) return 'good'
  if (points <= 420) return 'fine'
  return 'slow'
}

const fmt = (value: number, digits = 4): string => value.toFixed(digits)

export function PlanTab({ auto }: { auto: AutoCalibrationState | null }) {
  const t = useT()
  const mode = useAppStore((state) => state.mode)
  const isAuto = mode === 'auto'
  const measurements = useAppStore((state) => state.measurements)
  const selectedId = useAppStore((state) => state.selectedId)
  const measurement = measurements.find((item) => item.id === selectedId) ?? null
  const mesh = measurement?.mesh ?? null
  const applyPlan = useAppStore((state) => state.applyPlan)
  const pending = useAppStore((state) => state.pending)
  const material = useAppStore((state) => state.material)
  const setMaterial = useAppStore((state) => state.setMaterial)
  const rounding = useAppStore((state) => state.rounding)
  const setRounding = useAppStore((state) => state.setRounding)
  const sigma = useAppStore((state) => state.sigma)
  const setSigma = useAppStore((state) => state.setSigma)

  const planSettings = useAppStore((state) => state.planSettings)
  const setPlanSettings = useAppStore((state) => state.setPlanSettings)
  const { tapeWidth, plateW, plateH, percentile, maxLayers, extendToPlate } = planSettings
  const [mapMode, setMapMode] = useState<MapMode>('residual')

  const surface = useMemo(() => (mesh?.bounds ? createSurface(mesh) : null), [mesh])

  const grid = useMemo(() => {
    if (!mesh?.bounds) return null
    return buildGrid({
      plate: { w: plateW, h: plateH },
      meshBounds: mesh.bounds,
      tapeWidth,
      meshXCount: mesh.xCount,
      meshYCount: mesh.yCount,
      extendToPlate,
    })
  }, [mesh, plateW, plateH, tapeWidth, extendToPlate])

  const baseLayers = useMemo(() => {
    if (!grid) return undefined
    const stored = measurement?.layers
    if (stored && stored.length === grid.rows && (stored[0]?.length ?? 0) === grid.cols) return stored
    return Array.from({ length: grid.rows }, () => new Array<number>(grid.cols).fill(0))
  }, [grid, measurement])

  const layersMismatch = Boolean(
    measurement?.layers &&
      grid &&
      (measurement.layers.length !== grid.rows || (measurement.layers[0]?.length ?? 0) !== grid.cols),
  )

  const result = useMemo(() => {
    if (!surface || !grid) return null
    return plan({
      surface,
      grid,
      material,
      referencePercentile: percentile,
      rounding,
      maxLayers,
      baseLayers,
    })
  }, [surface, grid, material, percentile, rounding, maxLayers, baseLayers])

  const prediction = useMemo(() => {
    if (!surface || !result) return null
    return predictPlan(result, surface, { sigma })
  }, [surface, result, sigma])

  const diff = useMemo(() => {
    if (!result) return null
    const value = diffAgainstPhysical(result, baseLayers ?? [])
    return { ...value, changed: value.cells.filter((cell) => cell.delta !== 0) }
  }, [result, baseLayers])

  // The predicted bed as an interpolated surface, so the relief mode can use
  // the same 2D heatmap as the measured mesh (probe dots, hover, colour bar).
  const relief = useMemo(() => {
    if (!prediction || !mesh?.bounds) return null
    const points = prediction.predictedMesh.points
    const predictedSurface = createSurface({
      ...mesh,
      name: 'predicted',
      points,
      bounds: prediction.predictedMesh.bounds,
      xCount: prediction.predictedMesh.xCount,
      yCount: prediction.predictedMesh.yCount,
    })
    const flat = predictedSurface.sampled.flat()
    const sorted = [...flat].sort((a, b) => a - b)
    // Centre the colour on the median, not on zero: the common level is a Z
    // offset, and colouring it would flood the whole plate with one hue.
    const baseline = sorted[Math.floor(sorted.length / 2)] ?? 0
    const maxAbs = Math.max(1e-6, ...flat.map((value) => Math.abs(value - baseline)))
    return {
      surface: predictedSurface,
      baseline,
      maxAbs,
    }
  }, [prediction, mesh])

  const probeRows = useMemo(() => {
    if (!mesh?.bounds) return []
    const bounds = mesh.bounds
    const widths = [...new Set([50, 20, 15, 10, 5, tapeWidth])].sort((a, b) => b - a)
    return widths.map((width) => {
      const estimate = probeEstimate(bounds, width)
      return {
        key: width,
        width,
        grid: `${estimate.idealX}×${estimate.idealY}`,
        points: estimate.points,
        minutes: Math.round(estimate.minutes),
        verdict: verdictOf(estimate.points),
        current: width === tapeWidth,
      }
    })
  }, [mesh, tapeWidth])

  const advice = useMemo(() => {
    if (!mesh?.bounds) return []
    return probeAdvice({ bounds: mesh.bounds, tapeWidth, xCount: mesh.xCount, yCount: mesh.yCount })
  }, [mesh, tapeWidth])

  const snippet = useMemo(() => {
    if (!mesh?.bounds) return ''
    const ideal = idealProbeCount(mesh.bounds, tapeWidth)
    return bedMeshSnippet(mesh.bounds, ideal.x, ideal.y)
  }, [mesh, tapeWidth])

  if (!mesh) {
    return (
      <Space orientation="vertical" size={16} style={{ width: '100%' }}>
        {isAuto && <AutoCalibrationStatus state={auto} />}
        <Alert type="info" showIcon title={t('plan.noMesh.title')} description={t('plan.noMesh.body')} />
      </Space>
    )
  }

  const messages = [...(grid?.warnings ?? []), ...(result?.warnings ?? []), ...(surface?.notices ?? []), ...advice]
  const deadband = deadbandOf(material)

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      {isAuto && <AutoCalibrationStatus state={auto} />}
      <Card title={t('plan.inputs.title')}>
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          <Row gutter={[16, 12]}>
            <Col xs={12} sm={8} md={4}>
              <Typography.Text type="secondary">{t('plan.field.tape')}</Typography.Text>
              <InputNumber min={5} max={100} step={5} value={tapeWidth} onChange={(value) => value && setPlanSettings({ tapeWidth: value })} style={{ width: '100%' }} />
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Typography.Text type="secondary">{t('plan.field.plateW')}</Typography.Text>
              <InputNumber min={50} max={500} value={plateW} onChange={(value) => value && setPlanSettings({ plateW: value })} style={{ width: '100%' }} />
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Typography.Text type="secondary">{t('plan.field.plateH')}</Typography.Text>
              <InputNumber min={50} max={500} value={plateH} onChange={(value) => value && setPlanSettings({ plateH: value })} style={{ width: '100%' }} />
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Typography.Text type="secondary">{t('plan.field.extend')}</Typography.Text>
              <div>
                <Switch
                  checked={extendToPlate}
                  onChange={(checked) => setPlanSettings({ extendToPlate: checked })}
                />
              </div>
            </Col>
            {isAuto && (
              <Col xs={24}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('plan.auto.defaults', {
                    max: maxLayers,
                    percentile: percentile.toFixed(2),
                  })}
                  <br />
                  {t('auto.note')}
                </Typography.Text>
              </Col>
            )}
            {!isAuto && (
              <>
                <Col xs={12} sm={8} md={4}>
                  <Typography.Text type="secondary">{t('plan.field.maxLayers')}</Typography.Text>
                  <InputNumber min={1} max={12} value={maxLayers} onChange={(value) => value && setPlanSettings({ maxLayers: value })} style={{ width: '100%' }} />
                </Col>
                <Col xs={12} sm={8} md={4}>
                  <Typography.Text type="secondary">{t('plan.field.nominal')}</Typography.Text>
                  <InputNumber
                    min={0.01}
                    max={0.5}
                    step={0.01}
                    value={material.nominal}
                    onChange={(value) => {
                      if (!value) return
                      setMaterial(
                        material.calibrated
                          ? { ...material, nominal: value }
                          : { ...material, nominal: value, t1: 0.6 * value, ts: 0.6 * value },
                      )
                    }}
                    style={{ width: '100%' }}
                  />
                </Col>
                <Col xs={12} sm={8} md={4}>
                  <Typography.Text type="secondary">{t('plan.field.calibrated')}</Typography.Text>
                  <div>
                    <Switch
                      checked={material.calibrated}
                      onChange={(checked) => {
                        setMaterial({ ...material, calibrated: checked })
                        setRounding(checked ? 'round' : 'floor')
                      }}
                    />
                  </div>
                </Col>
                <Col xs={12} sm={8} md={4}>
                  <Typography.Text type="secondary">{t('plan.field.t1')}</Typography.Text>
                  <InputNumber
                    min={0.005}
                    max={0.3}
                    step={0.005}
                    disabled={!material.calibrated}
                    value={material.t1}
                    onChange={(value) => value && setMaterial({ ...material, t1: value })}
                    style={{ width: '100%' }}
                  />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t('plan.field.t1.hint')}
                  </Typography.Text>
                </Col>
                <Col xs={12} sm={8} md={4}>
                  <Typography.Text type="secondary">{t('plan.field.ts')}</Typography.Text>
                  <InputNumber
                    min={0.005}
                    max={0.3}
                    step={0.005}
                    disabled={!material.calibrated}
                    value={material.ts}
                    placeholder="—"
                    onChange={(value) => setMaterial({ ...material, ts: value === null ? null : value })}
                    style={{ width: '100%' }}
                  />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t('plan.field.ts.hint')}
                  </Typography.Text>
                </Col>
                <Col xs={24} sm={12} md={8}>
                  <Typography.Text type="secondary">{t('plan.field.rounding')}</Typography.Text>
                  <Segmented<Rounding>
                    block
                    value={rounding}
                    onChange={(value) => setRounding(value)}
                    options={[
                      { label: t('plan.rounding.floor'), value: 'floor' },
                      { label: t('plan.rounding.round'), value: 'round' },
                    ]}
                  />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t('plan.rounding.hint')}
                  </Typography.Text>
                </Col>
                <Col xs={24} md={12}>
                  <Typography.Text type="secondary">
                    {t('plan.field.percentile')} · {percentile.toFixed(2)}
                  </Typography.Text>
                  <Slider min={0.5} max={0.95} step={0.01} value={percentile} onChange={(value) => setPlanSettings({ percentile: Number(value) })} />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t('plan.field.percentile.hint')}
                  </Typography.Text>
                </Col>
                <Col xs={24} md={12}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t('plan.material.note', { deadband: fmt(deadband, 3) })}
                    <br />
                    {material.calibrated
                      ? material.ts === null
                        ? t('plan.material.tsMissing')
                        : t('plan.material.measured')
                      : t('plan.material.fallback')}
                    <br />
                    {t('plan.material.layers')}
                    <br />
                    {t('plan.material.auto')}
                    <br />
                    {t('plan.material.tsBigger')}
                  </Typography.Text>
                </Col>
              </>
            )}
          </Row>

          {!isAuto && (
            <Alert
              type="info"
              showIcon
              title={t('plan.rounding.first.title')}
              description={t('plan.rounding.first.body')}
            />
          )}
          {!isAuto && rounding === 'round' && !material.calibrated && (
            <Alert type="warning" showIcon title={t('plan.rounding.overshoot.title')} description={t('plan.rounding.overshoot.body')} />
          )}
          {extendToPlate && (
            <Alert
              type="warning"
              showIcon
              title={t('plan.extend.warning.title')}
              description={t('plan.extend.warning.body')}
            />
          )}

          <Divider style={{ margin: '4px 0' }} />

        </Space>
      </Card>

      {grid && result && (
        <>
          <Card title={t('plan.results.title')}>
            <Space orientation="vertical" size={12} style={{ width: '100%' }}>
              {layersMismatch && (
                <Alert
                  type="warning"
                  showIcon
                  title={t('plan.baseMismatch.title')}
                  description={t('plan.baseMismatch.body')}
                />
              )}
              <Row gutter={[12, 8]}>
                <Col xs={12} sm={8} md={4}>
                  <Statistic title={t('plan.stat.ref')} value={Number(result.reference.toFixed(4))} precision={4} suffix="mm" />
                </Col>
                <Col xs={12} sm={8} md={4}>
                  <Statistic title={t('plan.stat.layers')} value={result.stats.totalLayers} />
                </Col>
                <Col xs={12} sm={8} md={4}>
                  <Statistic title={t('plan.stat.cells')} value={result.stats.cellsWithTape} />
                </Col>
                <Col xs={12} sm={8} md={4}>
                  <Statistic title={t('plan.stat.length')} value={Math.round(result.stats.tapeLengthMM)} suffix="mm" />
                </Col>
                <Col xs={12} sm={8} md={4}>
                  <Statistic title={t('plan.stat.area')} value={result.stats.tapeAreaMM2 / 100} precision={1} suffix="cm²" />
                </Col>
                <Col xs={12} sm={8} md={4}>
                  <Statistic title={t('plan.stat.max')} value={result.stats.maxUsed} />
                </Col>
              </Row>

              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('plan.aboveRef', { count: result.cells.filter((cell) => cell.mean > result.reference).length })}
              </Typography.Text>

              {diff && (
                <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t('plan.diff.hint')}
                  </Typography.Text>
                  <Row gutter={[12, 8]}>
                    <Col xs={8} md={4}>
                      <Statistic title={t('plan.diff.add')} value={diff.add} />
                    </Col>
                    <Col xs={8} md={4}>
                      <Statistic title={t('plan.diff.peel')} value={diff.peel} />
                    </Col>
                    <Col xs={8} md={4}>
                      <Statistic title={t('plan.diff.unchanged')} value={diff.unchanged} />
                    </Col>
                  </Row>
                  {diff.changed.length === 0 ? (
                    <Typography.Text type="secondary">{t('plan.diff.empty')}</Typography.Text>
                  ) : (
                    <Collapse
                      size="small"
                      items={[
                        {
                          key: 'cells',
                          label: t('plan.diff.show', { count: diff.changed.length }),
                          children: (
                            <Table
                              size="small"
                              pagination={{ pageSize: 12, hideOnSinglePage: true }}
                              scroll={{ x: 360 }}
                              dataSource={diff.changed.map((cell) => ({ key: cell.id, ...cell }))}
                              columns={[
                                { title: t('plan.diff.table.cell'), dataIndex: 'id' },
                                { title: t('plan.diff.table.now'), dataIndex: 'physical' },
                                { title: t('plan.diff.table.plan'), dataIndex: 'planned' },
                                {
                                  title: t('plan.diff.table.delta'),
                                  dataIndex: 'delta',
                                  render: (value: number) => (
                                    <Tag color={value > 0 ? 'blue' : 'orange'}>{value > 0 ? `+${value}` : value}</Tag>
                                  ),
                                },
                              ]}
                            />
                          ),
                        },
                      ]}
                    />
                  )}
                </Space>
              )}

              {messages.map((message, index) => (
                <Alert key={`${message.code}-${index}`} type="info" showIcon title={t(message.code, message.params)} />
              ))}

              <Space orientation="vertical" size={6} style={{ width: '100%' }}>
                <Typography.Title level={5} style={{ margin: 0 }}>
                  {t('plan.map.title')}
                </Typography.Title>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('plan.map.hint', { cols: result.cols, rows: result.rows, w: result.grid.tapeWidth, h: fmt(result.grid.rowSpacing, 1) })}
                </Typography.Text>
                <PlanGridCanvas plan={result} />
                <LayerLegend maxUsed={result.stats.maxUsed} />
              </Space>

              <Space size={8} wrap>
                <Button type="primary" onClick={() => applyPlan({ layers: result.layers, tapeWidth, plateW, plateH, extendToPlate })}>
                  {t('plan.apply')}
                </Button>
                {pending && <Typography.Text type="secondary">{t('plan.applied.tag')}</Typography.Text>}
              </Space>
              {pending && <Alert type="success" showIcon title={t('plan.applied.title')} description={t('plan.applied.body')} />}
            </Space>
          </Card>

          <StripsCard plan={result} />

          {prediction && (
            <Card title={t('plan.forward.title')}>
              <Space orientation="vertical" size={12} style={{ width: '100%' }}>
                <Row gutter={[12, 8]}>
                  <Col xs={12} sm={8} md={4}>
                    <Statistic title={t('plan.forward.delivered')} value={prediction.delivered * 100} precision={0} suffix="%" />
                  </Col>
                  <Col xs={12} sm={8} md={4}>
                    <Statistic title={t('plan.forward.achievable')} value={prediction.achievable * 100} precision={0} suffix="%" />
                  </Col>
                  <Col xs={12} sm={8} md={4}>
                    <Statistic title={t('plan.forward.spread')} value={prediction.spreadResidual} precision={4} suffix="mm" />
                  </Col>
                  <Col xs={12} sm={8} md={4}>
                    <Statistic title={t('plan.forward.max')} value={prediction.maxAbsResidual} precision={4} suffix="mm" />
                  </Col>
                  <Col xs={12} sm={8} md={4}>
                    <Statistic title={t('plan.forward.rms')} value={prediction.rmsResidual} precision={4} suffix="mm" />
                  </Col>
                </Row>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('plan.forward.spread.note')}
                </Typography.Text>

                <Space size={8} wrap>
                  <Tag
                    color={
                      prediction.delivered < 0.6
                        ? 'error'
                        : prediction.achievable >= 0.9
                          ? 'success'
                          : prediction.achievable >= 0.6
                            ? 'warning'
                            : 'blue'
                    }
                  >
                    {t(
                      `plan.forward.band.${
                        prediction.delivered < 0.6
                          ? 'poor'
                          : prediction.achievable >= 0.9
                            ? 'good'
                            : prediction.achievable >= 0.6
                              ? 'partial'
                              : 'undershoot'
                      }`,
                    )}
                  </Tag>
                  <Typography.Text type="secondary">
                    {t('plan.forward.achievable.hint', {
                      ok: prediction.cells.filter((cell) => cell.plannedLift > 0 && cell.ok).length,
                      taped: prediction.cells.filter((cell) => cell.plannedLift > 0).length,
                      delivered: Math.round(prediction.delivered * 100),
                    })}
                  </Typography.Text>
                </Space>

                {isAuto ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t('plan.forward.sigma')} · {sigma} mm · {t('plan.forward.sigma.auto')}
                  </Typography.Text>
                ) : (
                  <div>
                    <Typography.Text type="secondary">
                      {t('plan.forward.sigma')} · {sigma} mm
                    </Typography.Text>
                    <Slider min={8} max={60} step={1} value={sigma} onChange={(value) => setSigma(Number(value))} />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {t('plan.forward.sigma.hint')}
                    </Typography.Text>
                  </div>
                )}

                {prediction.warnings.map((warning, index) => (
                  <Alert
                    key={`${warning.code}-${index}`}
                    type={warning.code === 'forward.notice.undershoot' ? 'info' : 'warning'}
                    showIcon
                    title={t(warning.code, warning.params)}
                  />
                ))}

                <Typography.Title level={5} style={{ margin: 0 }}>
                  {t('plan.forward.map.title')}
                </Typography.Title>
                <Segmented<MapMode>
                  value={mapMode}
                  onChange={(value) => setMapMode(value)}
                  options={[
                    { label: t('plan.forward.map.mode.residual'), value: 'residual' },
                    { label: t('plan.forward.map.mode.relief'), value: 'relief' },
                  ]}
                />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t(mapMode === 'residual' ? 'plan.forward.map.hint.residual' : 'plan.forward.map.hint.relief', {
                    ref: Math.round(result.reference * 1000),
                  })}
                </Typography.Text>
                {mapMode === 'residual' || !relief ? (
                  <ResidualMapCanvas
                    grid={grid}
                    prediction={prediction}
                    floorBand={rounding === 'floor' ? furtherLayer(material) : 0}
                  />
                ) : (
                  <PredictedRelief
                    surface={relief.surface}
                    baseline={relief.baseline}
                    maxAbs={relief.maxAbs}
                  />
                )}

                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('plan.forward.export')}
                </Typography.Text>
                <Typography.Paragraph code copyable style={{ whiteSpace: 'pre-wrap', marginBottom: 0, maxHeight: 220, overflow: 'auto' }}>
                  {predictedMeshBlock(prediction, mesh)}
                </Typography.Paragraph>
              </Space>
            </Card>
          )}

          {!isAuto && (
            <Card title={t('probe.title')}>
              <Space orientation="vertical" size={10} style={{ width: '100%' }}>
                <Typography.Text type="secondary">{t('probe.hint')}</Typography.Text>
                <Table
                  size="small"
                  pagination={false}
                  scroll={{ x: 520 }}
                  dataSource={probeRows}
                  columns={[
                    {
                      title: t('probe.col.tape'),
                      dataIndex: 'width',
                      render: (value: number, row) => (
                        <Space size={6}>
                          {`${value} mm`}
                          {row.current && <Tag color="blue">{t('probe.current')}</Tag>}
                        </Space>
                      ),
                    },
                    { title: t('probe.col.grid'), dataIndex: 'grid' },
                    { title: t('probe.col.points'), dataIndex: 'points', align: 'right' },
                    { title: t('probe.col.time'), dataIndex: 'minutes', align: 'right', render: (value: number) => `≈ ${value} ${t('probe.minutes')}` },
                    { title: t('probe.col.verdict'), dataIndex: 'verdict', render: (value: Verdict) => t(`probe.verdict.${value}`) },
                  ]}
                />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('probe.snippet')}
                </Typography.Text>
                <Typography.Paragraph code copyable style={{ whiteSpace: 'pre-wrap', marginBottom: 0, maxHeight: 220, overflow: 'auto' }}>
                  {snippet}
                </Typography.Paragraph>
              </Space>
            </Card>
          )}
        </>
      )}

    </Space>
  )
}
