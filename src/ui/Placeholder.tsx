import { Alert, Card, Typography } from 'antd'
import { useT } from '../i18n'

interface PlaceholderProps {
  phase: string
  titleKey: string
  bodyKey: string
}

/** Honest placeholder: no fake controls for phases that are not built yet. */
export function Placeholder({ phase, titleKey, bodyKey }: PlaceholderProps) {
  const t = useT()
  return (
    <Card>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        {t(titleKey)}
      </Typography.Title>
      <Typography.Paragraph>{t(bodyKey)}</Typography.Paragraph>
      <Alert type="info" showIcon title={t('app.phase.title')} description={t('app.phase.body', { phase })} />
    </Card>
  )
}
