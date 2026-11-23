import { useMemo, useState } from 'react'
import { Alert, Button, Card, Descriptions, Input, Space, Tag, Typography } from 'antd'
import exampleMesh from '../../fixtures/neptune4-mesh.block?raw'
import { CoreError } from '../core/errors'
import { createSurface } from '../core/mesh/interpolate'
import { parseMesh } from '../core/mesh/parse'
import type { Mesh, MeshProfileRef } from '../core/mesh/types'
import type { MessageParams } from '../core/messages'
import { useT } from '../i18n'
import { MeshHeatmap } from './MeshHeatmap'

const { TextArea } = Input

interface Parsed {
  mesh: Mesh
  profiles: MeshProfileRef[]
}

interface Failure {
  code: string
  params?: MessageParams
  line?: number
}

const format = (value: number): string => value.toFixed(4)

export function MeshTab() {
  const t = useT()
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)

  const runParse = (source: string) => {
    try {
      setParsed(parseMesh(source))
      setFailure(null)
    } catch (error) {
      if (error instanceof CoreError) {
        setFailure({ code: error.code, params: error.params, line: error.line })
        setParsed(null)
        return
      }
      throw error
    }
  }

  const surface = useMemo(() => (parsed?.mesh.bounds ? createSurface(parsed.mesh) : null), [parsed])

  const nodeRange = useMemo(() => {
    if (!parsed) return null
    const values = parsed.mesh.points.flat()
    return { min: Math.min(...values), max: Math.max(...values) }
  }, [parsed])

  const mesh = parsed?.mesh

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title={t('mesh.paste.title')}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
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
            <Button
              onClick={() => {
                setText(exampleMesh)
                runParse(exampleMesh)
              }}
            >
              {t('mesh.button.example')}
            </Button>
            <Button
              onClick={() => {
                setText('')
                setParsed(null)
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
          message={t('mesh.error.title')}
          description={
            <Space direction="vertical" size={2}>
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
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
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

            {!mesh.bounds && <Alert type="warning" showIcon message={t('mesh.bounds.missing')} />}

            {mesh.notices.map((notice, index) => (
              <Alert
                key={`${notice.code}-${index}`}
                type="info"
                showIcon
                message={t(notice.code, notice.params)}
              />
            ))}

            {parsed && parsed.profiles.length > 1 && (
              <Typography.Text type="secondary">
                {t('mesh.profiles.value', { list: parsed.profiles.map((profile) => profile.name).join(', ') })}
              </Typography.Text>
            )}

            {surface && (
              <>
                <Typography.Title level={5} style={{ margin: '8px 0 0' }}>
                  {t('heatmap.title')}
                </Typography.Title>
                <MeshHeatmap surface={surface} />
              </>
            )}
          </Space>
        </Card>
      )}
    </Space>
  )
}
