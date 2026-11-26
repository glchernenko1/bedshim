import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Space, Typography, notification } from 'antd'
import { bedMeshSnippet, idealProbeCount, probeMismatch } from '../core/probe'
import { useT } from '../i18n'
import { useAppStore } from '../state/store'

const KEY = 'probe-grid'
/** Wait for the tape field to stop changing before a new hint may open. */
const SETTLE_MS = 900

function CopyConfig({ text }: { text: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard needs a secure context; the code block stays selectable.
    }
  }
  return (
    <Space orientation="vertical" size={6} style={{ width: '100%' }}>
      <Typography.Paragraph code style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 12 }}>
        {text}
      </Typography.Paragraph>
      <Button size="small" onClick={() => void copy()}>
        {copied ? t('probe.notice.popup.copied') : t('probe.notice.popup.copy')}
      </Button>
    </Space>
  )
}

/**
 * Auto-only hint that the mesh was probed on a grid that does not fit the tape
 * width. It suggests the ideal probe_count with a copy-paste `[bed_mesh]`
 * block, and stays dismissed for the same tape width until the user clears all
 * measurements or changes the tape. The tape input is debounced so typing
 * "15" does not flash the hint at "1" and "15".
 */
export function ProbeGridNotice() {
  const t = useT()
  const mode = useAppStore((state) => state.mode)
  const measurements = useAppStore((state) => state.measurements)
  const selectedId = useAppStore((state) => state.selectedId)
  const tapeWidth = useAppStore((state) => state.planSettings.tapeWidth)
  const dismissed = useAppStore((state) => state.probeNoticeDismissed)
  const dismiss = useAppStore((state) => state.dismissProbeNotice)
  const reset = useAppStore((state) => state.resetProbeNotice)
  const [api, contextHolder] = notification.useNotification()

  // Only the settled value is allowed to open the hint.
  const [settledTape, setSettledTape] = useState(tapeWidth)
  useEffect(() => {
    const id = window.setTimeout(() => setSettledTape(tapeWidth), SETTLE_MS)
    return () => window.clearTimeout(id)
  }, [tapeWidth])

  // Any tape change (including changing back) is a new recommendation.
  const previousTape = useRef(tapeWidth)
  useEffect(() => {
    if (previousTape.current === tapeWidth) return
    previousTape.current = tapeWidth
    reset()
  }, [tapeWidth, reset])

  const measurement = measurements.find((item) => item.id === selectedId) ?? null
  const bounds = measurement?.mesh.bounds ?? null
  const mismatch = useMemo(() => {
    if (mode !== 'auto' || !bounds || !measurement) return null
    return probeMismatch(bounds, settledTape, measurement.mesh.xCount, measurement.mesh.yCount)
  }, [mode, bounds, settledTape, measurement])
  const snippet = useMemo(() => {
    if (!bounds) return ''
    const ideal = idealProbeCount(bounds, settledTape)
    return bedMeshSnippet(bounds, ideal.x, ideal.y)
  }, [bounds, settledTape])

  useEffect(() => {
    const changing = tapeWidth !== settledTape
    if (!mismatch || dismissed || changing) {
      api.destroy(KEY)
      return
    }
    const close = (): void => {
      api.destroy(KEY)
      dismiss()
    }
    api.warning({
      key: KEY,
      placement: 'top',
      duration: false,
      closable: true,
      title: t('probe.notice.popup.title'),
      description: (
        <Space orientation="vertical" size={8} style={{ width: '100%' }}>
          <Typography.Text>
            {t('probe.notice.popup.body', {
              currentX: mismatch.currentX,
              currentY: mismatch.currentY,
              idealX: mismatch.idealX,
              idealY: mismatch.idealY,
              points: mismatch.points,
              tape: settledTape,
            })}
          </Typography.Text>
          <CopyConfig text={snippet} />
          <Typography.Text type="secondary">{t('probe.notice.popup.after')}</Typography.Text>
        </Space>
      ),
      actions: (
        <Button size="small" type="primary" onClick={close}>
          {t('probe.notice.popup.ok')}
        </Button>
      ),
      onClose: close,
      style: { width: 'min(420px, calc(100vw - 32px))' },
    })
  }, [api, dismissed, dismiss, mismatch, settledTape, snippet, t, tapeWidth])

  return contextHolder
}
