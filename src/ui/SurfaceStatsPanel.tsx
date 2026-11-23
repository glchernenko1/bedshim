import { Col, Row, Space, Statistic, Tag, Typography } from 'antd'
import { DEFAULT_MATERIAL } from '../core/material'
import { madBand, madBands, type MadBand, type SurfaceStats } from '../core/mesh/stats'
import { useT } from '../i18n'

const TONE: Record<MadBand, string> = {
  flat: 'success',
  mild: 'blue',
  notable: 'warning',
  strong: 'error',
}

const fmt = (value: number): string => value.toFixed(4)

/**
 * Numbers plus a plain-language reading of them. The bands follow the material
 * model, so they stay meaningful when the tape is calibrated in P6.
 */
export function SurfaceStatsPanel({ stats }: { stats: SurfaceStats }) {
  const t = useT()
  const material = DEFAULT_MATERIAL
  const bands = madBands(material.ts)
  const band = madBand(stats.mad, material.ts)
  const rows: Array<{ key: MadBand; range: string }> = [
    { key: 'flat', range: `≤ ${fmt(bands.flatMax)}` },
    { key: 'mild', range: `${fmt(bands.flatMax)} … ${fmt(bands.mildMax)}` },
    { key: 'notable', range: `${fmt(bands.mildMax)} … ${fmt(bands.notableMax)}` },
    { key: 'strong', range: `> ${fmt(bands.notableMax)}` },
  ]

  return (
    <Space orientation="vertical" size={10} style={{ width: '100%' }}>
      <Row gutter={[12, 8]}>
        {[
          { key: 'stats.min', value: stats.min },
          { key: 'stats.median', value: stats.median },
          { key: 'stats.mean', value: stats.mean },
          { key: 'stats.max', value: stats.max },
          { key: 'stats.delta', value: stats.delta },
          { key: 'stats.mad', value: stats.mad },
        ].map((item) => (
          <Col key={item.key} xs={12} sm={8} md={8}>
            <Statistic title={t(item.key)} value={item.value} precision={4} />
          </Col>
        ))}
      </Row>

      <Space size={8} wrap>
        <Tag color={TONE[band]}>{t(`stats.band.${band}`)}</Tag>
        <Typography.Text type="secondary">
          {t('stats.mad.value', {
            mad: fmt(stats.mad),
            layers: (stats.mad / material.ts).toFixed(2),
          })}
        </Typography.Text>
      </Space>

      <div>
        {rows.map((row) => {
          const active = row.key === band
          return (
            <div
              key={row.key}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'baseline',
                flexWrap: 'wrap',
                padding: '3px 8px',
                borderRadius: 4,
                background: active ? '#e6f4ff' : undefined,
              }}
            >
              <Typography.Text style={{ width: 120 }} type={active ? undefined : 'secondary'}>
                {row.range} mm
              </Typography.Text>
              <Tag color={TONE[row.key]}>{t(`stats.band.${row.key}`)}</Tag>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t(`stats.band.${row.key}.desc`)}
              </Typography.Text>
              {active && <Typography.Text strong>{t('stats.now')}</Typography.Text>}
            </div>
          )
        })}
      </div>

      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
        {t('stats.mad.explain')}
        <br />
        {t('stats.delta.explain')}
        <br />
        {t('stats.median.explain')}
        <br />
        {t('stats.bands.note', { ts: material.ts.toFixed(3) })}
        <br />
        {t('stats.sampling')}
      </Typography.Paragraph>
    </Space>
  )
}
