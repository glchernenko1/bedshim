import { useMemo, useState } from 'react'
import { ConfigProvider, Layout, Segmented, Space, Tabs, Tag, Typography, theme } from 'antd'
import enUS from 'antd/locale/en_US'
import ruRU from 'antd/locale/ru_RU'
import { useLang, useT, type Lang } from './i18n'
import { useAppStore, type AppMode } from './state/store'
import { MeshTab } from './ui/MeshTab'
import { PlanTab } from './ui/PlanTab'
import { CalibrationCard } from './ui/CalibrationCard'
import { LatticeTab } from './ui/LatticeTab'
import { useAutoCalibration } from './ui/useAutoCalibration'

type TabKey = 'mesh' | 'plan' | 'calibration' | 'lattice'

export function App() {
  const lang = useLang()
  const setLang = useAppStore((state) => state.setLang)
  const mode = useAppStore((state) => state.mode)
  const setMode = useAppStore((state) => state.setMode)
  const t = useT()
  const locale = useMemo(() => (lang === 'ru' ? ruRU : enUS), [lang])
  const [tab, setTab] = useState<TabKey>('mesh')
  const auto = useAutoCalibration()

  const changeMode = (next: AppMode): void => {
    setMode(next)
    // Calibration is not a tab in Auto, so do not leave a hidden key active.
    if (next === 'auto' && tab === 'calibration') setTab('plan')
  }

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
              <Space align="center" size={8} wrap>
                <Segmented<AppMode>
                  value={mode}
                  onChange={changeMode}
                  options={[
                    { label: t('app.mode.pro'), value: 'pro' },
                    { label: t('app.mode.auto'), value: 'auto' },
                  ]}
                />
                <Segmented<Lang>
                  value={lang}
                  onChange={(value) => setLang(value)}
                  options={[
                    { label: 'EN', value: 'en' },
                    { label: 'RU', value: 'ru' },
                  ]}
                />
              </Space>
            </Space>

            <Tabs
              activeKey={tab}
              onChange={(key) => setTab(key as TabKey)}
              items={[
                { key: 'mesh', label: t('app.tab.mesh'), children: <MeshTab /> },
                { key: 'plan', label: t('app.tab.plan'), children: <PlanTab auto={auto} /> },
                ...(mode === 'pro'
                  ? [
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
                    ]
                  : []),
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
