import { useMemo, useState } from 'react'
import { Alert, Button, Card, Descriptions, Dropdown, Input, Popconfirm, Space, Tag, Typography } from 'antd'
import exampleOriginal from '../../fixtures/neptune4-mesh.block?raw'
import examplePass1 from '../../fixtures/test-after-pass1.cfg?raw'
import examplePass2 from '../../fixtures/test-after-pass2.cfg?raw'
import { CoreError } from '../core/errors'
import { createSurface } from '../core/mesh/interpolate'
import { parseMesh } from '../core/mesh/parse'
import { surfaceStats } from '../core/mesh/stats'
import type { MessageParams } from '../core/messages'
import { useT } from '../i18n'
import { useAppStore } from '../state/store'
import { MeshView } from './MeshView'
import { SurfaceStatsPanel } from './SurfaceStatsPanel'

const { TextArea } = Input

interface Failure {
  code: string
  params?: MessageParams
  line?: number
}

const format = (value: number): string => value.toFixed(4)

export function MeshTab() {
  const t = useT()
  const text = useAppStore((state) => state.draftText)
  const setText = useAppStore((state) => state.setDraftText)
  const measurements = useAppStore((state) => state.measurements)
  const selectedId = useAppStore((state) => state.selectedId)
  const addMeasurement = useAppStore((state) => state.addMeasurement)
  const selectMeasurement = useAppStore((state) => state.selectMeasurement)
  const removeMeasurement = useAppStore((state) => state.removeMeasurement)
  const clearMeasurements = useAppStore((state) => state.clearMeasurements)
  const [failure, setFailure] = useState<Failure | null>(null)

  const selected = measurements.find((item) => item.id === selectedId) ?? null
  const parsed = selected?.mesh ?? null
  const profiles = selected?.profiles ?? []

  const loadExample = (key: string) => {
    const source = key === '2' ? examplePass1 : key === '3' ? examplePass2 : exampleOriginal
    setText(source)
    runParse(source)
  }

  const runParse = (source: string) => {
    try {
      const result = parseMesh(source)
      addMeasurement(result.mesh, source, result.profiles)
      setFailure(null)
    } catch (error) {
      if (error instanceof CoreError) {
        setFailure({ code: error.code, params: error.params, line: error.line })
        return
      }
      throw error
    }
  }

  const surface = useMemo(() => (parsed?.bounds ? createSurface(parsed) : null), [parsed])
  const stats = useMemo(() => (surface ? surfaceStats(surface) : null), [surface])

  const nodeRange = useMemo(() => {
    if (!parsed) return null
    const values = parsed.points.flat()
    return { min: Math.min(...values), max: Math.max(...values) }
  }, [parsed])

  const mesh = parsed

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Card title={t('mesh.paste.title')}>
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Text type="secondary">{t('mesh.paste.hint')}</Typography.Text>
          <Space size={8} wrap>
            <Tag>{t('mesh.bookmark.saveConfig')}</Tag>
            <Tag>{t('mesh.bookmark.block')}</Tag>
            <Tag>{t('mesh.bookmark.points')}</Tag>
          </Space>
          <TextArea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={9}
            spellCheck={false}
            placeholder={'[bed_mesh default]\npoints:\n  0.090000, 0.080000, …'}
            style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}
          />
          <Space wrap>
            <Button type="primary" onClick={() => runParse(text)}>
              {t('mesh.button.parse')}
            </Button>
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  { key: '1', label: t('mesh.example.1') },
                  { key: '2', label: t('mesh.example.2') },
                  { key: '3', label: t('mesh.example.3') },
                ],
                onClick: ({ key }) => loadExample(key),
              }}
            >
              <Button>{t('mesh.button.example')}</Button>
            </Dropdown>
            <Button
              onClick={() => {
                setText('')
                setFailure(null)
              }}
            >
              {t('mesh.button.clear')}
            </Button>
          </Space>
        </Space>
      </Card>

      {failure && (
        <Alert
          type="error"
          showIcon
          title={t('mesh.error.title')}
          description={
            <Space orientation="vertical" size={2}>
              <span>{t(failure.code, failure.params)}</span>
              {failure.line !== undefined && (
                <Typography.Text type="secondary">{t('mesh.error.line', { line: failure.line })}</Typography.Text>
              )}
            </Space>
          }
        />
      )}

      {mesh && (
        <Card title={t('mesh.summary.title')}>
          <Space orientation="vertical" size={12} style={{ width: '100%' }}>
            <Descriptions
              size="small"
              column={{ xs: 1, sm: 1, md: 2 }}
              items={[
                {
                  key: 'profile',
                  label: t('mesh.field.profile'),
                  children: mesh.name,
                },
                {
                  key: 'source',
                  label: t('mesh.field.source'),
                  children: t(`mesh.source.${mesh.source}`),
                },
                {
                  key: 'grid',
                  label: t('mesh.field.grid'),
                  children: (
                    <Space size={6}>
                      {t('mesh.grid.value', { x: mesh.xCount, y: mesh.yCount })}
                      {mesh.inferred.counts && <Tag color="gold">{t('mesh.inferred')}</Tag>}
                    </Space>
                  ),
                },
                {
                  key: 'bounds',
                  label: t('mesh.field.bounds'),
                  children: mesh.bounds
                    ? t('mesh.bounds.value', {
                        minX: format(mesh.bounds.minX),
                        maxX: format(mesh.bounds.maxX),
                        minY: format(mesh.bounds.minY),
                        maxY: format(mesh.bounds.maxY),
                      })
                    : '—',
                },
                {
                  key: 'algo',
                  label: t('mesh.field.algo'),
                  children: (
                    <Space size={6}>
                      {mesh.algo}
                      {mesh.inferred.algo && <Tag color="gold">{t('mesh.inferred')}</Tag>}
                    </Space>
                  ),
                },
                {
                  key: 'tension',
                  label: t('mesh.field.tension'),
                  children: (
                    <Space size={6}>
                      {mesh.tension}
                      {mesh.inferred.tension && <Tag color="gold">{t('mesh.inferred')}</Tag>}
                    </Space>
                  ),
                },
                {
                  key: 'pps',
                  label: t('mesh.field.pps'),
                  children: (
                    <Space size={6}>
                      {`${mesh.meshXPps} × ${mesh.meshYPps}`}
                      {mesh.inferred.pps && <Tag color="gold">{t('mesh.inferred')}</Tag>}
                    </Space>
                  ),
                },
                {
                  key: 'range',
                  label: t('mesh.field.nodeRange'),
                  children: nodeRange ? `${format(nodeRange.min)} … ${format(nodeRange.max)}` : '—',
                },
                {
                  key: 'ignored',
                  label: t('mesh.field.unknownKeys'),
                  children: mesh.ignoredKeys.length > 0 ? mesh.ignoredKeys.join(', ') : '—',
                },
              ]}
            />

            {!mesh.bounds && <Alert type="warning" showIcon title={t('mesh.bounds.missing')} />}

            {mesh.notices.map((notice, index) => (
              <Alert
                key={`${notice.code}-${index}`}
                type="info"
                showIcon
                title={t(notice.code, notice.params)}
              />
            ))}

            {profiles.length > 1 && (
              <Typography.Text type="secondary">
                {t('mesh.profiles.value', { list: profiles.map((profile) => profile.name).join(', ') })}
              </Typography.Text>
            )}

            {surface && stats && (
              <>
                <Typography.Title level={5} style={{ margin: '8px 0 0' }}>
                  {t('stats.title')}
                </Typography.Title>
                <SurfaceStatsPanel stats={stats} />

                <Typography.Title level={5} style={{ margin: '8px 0 0' }}>
                  {t('heatmap.title')}
                </Typography.Title>
                <MeshView surface={surface} />
              </>
            )}
          </Space>
        </Card>
      )}

      <Card title={t('mesh.history.title')}>
        <Space orientation="vertical" size={10} style={{ width: '100%' }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('mesh.history.hint')}
          </Typography.Text>
          {measurements.length === 0 ? (
            <Typography.Text type="secondary">{t('mesh.history.empty')}</Typography.Text>
          ) : (
            <Space orientation="vertical" size={8} style={{ width: '100%' }}>
              {[...measurements].reverse().map((item) => (
                <div
                  key={item.id}
                  style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
                >
                  <Typography.Text strong>{item.label}</Typography.Text>
                  <Tag>{t('mesh.grid.value', { x: item.mesh.xCount, y: item.mesh.yCount })}</Tag>
                  {item.layers && <Tag color="blue">{t('mesh.history.hasLayers')}</Tag>}
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {new Date(item.createdAt).toLocaleString()}
                  </Typography.Text>
                  <Button
                    size="small"
                    type={item.id === selectedId ? 'primary' : 'default'}
                    onClick={() => selectMeasurement(item.id)}
                  >
                    {item.id === selectedId ? t('mesh.history.selected') : t('mesh.history.select')}
                  </Button>
                  {measurements.length > 1 && (
                    <Button size="small" danger onClick={() => removeMeasurement(item.id)}>
                      {t('mesh.history.delete')}
                    </Button>
                  )}
                </div>
              ))}
            </Space>
          )}
          {measurements.length > 0 && (
            <Popconfirm
              title={t('mesh.history.clearTitle')}
              description={t('mesh.history.clearBody')}
              okText={t('mesh.history.clearOk')}
              cancelText={t('mesh.history.clearCancel')}
              okButtonProps={{ danger: true }}
              onConfirm={clearMeasurements}
            >
              <Button danger>{t('mesh.history.clear')}</Button>
            </Popconfirm>
          )}
        </Space>
      </Card>
    </Space>
  )
}
