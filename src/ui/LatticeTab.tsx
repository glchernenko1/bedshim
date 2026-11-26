import { useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  InputNumber,
  Row,
  Segmented,
  Space,
  Statistic,
  Switch,
  Tooltip,
  Typography,
} from 'antd'
import { buildCompositeLattice, buildCompositeSvg, type LatticePart } from '../core/geometry/composite'
import type { Triangle } from '../core/geometry/extrude'
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
  const [composite, setComposite] = useState(false)
  const [clearance, setClearance] = useState(0)
  const [centerClearance, setCenterClearance] = useState(0)

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

  const style = useMemo(
    () => ({
      wallThickness,
      height,
      outline,
      margin,
      frame,
      rim,
      bridges,
      bridgeWidth,
      labels,
    }),
    [wallThickness, height, outline, margin, frame, rim, bridges, bridgeWidth, labels],
  )

  const lattice = useMemo(() => (grid ? buildLattice(grid, style) : null), [grid, style])

  const compositeLattice = useMemo(
    () =>
      grid && composite
        ? buildCompositeLattice(grid, style, { clearance, centerClearance })
        : null,
    [grid, composite, style, clearance, centerClearance],
  )

  const latticeSvg = useMemo(() => {
    if (compositeLattice) return buildCompositeSvg(compositeLattice)
    return lattice ? buildLatticeSvg(lattice.outline, lattice.sheet) : ''
  }, [lattice, compositeLattice])

  if (!measurement || !mesh) {
    return (
      <Card title={t('lattice.title')}>
        <Alert type="info" showIcon title={t('lattice.noMesh.title')} description={t('lattice.noMesh.body')} />
      </Card>
    )
  }

  const active = compositeLattice ?? lattice
  const volume = active
    ? (compositeLattice
        ? compositeLattice.parts.reduce((sum, part) => sum + part.manifold.volume, 0) +
          (compositeLattice.cross?.manifold.volume ?? 0)
        : lattice!.manifold.volume) / 1000
    : 0
  const weight = volume * PLA_DENSITY
  const warnings = compositeLattice?.warnings ?? lattice?.warnings ?? []
  const largest = compositeLattice?.parts.reduce<LatticePart | null>(
    (best, part) =>
      !best || part.sheet.x1 - part.sheet.x0 > best.sheet.x1 - best.sheet.x0 ? part : best,
    null,
  )

  const saveTriangles = (triangles: readonly Triangle[], name: string): void => {
    const bytes = writeBinaryStl(triangles)
    download(new Blob([bytes.buffer as ArrayBuffer], { type: 'model/stl' }), name)
  }

  const saveStl = (part?: LatticePart): void => {
    if (!lattice) return
    if (part) {
      saveTriangles(part.triangles, `bedshim-lattice-part-${part.index}.stl`)
      return
    }
    saveTriangles(lattice.triangles, 'bedshim-lattice.stl')
  }

  const saveCross = (): void => {
    if (!compositeLattice?.cross) return
    saveTriangles(compositeLattice.cross.triangles, 'bedshim-lattice-center-cross.stl')
  }

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Card title={t('lattice.title')}>
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          <Row gutter={[16, 12]}>
            <Col xs={12} sm={8} md={4}>
              <Tooltip title={t('lattice.field.wall.hint')} placement="topLeft">
                <Typography.Text type="secondary">{t('lattice.field.wall')}</Typography.Text>
              </Tooltip>
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
              <Tooltip title={t('lattice.field.height.hint')} placement="topLeft">
                <Typography.Text type="secondary">{t('lattice.field.height')}</Typography.Text>
              </Tooltip>
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
              <Tooltip title={t('lattice.field.frame.hint')} placement="topLeft">
                <Typography.Text type="secondary">{t('lattice.field.frame')}</Typography.Text>
              </Tooltip>
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
              <Tooltip title={t('lattice.field.rim.hint')} placement="topLeft">
                <Typography.Text type="secondary">{t('lattice.field.rim')}</Typography.Text>
              </Tooltip>
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
              <Tooltip title={t('lattice.field.bridges.hint')} placement="topLeft">
                <Typography.Text type="secondary">{t('lattice.field.bridges')}</Typography.Text>
              </Tooltip>
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
              <Tooltip title={t('lattice.field.bridgeWidth.hint')} placement="topLeft">
                <Typography.Text type="secondary">{t('lattice.field.bridgeWidth')}</Typography.Text>
              </Tooltip>
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
              <Tooltip title={t('lattice.field.outline.hint')} placement="topLeft">
                <Typography.Text type="secondary">{t('lattice.field.outline')}</Typography.Text>
              </Tooltip>
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
              <Tooltip title={t('lattice.field.margin.hint')} placement="topLeft">
                <Typography.Text type="secondary">{t('lattice.field.margin')}</Typography.Text>
              </Tooltip>
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
              <Tooltip title={t('lattice.field.labels.hint')} placement="topLeft">
                <Typography.Text type="secondary">{t('lattice.field.labels')}</Typography.Text>
              </Tooltip>
              <div>
                <Switch
                  checked={labels}
                  disabled={outline === 'grid' || outline === 'plate'}
                  onChange={(checked) => setLabels(checked)}
                />
              </div>
            </Col>
            <Col xs={24} md={12}>
              <Tooltip title={t('lattice.composite.hint')} placement="topLeft">
                <Checkbox checked={composite} onChange={(event) => setComposite(event.target.checked)}>
                  {t('lattice.field.composite')}
                </Checkbox>
              </Tooltip>
            </Col>
            <Col xs={12} sm={8} md={6}>
              <Tooltip title={t('lattice.field.clearance.hint')} placement="topLeft">
                <Typography.Text type="secondary">{t('lattice.field.clearance')}</Typography.Text>
              </Tooltip>
              <InputNumber
                min={0}
                max={0.5}
                step={0.05}
                precision={2}
                disabled={!composite}
                value={clearance}
                onChange={(value) => value !== null && setClearance(value)}
                style={{ width: '100%' }}
              />
            </Col>
            <Col xs={12} sm={8} md={6}>
              <Tooltip title={t('lattice.field.centerClearance.hint')} placement="topLeft">
                <Typography.Text type="secondary">{t('lattice.field.centerClearance')}</Typography.Text>
              </Tooltip>
              <InputNumber
                min={0}
                max={0.5}
                step={0.05}
                precision={2}
                disabled={!composite}
                value={centerClearance}
                onChange={(value) => value !== null && setCenterClearance(value)}
                style={{ width: '100%' }}
              />
            </Col>
            <Col xs={24}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('lattice.field.hint')}
              </Typography.Text>
            </Col>
          </Row>

          <Row gutter={[12, 8]}>
            <Col xs={12} sm={8} md={4}>
              <Statistic
                title={t('lattice.stats.triangles')}
                value={
                  compositeLattice
                    ? compositeLattice.parts.reduce((sum, part) => sum + part.manifold.triangles, 0) +
                      (compositeLattice.cross?.manifold.triangles ?? 0)
                    : (lattice?.manifold.triangles ?? 0)
                }
              />
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
                {active
                  ? `${Math.round(active.manifold.box.maxX - active.manifold.box.minX)} × ${Math.round(active.manifold.box.maxY - active.manifold.box.minY)} × ${(active.manifold.box.maxZ - active.manifold.box.minZ).toFixed(1)} mm`
                  : '—'}
              </div>
            </Col>
            {compositeLattice && (
              <>
                <Col xs={12} sm={8} md={4}>
                  <Statistic title={t('lattice.composite.parts')} value={compositeLattice.parts.length} />
                </Col>
                <Col xs={24} sm={16} md={6}>
                  <Typography.Text type="secondary">{t('lattice.composite.largest')}</Typography.Text>
                  <div>
                    {largest
                      ? `${Math.round(largest.sheet.x1 - largest.sheet.x0)} × ${Math.round(largest.sheet.y1 - largest.sheet.y0)} × ${height} mm`
                      : '—'}
                  </div>
                </Col>
                {compositeLattice.cross && (
                  <Col xs={24} sm={16} md={6}>
                    <Typography.Text type="secondary">{t('lattice.cross.title')}</Typography.Text>
                    <div>
                      {Math.round(
                        compositeLattice.cross.sheet.x1 - compositeLattice.cross.sheet.x0,
                      )}{' '}
                      ×{' '}
                      {Math.round(
                        compositeLattice.cross.sheet.y1 - compositeLattice.cross.sheet.y0,
                      )}{' '}
                      ×{' '}
                      {(
                        compositeLattice.cross.manifold.box.maxZ -
                        compositeLattice.cross.manifold.box.minZ
                      ).toFixed(1)}{' '}
                      mm
                      <div>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {t('lattice.cross.arm', {
                            width: compositeLattice.cross.armWidth.toFixed(1),
                          })}
                        </Typography.Text>
                      </div>
                    </div>
                  </Col>
                )}
              </>
            )}
          </Row>

          {warnings.map((warning, index) => (
            <Alert key={`${warning.code}-${index}`} type="warning" showIcon title={t(warning.code, warning.params)} />
          ))}

          <Space wrap>
            {compositeLattice ? (
              <>
                {compositeLattice.parts.map((part) => (
                  <Button
                    key={part.id}
                    onClick={() => saveStl(part)}
                    disabled={part.manifold.volume <= 0}
                  >
                    {t('lattice.composite.download', { index: part.index })} ·{' '}
                    {Math.round(part.sheet.x1 - part.sheet.x0)}×{Math.round(part.sheet.y1 - part.sheet.y0)} mm
                  </Button>
                ))}
                {compositeLattice.cross && (
                  <Button onClick={saveCross} disabled={compositeLattice.cross.manifold.volume <= 0}>
                    {t('lattice.cross.download')} ·{' '}
                    {Math.round(
                      compositeLattice.cross.sheet.x1 - compositeLattice.cross.sheet.x0,
                    )}×
                    {Math.round(
                      compositeLattice.cross.sheet.y1 - compositeLattice.cross.sheet.y0,
                    )}{' '}
                    mm
                  </Button>
                )}
              </>
            ) : (
              <Button type="primary" onClick={() => saveStl()} disabled={!lattice}>
                {t('lattice.download.stl')}
              </Button>
            )}
          </Space>

          {compositeLattice && (
            <Alert type="warning" showIcon title={t('lattice.composite.note')} />
          )}

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

      <Card title={compositeLattice ? t('lattice.composite.preview') : t('lattice.preview.lattice')}>
        <div
          className="lattice-preview"
          style={{ background: '#fff', borderRadius: 6, overflow: 'auto', padding: 8 }}
          dangerouslySetInnerHTML={{ __html: latticeSvg }}
        />
      </Card>
    </Space>
  )
}
