import { useMemo, useState } from 'react'
import { Alert, Button, Card, Col, InputNumber, Row, Segmented, Space, Statistic, Switch, Tag, Typography } from 'antd'
import { buildLattice } from '../core/geometry/lattice'
import { writeBinaryStl } from '../core/geometry/stl'
import { buildGrid } from '../core/grid'
import { buildLatticeSvg } from '../core/svg'
import { useT } from '../i18n'
import { useAppStore } from '../state/store'

const PLA_DENSITY = 1.24 // g/cm³

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

/** Printable reference lattice (binary STL) built from the shared plan grid. */
export function LatticeTab() {
  const t = useT()
  const measurements = useAppStore((state) => state.measurements)
  const selectedId = useAppStore((state) => state.selectedId)
  const planSettings = useAppStore((state) => state.planSettings)
  const [wallThickness, setWallThickness] = useState(0.8)
  const [height, setHeight] = useState(0.6)
  const [outline, setOutline] = useState<'auto' | 'frame' | 'grid' | 'plate'>('auto')
  const [margin, setMargin] = useState(5)
  const [frame, setFrame] = useState(6)
  const [rim, setRim] = useState(6)
  const [bridges, setBridges] = useState(4)
  const [bridgeWidth, setBridgeWidth] = useState(2)
  const [labels, setLabels] = useState(true)

  const measurement = measurements.find((item) => item.id === selectedId) ?? null
  const mesh = measurement?.mesh ?? null

  const grid = useMemo(() => {
    if (!mesh?.bounds) return null
    return buildGrid({
      plate: { w: planSettings.plateW, h: planSettings.plateH },
      meshBounds: mesh.bounds,
      tapeWidth: planSettings.tapeWidth,
      meshXCount: mesh.xCount,
      meshYCount: mesh.yCount,
      extendToPlate: planSettings.extendToPlate,
    })
  }, [mesh, planSettings])

  const lattice = useMemo(() => {
    if (!grid) return null
    return buildLattice(grid, {
      wallThickness,
      height,
      outline,
      margin,
      frame,
      rim,
      bridges,
      bridgeWidth,
      labels,
    })
  }, [grid, wallThickness, height, outline, margin, frame, rim, bridges, bridgeWidth, labels])

  const latticeSvg = useMemo(() => (lattice ? buildLatticeSvg(lattice.outline, lattice.sheet) : ''), [lattice])

  if (!measurement || !mesh) {
    return (
      <Card title={t('lattice.title')}>
        <Alert type="info" showIcon title={t('lattice.noMesh.title')} description={t('lattice.noMesh.body')} />
      </Card>
    )
  }

  const volume = lattice ? lattice.manifold.volume / 1000 : 0
  const weight = volume * PLA_DENSITY
  const manifoldOk = lattice?.manifold.closed && lattice.manifold.connected

  const saveStl = (): void => {
    if (!lattice) return
    const bytes = writeBinaryStl(lattice.triangles)
    download(new Blob([bytes.buffer as ArrayBuffer], { type: 'model/stl' }), 'bedshim-lattice.stl')
  }

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Card title={t('lattice.title')}>
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          <Row gutter={[16, 12]}>
            <Col xs={12} sm={8} md={4}>
              <Typography.Text type="secondary">{t('lattice.field.wall')}</Typography.Text>
              <InputNumber
                min={0.4}
                max={2}
                step={0.1}
                value={wallThickness}
                onChange={(value) => value && setWallThickness(value)}
                style={{ width: '100%' }}
              />
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Typography.Text type="secondary">{t('lattice.field.height')}</Typography.Text>
              <InputNumber
                min={0.2}
                max={1.2}
                step={0.1}
                value={height}
                onChange={(value) => value && setHeight(value)}
                style={{ width: '100%' }}
              />
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Typography.Text type="secondary">{t('lattice.field.frame')}</Typography.Text>
              <InputNumber
                min={1.5}
                max={20}
                step={0.5}
                disabled={outline === 'grid' || outline === 'plate'}
                value={frame}
                onChange={(value) => value && setFrame(value)}
                style={{ width: '100%' }}
              />
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Typography.Text type="secondary">{t('lattice.field.rim')}</Typography.Text>
              <InputNumber
                min={2}
                max={10}
                step={0.5}
                disabled={outline === 'grid' || outline === 'plate'}
                value={rim}
                onChange={(value) => value && setRim(value)}
                style={{ width: '100%' }}
              />
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Typography.Text type="secondary">{t('lattice.field.bridges')}</Typography.Text>
              <InputNumber
                min={0}
                max={10}
                step={1}
                disabled={outline === 'grid' || outline === 'plate'}
                value={bridges}
                onChange={(value) => value !== null && setBridges(value)}
                style={{ width: '100%' }}
              />
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Typography.Text type="secondary">{t('lattice.field.bridgeWidth')}</Typography.Text>
              <InputNumber
                min={0.8}
                max={4}
                step={0.2}
                disabled={outline === 'grid' || outline === 'plate'}
                value={bridgeWidth}
                onChange={(value) => value && setBridgeWidth(value)}
                style={{ width: '100%' }}
              />
            </Col>
            <Col xs={24} md={12}>
              <Typography.Text type="secondary">{t('lattice.field.outline')}</Typography.Text>
              <Segmented<'auto' | 'frame' | 'grid' | 'plate'>
                block
                value={outline}
                onChange={(value) => setOutline(value)}
                options={[
                  { label: t('lattice.outline.auto'), value: 'auto' },
                  { label: t('lattice.outline.frame'), value: 'frame' },
                  { label: t('lattice.outline.grid'), value: 'grid' },
                  { label: t('lattice.outline.plate'), value: 'plate' },
                ]}
              />
            </Col>
            <Col xs={12} sm={8} md={6}>
              <Typography.Text type="secondary">{t('lattice.field.margin')}</Typography.Text>
              <InputNumber
                min={0.4}
                max={30}
                step={0.5}
                disabled={outline === 'frame' || outline === 'plate'}
                value={margin}
                onChange={(value) => value && setMargin(value)}
                style={{ width: '100%' }}
              />
            </Col>
            <Col xs={12} sm={8} md={6}>
              <Typography.Text type="secondary">{t('lattice.field.labels')}</Typography.Text>
              <div>
                <Switch
                  checked={labels}
                  disabled={outline === 'grid' || outline === 'plate'}
                  onChange={(checked) => setLabels(checked)}
                />
              </div>
            </Col>
            <Col xs={24}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('lattice.field.hint')}
              </Typography.Text>
            </Col>
          </Row>

          <Row gutter={[12, 8]}>
            <Col xs={12} sm={8} md={4}>
              <Statistic title={t('lattice.stats.triangles')} value={lattice?.manifold.triangles ?? 0} />
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Statistic title={t('lattice.stats.volume')} value={volume} precision={2} suffix="cm³" />
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Statistic title={t('lattice.stats.weight')} value={Number(weight.toFixed(1))} precision={1} suffix="g" />
            </Col>
            <Col xs={24} sm={8} md={6}>
              <Typography.Text type="secondary">{t('lattice.stats.box')}</Typography.Text>
              <div>
                {lattice
                  ? `${Math.round(lattice.manifold.box.maxX - lattice.manifold.box.minX)} × ${Math.round(lattice.manifold.box.maxY - lattice.manifold.box.minY)} × ${height} mm`
                  : '—'}
              </div>
            </Col>
            <Col xs={12} sm={8} md={4}>
              <Tag color={manifoldOk ? 'success' : 'error'}>
                {manifoldOk ? t('lattice.manifold.ok') : t('lattice.manifold.bad')}
              </Tag>
            </Col>
          </Row>

          {lattice?.warnings.map((warning, index) => (
            <Alert key={`${warning.code}-${index}`} type="warning" showIcon title={t(warning.code, warning.params)} />
          ))}

          <Space wrap>
            <Button type="primary" onClick={saveStl} disabled={!lattice}>
              {t('lattice.download.stl')}
            </Button>
          </Space>

          <Alert
            type="info"
            showIcon
            title={t('lattice.note.lattice.title')}
            description={
              <Space orientation="vertical" size={2}>
                <span>{t('lattice.note.lattice.body')}</span>
                <span>{t('lattice.note.outline')}</span>
              </Space>
            }
          />
        </Space>
      </Card>

      <Card title={t('lattice.preview.lattice')}>
        <div
          className="lattice-preview"
          style={{ background: '#fff', borderRadius: 6, overflow: 'auto', padding: 8 }}
          dangerouslySetInnerHTML={{ __html: latticeSvg }}
        />
      </Card>
    </Space>
  )
}
