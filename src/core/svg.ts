import type { MultiPolygon, Rect } from './geometry/polygon'

function mm(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}

/**
 * 1:1 preview of the actual lattice sheet: the frame, the cut-out gap, the
 * bridges, every cell hole and the labels. It is the same 2D geometry that is
 * extruded; it is not a tape plan.
 */
export function buildLatticeSvg(outline: MultiPolygon, sheet: Rect): string {
  const width = sheet.x1 - sheet.x0
  const height = sheet.y1 - sheet.y0
  if (!(width > 0) || !(height > 0) || outline.length === 0) return ''
  const sy = (y: number): number => sheet.y1 - y
  const sx = (x: number): number => x - sheet.x0
  const path = outline
    .map((polygon) =>
      polygon
        .map((ring) => {
          const commands = ring.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${mm(sx(x))} ${mm(sy(y))}`)
          return `${commands.join(' ')} Z`
        })
        .join(' '),
    )
    .join(' ')

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${mm(width)}mm" height="${mm(height)}mm" viewBox="0 0 ${mm(width)} ${mm(height)}">`,
    `<rect width="${mm(width)}" height="${mm(height)}" fill="#ffffff"/>`,
    `<path d="${path}" fill="#d9d9d9" fill-rule="evenodd" stroke="#616161" stroke-width="0.2"/>`,
    '</svg>',
  ].join('\n')
}
