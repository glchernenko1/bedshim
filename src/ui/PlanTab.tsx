import { useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
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
import { deadbandOf } from '../core/material'
import { createSurface } from '../core/mesh/interpolate'
import { plan, type Rounding } from '../core/plan'
import { predictPlan, predictedMeshBlock } from '../core/forward'
import { bedMeshSnippet, idealProbeCount, probeAdvice, probeEstimate } from '../core/probe'
import { useT } from '../i18n'
import { useAppStore } from '../state/store'
import { LayerLegend, PlanGridCanvas } from './PlanGridCanvas'
import { ResidualMapCanvas } from './ResidualMapCanvas'

type Verdict = 'coarse' | 'good' | 'fine' | 'slow'

function verdictOf(points: number): Verdict {
  if (points <= 25) return 'coarse'
  if (points <= 121) return 'good'
  if (points <= 420) return 'fine'
  return 'slow'
}

const fmt = (value: number, digits = 4): string => value.toFixed(digits)

export function PlanTab() {
  const t = useT()
  const measurements = useAppStore((state) => state.measurements)
  const selectedId = useAppStore((state) => state.selectedId)
  const measurement = measurements.find((item) => item.id === selectedId) ?? null
  const mesh = measurement?.mesh ?? null
  const applyPlan = useAppStore((state) => state.applyPlan)
  const pending = useAppStore((state) => state.pending)
  const material = useAppStore((state) => state.material)
  const setMaterial = useAppStore((state) => state.setMaterial)

  const [tapeWidth, setTapeWidth] = useState(20)
  const [plateW, setPlateW] = useState(235)
  const [plateH, setPlateH] = useState(235)
  const [percentile, setPercentile] = useState(0.85)
  const [sigma, setSigma] = useState(22)
  const [maxLayers, setMaxLayers] = useState(6)
  const [rounding, setRounding] = useState<Rounding>('floor')

  const surface = useMemo(() => (mesh?.bounds ? createSurface(mesh) : null), [mesh])

  const grid = useMemo(() => {
    if (!mesh?.bounds) return null
    return buildGrid({
      plate: { w: plateW, h: plateH },
      meshBounds: mesh.bounds,
      tapeWidth,
      meshXCount: mesh.xCount,
      meshYCount: mesh.yCount,
    })
  }, [mesh, plateW, plateH, tapeWidth])

  const baseLayers = useMemo(() => {
    if (!grid) return undefined
    const stored = measurement?.layers
    if (stored && stored.length === grid.rows && (stored[0]?.length ?? 0) === grid.cols) return stored
    return Array.from({ length: grid.rows }, () => new Array<number>(grid.cols).fill(0))
  }, [grid, measurement])

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
    return <Alert type="info" showIcon title={t('plan.noMesh.title')} description={t('plan.noMesh.body')} />
  }

  const messages = [...(grid?.warnings ?? []), ...(result?.warnings ?? []), ...(surface?.notices ?? []), ...advice]
  const deadband = deadbandOf(material)

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Card title={t('plan.inputs.title')}>
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          <Row gutter={[16, 12]}>
            <Col xs={12} sm={8} md={4}>
              <Typography.Text type="secondary">{t('plan.field.tape')}</Typography.Text>
              <InputNumber min={5} max={100} step={5} value={tapeWidth} onChange={(value) => value && setTapeWidth(value)} style={{ width: '100%' }} />
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Typography.Text type="secondary">{t('plan.field.plateW')}</Typography.Text>
              <InputNumber min={50} max={500} value={plateW} onChange={(value) => value && setPlateW(value)} style={{ width: '100%' }} />
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Typography.Text type="secondary">{t('plan.field.plateH')}</Typography.Text>
              <InputNumber min={50} max={500} value={plateH} onChange={(value) => value && setPlateH(value)} style={{ width: '100%' }} />
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Typography.Text type="secondary">{t('plan.field.maxLayers')}</Typography.Text>
              <InputNumber min={1} max={12} value={maxLayers} onChange={(value) => value && setMaxLayers(value)} style={{ width: '100%' }} />
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
                onChange={(value) => value && setMaterial({ ...material, ts: value })}
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
              <Slider min={0.5} max={0.95} step={0.01} value={percentile} onChange={(value) => setPercentile(Number(value))} />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('plan.field.percentile.hint')}
              </Typography.Text>
            </Col>
            <Col xs={24} md={12}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('plan.material.note', { deadband: fmt(deadband, 3) })}
                <br />
                {material.calibrated ? t('plan.material.measured') : t('plan.material.fallback')}
                <br />
                {t('plan.material.layers')}
                <br />
                {t('plan.material.auto')}
                <br />
                {t('plan.material.tsBigger')}
              </Typography.Text>
            </Col>
          </Row>

          <Alert
            type="info"
            showIcon
            title={t('plan.rounding.first.title')}
            description={t('plan.rounding.first.body')}
          />
          {rounding === 'round' && !material.calibrated && (
            <Alert type="warning" showIcon title={t('plan.rounding.overshoot.title')} description={t('plan.rounding.overshoot.body')} />
          )}

          <Divider style={{ margin: '4px 0' }} />

        </Space>
      </Card>

      {grid && result && (
        <>
          <Card title={t('plan.results.title')}>
            <Space orientation="vertical" size={12} style={{ width: '100%' }}>
              <Row gutter={[12, 8]}>
                <Col xs={12} sm={8} md={4}>
                  <Statistic title={t('plan.stat.ref')} value={result.reference} precision={4} suffix="mm" />
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
                <Button type="primary" onClick={() => applyPlan({ layers: result.layers, tapeWidth, plateW, plateH })}>
                  {t('plan.apply')}
                </Button>
                {pending && <Typography.Text type="secondary">{t('plan.applied.tag')}</Typography.Text>}
              </Space>
              {pending && <Alert type="success" showIcon title={t('plan.applied.title')} description={t('plan.applied.body')} />}
            </Space>
          </Card>

          {prediction && (
            <Card title={t('plan.forward.title')}>
              <Space orientation="vertical" size={12} style={{ width: '100%' }}>
                <Row gutter={[12, 8]}>
                  <Col xs={12} sm={8} md={6}>
                    <Statistic title={t('plan.forward.delivered')} value={prediction.delivered * 100} precision={0} suffix="%" />
                  </Col>
                  <Col xs={12} sm={8} md={6}>
                    <Statistic title={t('plan.forward.achievable')} value={prediction.achievable * 100} precision={0} suffix="%" />
                  </Col>
                  <Col xs={12} sm={8} md={6}>
                    <Statistic title={t('plan.forward.max')} value={prediction.maxAbsResidual} precision={4} suffix="mm" />
                  </Col>
                  <Col xs={12} sm={8} md={6}>
                    <Statistic title={t('plan.forward.rms')} value={prediction.rmsResidual} precision={4} suffix="mm" />
                  </Col>
                </Row>

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

                <div>
                  <Typography.Text type="secondary">
                    {t('plan.forward.sigma')} · {sigma} mm
                  </Typography.Text>
                  <Slider min={8} max={60} step={1} value={sigma} onChange={(value) => setSigma(Number(value))} />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t('plan.forward.sigma.hint')}
                  </Typography.Text>
                </div>

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
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('plan.forward.map.hint')}
                </Typography.Text>
                <ResidualMapCanvas grid={grid} prediction={prediction} />

                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('plan.forward.export')}
                </Typography.Text>
                <Typography.Paragraph code copyable style={{ whiteSpace: 'pre-wrap', marginBottom: 0, maxHeight: 220, overflow: 'auto' }}>
                  {predictedMeshBlock(prediction, mesh)}
                </Typography.Paragraph>
              </Space>
            </Card>
          )}

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
        </>
      )}

    </Space>
  )
}
