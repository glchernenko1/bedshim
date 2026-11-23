import { useMemo, useState } from 'react'
import {
  Alert,
  Card,
  Checkbox,
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
import { buildGrid, type GridView } from '../core/grid'
import { deadbandOf } from '../core/material'
import { createSurface } from '../core/mesh/interpolate'
import { plan, type Rounding } from '../core/plan'
import { bedMeshSnippet, idealProbeCount, probeAdvice, probeEstimate } from '../core/probe'
import { useT } from '../i18n'
import { useAppStore } from '../state/store'
import { LayerLegend, PlanGridCanvas } from './PlanGridCanvas'

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
  const mesh = useAppStore((state) => state.mesh)
  const material = useAppStore((state) => state.material)
  const setMaterial = useAppStore((state) => state.setMaterial)

  const [tapeWidth, setTapeWidth] = useState(20)
  const [plateW, setPlateW] = useState(235)
  const [plateH, setPlateH] = useState(235)
  const [percentile, setPercentile] = useState(0.85)
  const [maxLayers, setMaxLayers] = useState(6)
  const [rounding, setRounding] = useState<Rounding>('floor')
  const [view, setView] = useState<GridView>('top')
  const [confirmed, setConfirmed] = useState(false)

  const surface = useMemo(() => (mesh?.bounds ? createSurface(mesh) : null), [mesh])

  const grid = useMemo(() => {
    if (!mesh?.bounds) return null
    return buildGrid({
      plate: { w: plateW, h: plateH },
      meshBounds: mesh.bounds,
      tapeWidth,
      view,
      meshXCount: mesh.xCount,
      meshYCount: mesh.yCount,
    })
  }, [mesh, plateW, plateH, tapeWidth, view])

  const result = useMemo(() => {
    if (!surface || !grid || !confirmed) return null
    return plan({
      surface,
      grid,
      material,
      referencePercentile: percentile,
      rounding,
      maxLayers,
    })
  }, [surface, grid, confirmed, material, percentile, rounding, maxLayers])

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
            <Col xs={24} sm={12} md={8}>
              <Typography.Text type="secondary">{t('plan.field.view')}</Typography.Text>
              <Segmented<GridView>
                block
                value={view}
                onChange={(value) => setView(value)}
                options={[
                  { label: t('plan.view.top'), value: 'top' },
                  { label: t('plan.view.bottom'), value: 'bottom' },
                ]}
              />
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

          <Alert
            type={confirmed ? 'success' : 'warning'}
            showIcon
            title={confirmed ? t('plan.gate.done') : t('plan.gate.title')}
            description={t('plan.gate.body')}
          />
          <Checkbox checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}>
            {t('plan.gate.check')}
          </Checkbox>
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
            </Space>
          </Card>

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
              <Typography.Paragraph code copyable style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
                {snippet}
              </Typography.Paragraph>
            </Space>
          </Card>
        </>
      )}

      {!confirmed && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('plan.blocked')}
        </Typography.Text>
      )}
    </Space>
  )
}
