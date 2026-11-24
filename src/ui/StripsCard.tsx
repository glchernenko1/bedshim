import { useMemo } from 'react'
import { Alert, Button, Card, Col, Row, Space, Statistic, Typography } from 'antd'
import type { Plan } from '../core/plan'
import { buildStrips } from '../core/strips'
import { useT } from '../i18n'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/**
 * Cut list from the layer matrix (SPEC §8): pieces per level, grouped by
 * identical size, with a printable one-page sheet.
 */
export function StripsCard({ plan }: { plan: Plan }) {
  const t = useT()
  const strips = useMemo(() => buildStrips(plan), [plan])
  const levels = Array.from({ length: strips.levels }, (_, index) => index + 1)

  const print = (): void => {
    const win = window.open('', '_blank', 'width=820,height=980')
    if (!win) return
    const title = t('strips.title')
    const sections = levels
      .map((level) => {
        const batches = strips.batches.filter((batch) => batch.level === level)
        if (batches.length === 0) return ''
        const rows = batches
          .map(
            (batch) =>
              `<p><strong>${escapeHtml(
                t('strips.batch', { count: batch.count, width: batch.width, length: batch.length }),
              )}</strong> ${escapeHtml(t('strips.place', { cells: batch.pieces.join(', ') }))}</p>`,
          )
          .join('')
        return `<h2>${escapeHtml(t('strips.level', { level }))}</h2>${rows}`
      })
      .join('')
    const meta = t('strips.print.meta', {
      pieces: strips.totalPieces,
      length: Math.round(strips.totalLengthMM),
      width: plan.grid.tapeWidth,
      levels: strips.levels,
    })
    win.document.write(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { margin: 0; color: #111; font: 12pt/1.35 system-ui, -apple-system, 'Segoe UI', sans-serif; }
  h1 { margin: 0 0 2mm; font-size: 18pt; }
  h2 { margin: 5mm 0 1.5mm; padding-bottom: 1mm; border-bottom: 1px solid #bbb; font-size: 14pt; }
  p { margin: 1.2mm 0; }
  .meta { margin: 0 0 5mm; color: #555; font-size: 10pt; }
  .note { margin-top: 6mm; color: #555; font-size: 10pt; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<div class="meta">${escapeHtml(meta)}</div>
${sections}
<p class="note">${escapeHtml(t('strips.order'))}</p>
</body>
</html>`)
    win.document.close()
    win.focus()
    window.setTimeout(() => win.print(), 150)
  }

  return (
    <Card title={t('strips.title')}>
      <Space orientation="vertical" size={12} style={{ width: '100%' }}>
        <Row gutter={[12, 8]}>
          <Col xs={12} sm={8} md={6}>
            <Statistic title={t('strips.stats.pieces')} value={strips.totalPieces} />
          </Col>
          <Col xs={12} sm={8} md={6}>
            <Statistic title={t('strips.stats.levels')} value={strips.levels} />
          </Col>
          <Col xs={12} sm={8} md={6}>
            <Statistic title={t('strips.stats.length')} value={Math.round(strips.totalLengthMM)} suffix="mm" />
          </Col>
        </Row>

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('strips.order')}
        </Typography.Text>

        {strips.warnings.map((warning, index) => (
          <Alert key={`${warning.code}-${index}`} type="warning" showIcon title={t(warning.code, warning.params)} />
        ))}

        {strips.totalPieces === 0 ? (
          <Alert type="info" showIcon title={t('strips.empty')} />
        ) : (
          levels.map((level) => {
            const batches = strips.batches.filter((batch) => batch.level === level)
            if (batches.length === 0) return null
            return (
              <div key={level}>
                <Typography.Title level={5} style={{ margin: '4px 0 4px' }}>
                  {t('strips.level', { level })}
                </Typography.Title>
                <Space orientation="vertical" size={2} style={{ width: '100%' }}>
                  {batches.map((batch) => (
                    <div key={`${level}-${batch.width}-${batch.length}`} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <Typography.Text strong>
                        {t('strips.batch', { count: batch.count, width: batch.width, length: batch.length })}
                      </Typography.Text>
                      <Typography.Text type="secondary">{t('strips.place', { cells: batch.pieces.join(', ') })}</Typography.Text>
                    </div>
                  ))}
                </Space>
              </div>
            )
          })
        )}

        <Space>
          <Button onClick={print} disabled={strips.totalPieces === 0}>
            {t('strips.print')}
          </Button>
        </Space>
      </Space>
    </Card>
  )
}
