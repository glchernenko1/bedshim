import { useMemo, useState } from 'react'
import { Alert, Button, Card, Descriptions, Dropdown, Input, Modal, Popconfirm, Space, Tag, Typography } from 'antd'
import { CoreError } from '../core/errors'
import { meshMismatches, type MeshDifference } from '../core/mesh/compat'
import { createSurface } from '../core/mesh/interpolate'
import { parseMesh } from '../core/mesh/parse'
import { surfaceStats } from '../core/mesh/stats'
import type { ParseResult } from '../core/mesh/types'
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

/**
 * A parsed mesh that cannot join the stored measurements because its probe
 * grid, bounds or algorithm differ. Kept aside until the user either accepts a
 * fresh start or cancels; it is never written to the store as-is.
 */
interface Conflict {
  result: ParseResult
  source: string
  differences: MeshDifference[]
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
  const [conflict, setConflict] = useState<Conflict | null>(null)

  const selected = measurements.find((item) => item.id === selectedId) ?? null
  const parsed = selected?.mesh ?? null
  const profiles = selected?.profiles ?? []

  // Examples are a development aid: the production build (GitHub Pages) ships
  // without the fixtures and without the picker. `import.meta.env.DEV` folds to
  // false in the build, so the dynamic import is dropped as well.
  const loadExample = (key: string) => {
    if (!import.meta.env.DEV) return
    void import('../dev/examples').then(({ EXAMPLES, isExampleKey }) => {
      if (!isExampleKey(key)) return
      const source = EXAMPLES[key]
      setText(source)
      runParse(source)
    })
  }

  const runParse = (source: string) => {
    try {
      const result = parseMesh(source)
      // Every stored map must share the probe geometry; a map from another
      // probe_count cannot join the list (see the conflict dialog below).
      const differences = meshMismatches(result.mesh, measurements)
      if (differences.length > 0) {
        setConflict({ result, source, differences })
        setFailure(null)
        return
      }
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

  /** The user chose a clean start: the old list is dropped and this mesh is M1. */
  const startFresh = () => {
    if (!conflict) return
    clearMeasurements()
    addMeasurement(conflict.result.mesh, conflict.source, conflict.result.profiles)
    setConflict(null)
  }

  const describeDifference = (difference: MeshDifference): string => {
    switch (difference.field) {
      case 'grid':
        return t('mesh.conflict.field.grid', {
          label: difference.label,
          storedX: difference.stored.x,
          storedY: difference.stored.y,
          incomingX: difference.incoming.x,
          incomingY: difference.incoming.y,
        })
      case 'bounds':
        return t('mesh.conflict.field.bounds', {
          label: difference.label,
          storedMinX: format(difference.stored.minX),
          storedMaxX: format(difference.stored.maxX),
          storedMinY: format(difference.stored.minY),
          storedMaxY: format(difference.stored.maxY),
          incomingMinX: format(difference.incoming.minX),
          incomingMaxX: format(difference.incoming.maxX),
          incomingMinY: format(difference.incoming.minY),
          incomingMaxY: format(difference.incoming.maxY),
        })
      case 'algo':
        return t('mesh.conflict.field.algo', {
          label: difference.label,
          stored: difference.stored,
          incoming: difference.incoming,
        })
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
            {import.meta.env.DEV && (
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
            )}
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
                  {item.applied && <Tag color="blue">{t('mesh.history.hasLayers')}</Tag>}
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

      <Modal
        open={conflict !== null}
        title={t('mesh.conflict.title')}
        onCancel={() => setConflict(null)}
        // Above the Auto probe-grid notification, which otherwise covers this dialog.
        zIndex={2100}
        footer={
          <Space wrap>
            <Button onClick={() => setConflict(null)}>{t('mesh.conflict.cancel')}</Button>
            <Button type="primary" danger onClick={startFresh}>
              {t('mesh.conflict.clear')}
            </Button>
          </Space>
        }
      >
        {conflict && (
          <Space orientation="vertical" size={10} style={{ width: '100%' }}>
            <Typography.Text>{t('mesh.conflict.body')}</Typography.Text>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {conflict.differences.map((difference) => (
                <li key={difference.field}>{describeDifference(difference)}</li>
              ))}
            </ul>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('mesh.conflict.reason')}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('mesh.conflict.fresh')}
            </Typography.Text>
          </Space>
        )}
      </Modal>
    </Space>
  )
}
