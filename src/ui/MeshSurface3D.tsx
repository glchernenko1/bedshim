import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { Button, Slider, Space, Typography } from 'antd'
import type { Surface } from '../core/mesh/interpolate'
import { useT } from '../i18n'

const GRID = 56
const PADDING = 14
const DEFAULT_YAW = -0.55
const DEFAULT_ELEVATION = 0.9
const DEFAULT_Z_SCALE = 0.45

type Rgb = readonly [number, number, number]

const NEUTRAL: Rgb = [247, 247, 247]
const LOW: Rgb = [43, 108, 176]
const HIGH: Rgb = [197, 48, 48]

function mix(from: Rgb, to: Rgb, t: number): Rgb {
  const channel = (index: 0 | 1 | 2): number => from[index] + (to[index] - from[index]) * t
  return [channel(0), channel(1), channel(2)]
}

function baseColor(value: number, maxAbs: number): Rgb {
  if (maxAbs === 0) return NEUTRAL
  const normalized = Math.max(-1, Math.min(1, value / maxAbs))
  return normalized >= 0 ? mix(NEUTRAL, HIGH, normalized) : mix(NEUTRAL, LOW, -normalized)
}

function shade(color: Rgb, intensity: number): string {
  const clamp = (value: number): number => Math.max(0, Math.min(255, Math.round(value * intensity)))
  return `rgb(${clamp(color[0])}, ${clamp(color[1])}, ${clamp(color[2])})`
}

interface Projected {
  x: number
  y: number
  depth: number
}

/**
 * Rotatable height field drawn on a 2D canvas — no WebGL, no new dependency
 * (SPEC §11 keeps the dependency list closed). Drag rotates, the slider
 * exaggerates height. The view is auto-fitted, so rotation never clips it.
 */
