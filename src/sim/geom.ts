import type { Vec2 } from './types'
import type { Wall } from './map'

/** Twice the signed area of the triangle abc: which side of ab the point c is on. */
function cross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number) {
  return (bx - ax) * (cz - az) - (bz - az) * (cx - ax)
}

/** True when segment pq properly crosses or touches the wall. */
export function crossesWall(p: Vec2, q: Vec2, w: Wall): boolean {
  const [x0, z0, x1, z1] = w
  // Cheap bounding-box reject first: most walls are nowhere near.
  if (Math.max(p[0], q[0]) < Math.min(x0, x1) - 1e-9 || Math.min(p[0], q[0]) > Math.max(x0, x1) + 1e-9) return false
  if (Math.max(p[1], q[1]) < Math.min(z0, z1) - 1e-9 || Math.min(p[1], q[1]) > Math.max(z0, z1) + 1e-9) return false
  const d1 = cross(x0, z0, x1, z1, p[0], p[1])
  const d2 = cross(x0, z0, x1, z1, q[0], q[1])
  const d3 = cross(p[0], p[1], q[0], q[1], x0, z0)
  const d4 = cross(p[0], p[1], q[0], q[1], x1, z1)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/** Where a ray from `from` in direction (dx, dz) first hits any wall, up to `max` away. */
export function castRay(from: Vec2, dx: number, dz: number, max: number, walls: readonly Wall[]): number {
  let best = max
  for (const [x0, z0, x1, z1] of walls) {
    const ex = x1 - x0
    const ez = z1 - z0
    const denom = dx * ez - dz * ex
    if (Math.abs(denom) < 1e-12) continue
    const t = ((x0 - from[0]) * ez - (z0 - from[1]) * ex) / denom
    const u = ((x0 - from[0]) * dz - (z0 - from[1]) * dx) / denom
    if (t > 0 && t < best && u >= 0 && u <= 1) best = t
  }
  return best
}
