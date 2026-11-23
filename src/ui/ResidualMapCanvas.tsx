import { useEffect, useRef, useState } from 'react'
import type { Grid } from '../core/grid'
import type { ForwardResult } from '../core/forward'
import { useT } from '../i18n'

const PADDING = 10
const NEUTRAL: [number, number, number] = [250, 250, 250]
const LOW: [number, number, number] = [43, 108, 176]
const HIGH: [number, number, number] = [197, 48, 48]

function mix(from: [number, number, number], to: [number, number, number], t: number): string {
  const channel = (index: 0 | 1 | 2): number => Math.round(from[index] + (to[index] - from[index]) * t)
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`
}

function colorFor(residual: number, maxAbs: number): string {
  if (maxAbs === 0) return mix(NEUTRAL, NEUTRAL, 0)
  const normalized = Math.max(-1, Math.min(1, residual / maxAbs))
  return normalized >= 0 ? mix(NEUTRAL, HIGH, normalized) : mix(NEUTRAL, LOW, -normalized)
}

/**
 * Predicted residual per cell, in µm: blue = still low, red = overshoot.
 * Same plate frame as the plan map so the two can be read together.
 */
export function ResidualMapCanvas({ grid, prediction }: { grid: Grid; prediction: ForwardResult }) {
  const t = useT()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [width, setWidth] = useState(0)

  const plate = grid.plate
  const height = width > 0 ? Math.max(220, Math.min(520, Math.round((width * plate.h) / plate.w))) : 0
  const maxAbs = Math.max(1e-6, prediction.maxAbsResidual)

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

    for (const cell of prediction.cells) {
      const x = px(cell.col * grid.tapeWidth + grid.meshBounds.minX)
      const yTop = py(grid.meshBounds.minY + (cell.row + 1) * grid.rowSpacing)
      const w = grid.tapeWidth * sx
      const h = grid.rowSpacing * sy
      context.fillStyle = colorFor(cell.residual, maxAbs)
      context.fillRect(x, yTop, w, h)
      context.strokeStyle = 'rgba(255, 255, 255, 0.9)'
      context.lineWidth = 1
      context.strokeRect(x + 0.5, yTop + 0.5, Math.max(0, w - 1), Math.max(0, h - 1))

      const micrometres = Math.round(cell.residual * 1000)
      context.fillStyle = 'rgba(0, 0, 0, 0.72)'
      context.font = '600 11px system-ui, sans-serif'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      if (w > 22 && h > 16) {
        context.fillText(micrometres === 0 ? '0' : `${micrometres > 0 ? '+' : ''}${micrometres}`, x + w / 2, yTop + h / 2)
      }
    }

    context.fillStyle = 'rgba(0, 0, 0, 0.55)'
    context.font = '11px system-ui, sans-serif'
    context.textAlign = 'left'
    context.textBaseline = 'bottom'
    context.fillText(t('plan.map.front'), PADDING + 4, height - 2)
  }, [prediction, grid, width, height, plate, maxAbs, t])

  return (
    <div ref={hostRef} style={{ width: '100%' }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={t('plan.forward.map.aria', { count: prediction.cells.length })}
        style={{ width: '100%', height: height > 0 ? `${height}px` : '220px', display: 'block', borderRadius: 6, background: '#fff' }}
      />
    </div>
  )
}
