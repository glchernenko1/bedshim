import { useMemo } from 'react'
import { ConfigProvider, Layout, Segmented, Space, Tabs, Tag, Typography, theme } from 'antd'
import enUS from 'antd/locale/en_US'
import ruRU from 'antd/locale/ru_RU'
import { useLang, useT, type Lang } from './i18n'
import { useAppStore } from './state/store'
import { MeshTab } from './ui/MeshTab'
import { Placeholder } from './ui/Placeholder'

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
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Space align="start" wrap style={{ width: '100%', justifyContent: 'space-between' }}>
              <Space direction="vertical" size={0}>
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
                {
                  key: 'plan',
                  label: t('app.tab.plan'),
                  children: (
                    <Placeholder
                      phase="P2–P4"
                      titleKey="plan.placeholder.title"
                      bodyKey="plan.placeholder.body"
                    />
                  ),
                },
                {
                  key: 'lattice',
                  label: t('app.tab.lattice'),
                  children: (
                    <Placeholder
                      phase="P5"
                      titleKey="lattice.placeholder.title"
                      bodyKey="lattice.placeholder.body"
                    />
                  ),
                },
              ]}
            />
          </Space>
        </div>
      </Layout>
    </ConfigProvider>
  )
}
