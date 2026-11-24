import { useEffect, useRef, useState } from 'react'
import { Typography } from 'antd'
import type { Grid } from '../core/grid'
import type { ForwardResult } from '../core/forward'
import { useT } from '../i18n'

const PADDING = 10
const NEUTRAL: [number, number, number] = [250, 250, 250]
const LOW: [number, number, number] = [43, 108, 176]
const HIGH: [number, number, number] = [197, 48, 48]
const IN_TARGET: [number, number, number] = [60, 160, 110]
const EXPECTED: [number, number, number] = [173, 196, 222]

type Rgb = [number, number, number]

function mix(from: Rgb, to: Rgb, t: number): Rgb {
  const channel = (index: 0 | 1 | 2): number => Math.round(from[index] + (to[index] - from[index]) * t)
  return [channel(0), channel(1), channel(2)]
}

function css(color: Rgb): string {
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`
}

function textColor(color: Rgb): string {
  const luminance = 0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2]
  return luminance < 140 ? 'rgba(255, 255, 255, 0.95)' : 'rgba(0, 0, 0, 0.72)'
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/**
 * Residual colour: green inside the deadband, pale blue where the floor rule is
 * allowed to undershoot, strong blue below target and red above it.
 */
function residualColor(residual: number, maxAbs: number, deadband: number, floorBand: number): Rgb {
  if (Math.abs(residual) < deadband) return IN_TARGET
  if (residual >= 0) return mix(NEUTRAL, HIGH, clamp01(residual / maxAbs))
  const magnitude = -residual
  const anchor = floorBand > 0 ? EXPECTED : NEUTRAL
  const from = floorBand > 0 ? floorBand : 0
  if (floorBand > 0 && magnitude <= floorBand) return mix(NEUTRAL, EXPECTED, clamp01(magnitude / floorBand))
  return mix(anchor, LOW, clamp01((magnitude - from) / Math.max(1e-6, maxAbs - from)))
}

function signedMicrometres(value: number): string {
  const micrometres = Math.round(value * 1000)
  return micrometres > 0 ? `+${micrometres}` : String(micrometres)
}

function LegendSwatch({ color, label }: { color: Rgb; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          width: 12,
          height: 12,
          borderRadius: 3,
          background: css(color),
          border: '1px solid rgba(0, 0, 0, 0.15)',
          flex: '0 0 auto',
        }}
      />
      {label}
    </span>
  )
}

/**
 * Per-cell residual map. Cells are the cells the tape plan uses, so the numbers
 * line up with the layer map; the smooth predicted bed lives in `PredictedRelief`.
 */
export function ResidualMapCanvas({
  grid,
  prediction,
  floorBand = 0,
}: {
  grid: Grid
  prediction: ForwardResult
  /** Undershoot the floor rule allows, mm. */
  floorBand?: number
}) {
  const t = useT()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [width, setWidth] = useState(0)

  const plate = grid.plate
  const height = width > 0 ? Math.max(220, Math.min(520, Math.round((width * plate.h) / plate.w))) : 0

  const forwardById = new Map(prediction.cells.map((cell) => [cell.id, cell]))
  const probed = grid.cells
    .filter((cell) => !cell.unprobed)
    .map((cell) => forwardById.get(cell.id))
    .filter((cell): cell is NonNullable<typeof cell> => cell !== undefined)

  const residualMax = Math.max(1e-6, ...probed.map((cell) => Math.abs(cell.residual)))
  const deadband = prediction.deadband

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

    context.strokeStyle = 'rgba(0, 0, 0, 0.35)'
    context.lineWidth = 1.5
    context.strokeRect(PADDING + 0.5, PADDING + 0.5, plotW - 1, plotH - 1)

    for (const cell of grid.cells) {
      const forward = forwardById.get(cell.id)
      if (!forward) continue
      const x = px(cell.x0)
      const y = py(cell.y1)
      const w = (cell.x1 - cell.x0) * sx
      const h = (cell.y1 - cell.y0) * sy

      if (cell.unprobed) {
        // Outside the mesh: hatched, exactly like the layer map.
        context.fillStyle = '#fafafa'
        context.fillRect(x, y, w, h)
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
        continue
      }

      const color = residualColor(forward.residual, residualMax, deadband, floorBand)
      context.fillStyle = css(color)
      context.fillRect(x, y, w, h)
      context.strokeStyle = 'rgba(255, 255, 255, 0.9)'
      context.lineWidth = 1
      context.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1))

      if (w > 22 && h > 16) {
        context.fillStyle = textColor(color)
        context.font = '600 11px system-ui, sans-serif'
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.fillText(signedMicrometres(forward.residual), x + w / 2, y + h / 2)
      }
    }

    // Dashed rectangle where the mesh ends, as on the layer map.
    const bounds = grid.meshBounds
    context.save()
    context.setLineDash([6, 4])
    context.strokeStyle = 'rgba(0, 0, 0, 0.45)'
    context.lineWidth = 1
    context.strokeRect(
      px(bounds.minX) + 0.5,
      py(bounds.maxY) + 0.5,
      (bounds.maxX - bounds.minX) * sx,
      (bounds.maxY - bounds.minY) * sy,
    )
    context.restore()

    context.fillStyle = 'rgba(0, 0, 0, 0.55)'
    context.font = '11px system-ui, sans-serif'
    context.textAlign = 'left'
    context.textBaseline = 'bottom'
    context.fillText(t('plan.map.front'), PADDING + 4, height - 2)
  }, [grid, prediction, width, height, plate, residualMax, deadband, floorBand, t])

  return (
    <div style={{ width: '100%' }}>
      <div ref={hostRef} style={{ width: '100%' }}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={t('plan.forward.map.aria', { count: probed.length })}
          style={{ width: '100%', height: height > 0 ? `${height}px` : '220px', display: 'block', borderRadius: 6, background: '#fff' }}
        />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginTop: 6, fontSize: 12 }}>
        <LegendSwatch color={IN_TARGET} label={t('plan.forward.map.legend.ok')} />
        {floorBand > 0 && <LegendSwatch color={EXPECTED} label={t('plan.forward.map.legend.expected')} />}
        <LegendSwatch color={LOW} label={t('plan.forward.map.legend.low')} />
        <LegendSwatch color={HIGH} label={t('plan.forward.map.legend.high')} />
        <Typography.Text type="secondary">{t('plan.forward.map.scale.residual', { max: Math.round(residualMax * 1000) })}</Typography.Text>
      </div>
    </div>
  )
}