export function MeshSurface3D({ surface, maxAbs }: { surface: Surface; maxAbs: number }) {
  const t = useT()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const dragRef = useRef<{ x: number; y: number } | null>(null)
  const [width, setWidth] = useState(0)
  const [yaw, setYaw] = useState(DEFAULT_YAW)
  const [elevation, setElevation] = useState(DEFAULT_ELEVATION)
  const [zScale, setZScale] = useState(DEFAULT_Z_SCALE)

  const height = width > 0 ? Math.max(260, Math.min(480, Math.round(width * 0.72))) : 0
  const bounds = surface.bounds
  const spanX = bounds.maxX - bounds.minX
  const spanY = bounds.maxY - bounds.minY

  const field = useMemo(() => {
    const rows: number[][] = []
    for (let row = 0; row <= GRID; row++) {
      const y = bounds.minY + (row / GRID) * spanY
      const line: number[] = []
      for (let col = 0; col <= GRID; col++) {
        const x = bounds.minX + (col / GRID) * spanX
        line.push(surface.at(x, y))
      }
      rows.push(line)
    }
    return rows
  }, [surface, bounds, spanX, spanY])

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

    const maxSpan = Math.max(spanX, spanY, 1e-6)
    const cosYaw = Math.cos(yaw)
    const sinYaw = Math.sin(yaw)
    const tilt = Math.PI / 2 - elevation
    const cosTilt = Math.cos(tilt)
    const sinTilt = Math.sin(tilt)
    const zAmp = maxAbs === 0 ? 1 : maxAbs
    const baseHeight = -1.25

    /** Rotates a grid point into camera space; `z` is normalised surface height. */
    const rotate = (col: number, row: number, z: number): Projected => {
      const wx = ((col / GRID) * 2 - 1) * (spanX / maxSpan)
      const wy = ((row / GRID) * 2 - 1) * (spanY / maxSpan)
      const hz = z * zScale
      const x1 = wx * cosYaw - wy * sinYaw
      const y1 = wx * sinYaw + wy * cosYaw
      return {
        x: x1,
        y: y1 * cosTilt - hz * sinTilt,
        depth: y1 * sinTilt + hz * cosTilt,
      }
    }

    // Pass 1: project everything to find the extent, then fit it to the canvas.
    const points: Projected[][] = []
    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    const track = (point: Projected): void => {
      if (point.x < minX) minX = point.x
      if (point.x > maxX) maxX = point.x
      if (point.y < minY) minY = point.y
      if (point.y > maxY) maxY = point.y
    }
    for (let row = 0; row <= GRID; row++) {
      const line: Projected[] = []
      for (let col = 0; col <= GRID; col++) {
        const point = rotate(col, row, field[row]![col]! / zAmp)
        line.push(point)
        track(point)
      }
      points.push(line)
    }
    const baseCorners: Projected[] = [
      rotate(0, 0, baseHeight),
      rotate(GRID, 0, baseHeight),
      rotate(GRID, GRID, baseHeight),
      rotate(0, GRID, baseHeight),
    ]
    baseCorners.forEach(track)

    const worldW = Math.max(maxX - minX, 1e-6)
    const worldH = Math.max(maxY - minY, 1e-6)
    const scale = Math.min((plotW - 16) / worldW, (plotH - 16) / worldH)
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    const screen = (point: Projected): [number, number] => [
      PADDING + plotW / 2 + (point.x - centerX) * scale,
      PADDING + plotH / 2 - (point.y - centerY) * scale,
    ]

    // Ground plane and its vertical edges.
    context.strokeStyle = 'rgba(0, 0, 0, 0.18)'
    context.lineWidth = 1
    context.beginPath()
    baseCorners.forEach((point, index) => {
      const [x, y] = screen(point)
      if (index === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    })
    context.closePath()
    context.stroke()
    const surfaceCorners = [points[0]![0]!, points[0]![GRID]!, points[GRID]![GRID]!, points[GRID]![0]!]
    surfaceCorners.forEach((point, index) => {
      const [x, y] = screen(point)
      const [bx, by] = screen(baseCorners[index]!)
      context.beginPath()
      context.moveTo(x, y)
      context.lineTo(bx, by)
      context.stroke()
    })

    // Light from above-left, in the same unrotated space as the normals.
    const light: Rgb = [-0.4, -0.5, 0.76]
    const lightLength = Math.hypot(light[0], light[1], light[2])
    const step = 2 / GRID

    interface Quad {
      depth: number
      corners: Array<[number, number]>
      fill: string
    }
    const quads: Quad[] = []
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        const z00 = field[row]![col]! / zAmp
        const z10 = field[row]![col + 1]! / zAmp
        const z11 = field[row + 1]![col + 1]! / zAmp
        const z01 = field[row + 1]![col]! / zAmp
        const p00 = points[row]![col]!
        const p10 = points[row]![col + 1]!
        const p11 = points[row + 1]![col + 1]!
        const p01 = points[row + 1]![col]!

        const nx = -(z10 - z00) * step
        const ny = -(z01 - z00) * step
        const nz = step * step
        const nLength = Math.hypot(nx, ny, nz) || 1
        const diffuse = Math.abs((nx * light[0] + ny * light[1] + nz * light[2]) / (nLength * lightLength))
        const intensity = 0.78 + 0.26 * diffuse

        const averageZ = (z00 + z10 + z11 + z01) / 4
        quads.push({
          depth: (p00.depth + p10.depth + p11.depth + p01.depth) / 4,
          corners: [screen(p00), screen(p10), screen(p11), screen(p01)],
          fill: shade(baseColor(averageZ * zAmp, maxAbs), intensity),
        })
      }
    }

    quads.sort((a, b) => a.depth - b.depth)
    for (const quad of quads) {
      context.beginPath()
      quad.corners.forEach(([x, y], index) => (index === 0 ? context.moveTo(x, y) : context.lineTo(x, y)))
      context.closePath()
      context.fillStyle = quad.fill
      context.fill()
      context.strokeStyle = quad.fill
      context.lineWidth = 0.7
      context.stroke()
    }

    // Front edge stays readable at any rotation: heavy line, no floating label.
    context.strokeStyle = 'rgba(0, 0, 0, 0.5)'
    context.lineWidth = 1.6
    context.beginPath()
    points[0]!.forEach((point, index) => {
      const [x, y] = screen(point)
      if (index === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    })
    context.stroke()

    context.strokeStyle = 'rgba(0, 0, 0, 0.35)'
    context.lineWidth = 2.2
    context.beginPath()
    ;[baseCorners[0]!, baseCorners[1]!].forEach((point, index) => {
      const [x, y] = screen(point)
      if (index === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    })
    context.stroke()
  }, [field, width, height, yaw, elevation, zScale, maxAbs, spanX, spanY])

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = { x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    dragRef.current = { x: event.clientX, y: event.clientY }
    setYaw((value) => value + dx * 0.009)
    setElevation((value) => Math.min(1.45, Math.max(0.12, value - dy * 0.006)))
  }

  const stopDrag = (event: PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <Space orientation="vertical" size={8} style={{ width: '100%' }}>
      <div ref={hostRef} style={{ width: '100%' }}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={t('mesh.view.aria', { x: Math.round(spanX), y: Math.round(spanY) })}
          style={{
            width: '100%',
            height: height > 0 ? `${height}px` : '260px',
            display: 'block',
            borderRadius: 6,
            cursor: 'grab',
            touchAction: 'none',
            background: '#fafafa',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
        />
      </div>
      <Space orientation="vertical" size={0} style={{ width: '100%' }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('mesh.view.zscale')}
        </Typography.Text>
        <Slider
          min={0.1}
          max={1.2}
          step={0.05}
          value={zScale}
          onChange={(value) => setZScale(Number(value))}
          tooltip={{ formatter: (value) => `${Number(value).toFixed(2)}×` }}
        />
      </Space>
      <Space size={8} wrap>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('mesh.view.drag')}
        </Typography.Text>
        <Button
          size="small"
          onClick={() => {
            setYaw(DEFAULT_YAW)
            setElevation(DEFAULT_ELEVATION)
            setZScale(DEFAULT_Z_SCALE)
          }}
        >
          {t('mesh.view.reset')}
        </Button>
      </Space>
    </Space>
  )
}
