import type { Triangle, Vec3 } from './extrude'

function normal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ux = b[0] - a[0]
  const uy = b[1] - a[1]
  const uz = b[2] - a[2]
  const vx = c[0] - a[0]
  const vy = c[1] - a[1]
  const vz = c[2] - a[2]
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  const length = Math.hypot(nx, ny, nz)
  return length > 1e-12 ? [nx / length, ny / length, nz / length] : [0, 0, 0]
}

/**
 * Binary STL, little-endian: 80-byte ASCII header, uint32 count, then 50 bytes
 * per triangle (normal, three vertices, uint16 attribute). Units are mm, Z up.
 */
export function writeBinaryStl(triangles: readonly Triangle[], header = 'bedshim lattice'): Uint8Array {
  const buffer = new ArrayBuffer(84 + triangles.length * 50)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  for (let index = 0; index < 80; index++) {
    bytes[index] = index < header.length ? header.charCodeAt(index) & 0x7f : 0
  }
  view.setUint32(80, triangles.length, true)

  let offset = 84
  for (const triangle of triangles) {
    const n = normal(triangle[0], triangle[1], triangle[2])
    for (const value of n) {
      view.setFloat32(offset, value, true)
      offset += 4
    }
    for (const point of triangle) {
      view.setFloat32(offset, point[0], true)
      view.setFloat32(offset + 4, point[1], true)
      view.setFloat32(offset + 8, point[2], true)
      offset += 12
    }
    view.setUint16(offset, 0, true)
    offset += 2
  }

  return bytes
}
