import { useMemo } from 'react'
import { ConfigProvider, Layout, Segmented, Space, Tabs, Tag, Typography, theme } from 'antd'
import enUS from 'antd/locale/en_US'
import ruRU from 'antd/locale/ru_RU'
import { useLang, useT, type Lang } from './i18n'
import { useAppStore } from './state/store'
import { MeshTab } from './ui/MeshTab'
import { PlanTab } from './ui/PlanTab'
import { CalibrationCard } from './ui/CalibrationCard'
import { LatticeTab } from './ui/LatticeTab'

export function App() {
  const lang = useLang()
  const setLang = useAppStore((state) => state.setLang)
  const t = useT()
  const locale = useMemo(() => (lang === 'ru' ? ruRU : enUS), [lang])

  return (
    <ConfigProvider
      locale={locale}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: { borderRadius: 8, colorBgLayout: '#f5f5f5' },
      }}
    >
      <Layout style={{ minHeight: '100vh', background: 'transparent' }}>
        <div className="bedshim-shell">
          <Space orientation="vertical" size={16} style={{ width: '100%' }}>
            <Space align="start" wrap style={{ width: '100%', justifyContent: 'space-between' }}>
              <Space orientation="vertical" size={0}>
                <Space align="center" size={8} wrap>
                  <Typography.Title level={3} style={{ margin: 0 }}>
                    {t('app.title')}
                  </Typography.Title>
                  <Tag color="green">{t('app.offline')}</Tag>
                </Space>
                <Typography.Text type="secondary">{t('app.subtitle')}</Typography.Text>
              </Space>
              <Segmented<Lang>
                value={lang}
                onChange={(value) => setLang(value)}
                options={[
                  { label: 'EN', value: 'en' },
                  { label: 'RU', value: 'ru' },
                ]}
              />
            </Space>

            <Tabs
              defaultActiveKey="mesh"
              items={[
                { key: 'mesh', label: t('app.tab.mesh'), children: <MeshTab /> },
                { key: 'plan', label: t('app.tab.plan'), children: <PlanTab /> },
                {
                  key: 'calibration',
                  label: t('app.tab.calibration'),
                  children: (
                    <Space orientation="vertical" size={12} style={{ width: '100%' }}>
                      <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                        {t('calib.loop')}
                      </Typography.Paragraph>
                      <CalibrationCard />
                    </Space>
                  ),
                },
                {
                  key: 'lattice',
                  label: t('app.tab.lattice'),
                  children: <LatticeTab />,
                },
              ]}
            />
          </Space>
        </div>
      </Layout>
    </ConfigProvider>
  )
}
