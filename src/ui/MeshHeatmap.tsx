import { useEffect, useRef, useState, type MouseEvent } from 'react'
import type { Surface } from '../core/mesh/interpolate'
import { useT } from '../i18n'

const PADDING = 10
const SAMPLES = 72

type Rgb = readonly [number, number, number]

const NEUTRAL: Rgb = [247, 247, 247]
const LOW: Rgb = [43, 108, 176]
const HIGH: Rgb = [197, 48, 48]

function mix(from: Rgb, to: Rgb, t: number): string {
  const channel = (index: 0 | 1 | 2): number => Math.round(from[index] + (to[index] - from[index]) * t)
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`
}

function colorFor(value: number, maxAbs: number): string {
  if (maxAbs === 0) return mix(NEUTRAL, NEUTRAL, 0)
  const normalized = Math.max(-1, Math.min(1, value / maxAbs))
  return normalized >= 0 ? mix(NEUTRAL, HIGH, normalized) : mix(NEUTRAL, LOW, -normalized)
}

interface Hover {
  x: number
  y: number
  z: number
  left: number
  top: number
}

/**
 * Custom canvas heatmap (SPEC §11: Ant only for the shell).
 * Front (min_y) is drawn at the bottom, left (min_x) at the left — the `top` view.
 */
export function MeshHeatmap({
  surface,
  maxAbs,
  baseline = 0,
}: {
  surface: Surface
  maxAbs: number
  /** Value that maps to the neutral colour. Default 0 (the probe trigger plane). */
  baseline?: number
}) {
  const t = useT()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<Hover | null>(null)

  const bounds = surface.bounds
  const spanX = bounds.maxX - bounds.minX
  const spanY = bounds.maxY - bounds.minY

  const height = width > 0 ? Math.max(200, Math.min(460, Math.round((width * spanY) / spanX))) : 0

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

    const cellW = plotW / SAMPLES
    const cellH = plotH / SAMPLES
    for (let row = 0; row < SAMPLES; row++) {
      // row 0 is min_y (front) and lands at the bottom of the canvas.
      const y = bounds.minY + ((row + 0.5) * spanY) / SAMPLES
      const top = PADDING + (SAMPLES - 1 - row) * cellH
      for (let col = 0; col < SAMPLES; col++) {
        const x = bounds.minX + ((col + 0.5) * spanX) / SAMPLES
        const value = surface.at(x, y)
        context.fillStyle = colorFor(value - baseline, maxAbs)
        context.fillRect(PADDING + col * cellW, top, cellW + 0.5, cellH + 0.5)
      }
    }

    // Probe nodes.
    context.strokeStyle = 'rgba(0, 0, 0, 0.55)'
    context.fillStyle = 'rgba(255, 255, 255, 0.9)'
    context.lineWidth = 1
    for (let row = 0; row < surface.yCount; row++) {
      for (let col = 0; col < surface.xCount; col++) {
        const px = PADDING + ((surface.xCount === 1 ? 0 : col / (surface.xCount - 1)) * plotW)
        const py = PADDING + ((surface.yCount === 1 ? 0 : 1 - row / (surface.yCount - 1)) * plotH)
        context.beginPath()
        context.arc(px, py, 2.2, 0, Math.PI * 2)
        context.fill()
        context.stroke()
      }
    }

    context.strokeStyle = 'rgba(0, 0, 0, 0.25)'
    context.strokeRect(PADDING + 0.5, PADDING + 0.5, plotW - 1, plotH - 1)
  }, [surface, width, height, maxAbs, baseline, bounds, spanX, spanY])

  const onMove = (event: MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const px = event.clientX - rect.left
    const py = event.clientY - rect.top
    const plotW = width - PADDING * 2
    const plotH = height - PADDING * 2
    if (px < PADDING || py < PADDING || px > PADDING + plotW || py > PADDING + plotH) {
      setHover(null)
      return
    }
    const x = bounds.minX + ((px - PADDING) / plotW) * spanX
    const y = bounds.maxY - ((py - PADDING) / plotH) * spanY
    setHover({ x, y, z: surface.at(x, y), left: px, top: py })
  }

  return (
    <div ref={hostRef} style={{ position: 'relative', width: '100%' }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={t('heatmap.aria', { x: Math.round(spanX), y: Math.round(spanY) })}
        style={{ width: '100%', height: height > 0 ? `${height}px` : '200px', display: 'block', borderRadius: 6 }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      />
      {hover && (
        <div
          style={{
            position: 'absolute',
            left: hover.left,
            top: hover.top,
            transform: 'translate(-50%, -130%)',
            background: 'rgba(0, 0, 0, 0.82)',
            color: '#fff',
            padding: '4px 8px',
            borderRadius: 6,
            fontSize: 12,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {t('heatmap.hover', {
            x: hover.x.toFixed(1),
            y: hover.y.toFixed(1),
            z: hover.z.toFixed(3),
          })}
        </div>
      )}
    </div>
  )
}
