import { useEffect, useRef, useState } from 'react'
import type { Plan } from '../core/plan'
import { useT } from '../i18n'

const PADDING = 10
const LAYER_COLORS = ['#f5f5f5', '#e6f4ff', '#bae0ff', '#69b1ff', '#1677ff', '#0958d9', '#003eb3', '#002c8c']
const TEXT_LIGHT = '#ffffff'
const TEXT_DARK = '#1f1f1f'

/** Plate-sized frame with tape cells, ids and layer counts (SPEC §2.2, §10.2). */
export function PlanGridCanvas({ plan }: { plan: Plan }) {
  const t = useT()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [width, setWidth] = useState(0)

  const plate = plan.grid.plate
  const height = width > 0 ? Math.max(220, Math.min(520, Math.round((width * plate.h) / plate.w))) : 0
  const displayBounds = plan.grid.meshBounds

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(host)
    setWidth(host.clientWidth)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width === 0 || height === 0) return
    const context = canvas.getContext('2d')
    if (!context) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, width, height)

    const plotW = width - PADDING * 2
    const plotH = height - PADDING * 2
    if (plotW <= 0 || plotH <= 0) return
    const sx = plotW / plate.w
    const sy = plotH / plate.h
    const px = (x: number): number => PADDING + x * sx
    const py = (y: number): number => PADDING + (plate.h - y) * sy

    // Plate outline: the sheet is cut to the plate, so the frame is self-aligning.
    context.strokeStyle = 'rgba(0, 0, 0, 0.35)'
    context.lineWidth = 1.5
    context.strokeRect(PADDING + 0.5, PADDING + 0.5, plotW - 1, plotH - 1)

    for (const cell of plan.cells) {
      const x = px(cell.x0)
      const y = py(cell.y1)
      const w = (cell.x1 - cell.x0) * sx
      const h = (cell.y1 - cell.y0) * sy
      const color = LAYER_COLORS[Math.min(cell.layers, LAYER_COLORS.length - 1)]!
      context.fillStyle = cell.unprobed ? '#fafafa' : color
      context.fillRect(x, y, w, h)
      context.strokeStyle = 'rgba(255, 255, 255, 0.9)'
      context.lineWidth = 1
      context.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1))

      if (cell.unprobed) {
        // Outside the mesh: hatched, and the planner keeps it empty by default.
        context.save()
        context.beginPath()
        context.rect(x, y, w, h)
        context.clip()
        context.strokeStyle = 'rgba(0, 0, 0, 0.12)'
        context.lineWidth = 1
        for (let offset = -h; offset < w; offset += 6) {
          context.beginPath()
          context.moveTo(x + offset, y + h)
          context.lineTo(x + offset + h, y)
          context.stroke()
        }
        context.restore()
      }

      if (cell.partial) {
        context.save()
        context.setLineDash([4, 3])
        context.strokeStyle = '#d46b08'
        context.lineWidth = 1.5
        context.strokeRect(x + 1, y + 1, Math.max(0, w - 2), Math.max(0, h - 2))
        context.restore()
      }

      const dark = cell.layers >= 3
      context.fillStyle = dark ? TEXT_LIGHT : TEXT_DARK
      context.font = '10px system-ui, sans-serif'
      context.textAlign = 'left'
      context.textBaseline = 'top'
      if (w > 26 && h > 22) context.fillText(cell.id, x + 3, y + 3)
      context.font = '600 13px system-ui, sans-serif'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(cell.layers > 0 ? String(cell.layers) : '·', x + w / 2, y + h / 2 + 2)
    }

    // Dashed rectangle where the mesh ends: everything outside is extrapolation.
    context.save()
    context.setLineDash([6, 4])
    context.strokeStyle = 'rgba(0, 0, 0, 0.45)'
    context.lineWidth = 1
    context.strokeRect(
      px(displayBounds.minX) + 0.5,
      py(displayBounds.maxY) + 0.5,
      (displayBounds.maxX - displayBounds.minX) * sx,
      (displayBounds.maxY - displayBounds.minY) * sy,
    )
    context.restore()

    context.fillStyle = 'rgba(0, 0, 0, 0.55)'
    context.font = '11px system-ui, sans-serif'
    context.textAlign = 'left'
    context.textBaseline = 'bottom'
    context.fillText(t('plan.map.front'), PADDING + 4, height - 2)
  }, [plan, width, height, plate, displayBounds, t])

  return (
    <div ref={hostRef} style={{ width: '100%' }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={t('plan.map.aria', { cols: plan.cols, rows: plan.rows })}
        style={{ width: '100%', height: height > 0 ? `${height}px` : '220px', display: 'block', borderRadius: 6, background: '#fff' }}
      />
    </div>
  )
}

export function LayerLegend({ maxUsed }: { maxUsed: number }) {
  const t = useT()
  const items = Array.from({ length: Math.max(1, maxUsed) + 1 }, (_, index) => index)
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
      {items.map((layers) => (
        <span key={layers} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
          <span
            style={{
              width: 14,
              height: 14,
              borderRadius: 3,
              border: '1px solid rgba(0,0,0,0.15)',
              background: LAYER_COLORS[Math.min(layers, LAYER_COLORS.length - 1)],
            }}
          />
          {layers === 0 ? t('plan.legend.none') : layers}
        </span>
      ))}
    </div>
  )
}
