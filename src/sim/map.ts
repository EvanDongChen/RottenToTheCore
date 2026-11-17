import type { Rng } from './rng'
import type { Vec2 } from './types'

/**
 * The lab, as plain data. Nine rooms in a three-by-three grid around the Cafeteria, joined by
 * straight hallways. Rooms and hallways are all axis-aligned rectangles, which keeps everything
 * else simple: any two points in the same area can see each other and walk straight across.
 * Walls, doors and the nav graph are worked out from the rectangles below.
 * A second map later is a new data file in this shape, not new code.
 *
 * Coordinates: x runs left to right, z top to bottom (as seen from the default camera).
 */

/** [left, top, right, bottom] */
export type Rect = [number, number, number, number]

export type RoomId = 'greenhouse' | 'juicer' | 'lab' | 'electrical' | 'cafeteria' | 'admin' | 'ripening' | 'cold' | 'security'

export interface Area {
  id: string
  name: string
  rect: Rect
  /** Hallways join two rooms. */
  hallway?: [RoomId, RoomId]
}

export interface Door {
  id: string
  /** The two areas the door joins: always one room and one hallway. */
  areas: [string, string]
  /** Middle of the opening. */
  at: Vec2
  /** Unit vector along the opening, for spreading walkers across it. */
  along: Vec2
  half: number
}

export type TaskLength = 'short' | 'long'

export interface Station {
  id: string
  room: RoomId
  name: string
  at: Vec2
  length: TaskLength
  /** Anyone nearby can see the effect, which proves the worker is crew. */
  visual: boolean
}

export interface Vent {
  id: string
  room: RoomId
  at: Vec2
  /** The vent at the other end. */
  to: string
}

export interface Camera {
  id: string
  at: Vec2
  radius: number
}

/** Something round in the middle of a room that fruits walk around, like the meeting table. */
export interface Obstacle {
  at: Vec2
  radius: number
}

export const WALL_HEIGHT = 1.2

const ROOM_DEFS: Area[] = [
  { id: 'greenhouse', name: 'Greenhouse', rect: [-29, -19, -17, -10] },
  { id: 'juicer', name: 'Juicer', rect: [-8, -19, 8, -10] },
  { id: 'lab', name: 'Lab', rect: [17, -19, 29, -10] },
  { id: 'electrical', name: 'Electrical', rect: [-29, -6, -17, 6] },
  { id: 'cafeteria', name: 'Cafeteria', rect: [-8, -6, 8, 6] },
  { id: 'admin', name: 'Admin', rect: [17, -6, 29, 6] },
  { id: 'ripening', name: 'Ripening Chamber', rect: [-29, 10, -17, 19] },
  { id: 'cold', name: 'Cold Storage', rect: [-8, 10, 8, 19] },
  { id: 'security', name: 'Security', rect: [17, 10, 29, 19] },
]

/** Eleven hallways. Electrical joins only the Greenhouse and the Ripening Chamber: the quiet room. */
const HALLWAY_DEFS: [RoomId, RoomId, Rect][] = [
  ['greenhouse', 'juicer', [-17, -16, -8, -13]],
  ['juicer', 'lab', [8, -16, 17, -13]],
  ['cafeteria', 'admin', [8, -1.5, 17, 1.5]],
  ['ripening', 'cold', [-17, 13, -8, 16]],
  ['cold', 'security', [8, 13, 17, 16]],
  ['juicer', 'cafeteria', [-1.5, -10, 1.5, -6]],
  ['cafeteria', 'cold', [-1.5, 6, 1.5, 10]],
  ['greenhouse', 'electrical', [-24.5, -10, -21.5, -6]],
  ['electrical', 'ripening', [-24.5, 6, -21.5, 10]],
  ['lab', 'admin', [21.5, -10, 24.5, -6]],
  ['admin', 'security', [21.5, 6, 24.5, 10]],
]

export const STATIONS: Station[] = [
  { id: 'wipe', room: 'cafeteria', name: 'Wipe the table', at: [0, 3.1], length: 'short', visual: false },
  { id: 'water', room: 'greenhouse', name: 'Water seedlings', at: [-26.5, -16.5], length: 'short', visual: false },
  { id: 'prune', room: 'greenhouse', name: 'Prune vines', at: [-19.5, -12.5], length: 'long', visual: false },
  { id: 'juice', room: 'juicer', name: 'Juice a batch', at: [0, -16.5], length: 'long', visual: true },
  { id: 'wiring', room: 'electrical', name: 'Fix wiring', at: [-26.5, -3], length: 'short', visual: false },
  { id: 'swipe', room: 'admin', name: 'Swipe card', at: [26.5, -3], length: 'short', visual: false },
  { id: 'scan', room: 'lab', name: 'Scan sample', at: [23, -16.5], length: 'long', visual: true },
  { id: 'calibrate', room: 'ripening', name: 'Calibrate ripeness', at: [-26.5, 16.5], length: 'long', visual: false },
  { id: 'temps', room: 'cold', name: 'Check temperatures', at: [5, 16.5], length: 'short', visual: false },
  { id: 'fridge', room: 'cold', name: 'Restock the fridge', at: [-5, 16.5], length: 'short', visual: false },
]

/** Where the lights are fixed after a sabotage. */
export const FUSE_BOX: Vec2 = [-26.5, 3]
/** The emergency button sits on the meeting table. A fruit presses it from the table's edge. */
export const BUTTON: Vec2 = [0, 0]
export const BUTTON_REACH = 3.2
/** A fruit sitting here sees what the cameras see. */
export const MONITORS: Vec2 = [26, 16.5]

export const VENTS: Vent[] = [
  { id: 'vent-electrical', room: 'electrical', at: [-20, 2.5], to: 'vent-admin' },
  { id: 'vent-admin', room: 'admin', at: [20, -3], to: 'vent-electrical' },
  { id: 'vent-lab', room: 'lab', at: [20, -12.5], to: 'vent-ripening' },
  { id: 'vent-ripening', room: 'ripening', at: [-20, 12.5], to: 'vent-lab' },
]

export const CAMERAS: Camera[] = [
  { id: 'cam-west', at: [-12.5, -14.5], radius: 5 },
  { id: 'cam-east', at: [12.5, -14.5], radius: 5 },
  { id: 'cam-admin', at: [12.5, 0], radius: 5 },
  { id: 'cam-south', at: [-12.5, 14.5], radius: 5 },
]

export const TABLE: Obstacle = { at: [0, 0], radius: 2.2 }
export const OBSTACLES: Obstacle[] = [TABLE]
/** How close fruits may come to an obstacle's edge. */
export const OBSTACLE_MARGIN = 0.5

/** Seats round the meeting table, one per fruit. */
export const SEAT_RING = 4

export const ROOMS: Area[] = ROOM_DEFS
export const HALLWAYS: Area[] = HALLWAY_DEFS.map(([a, b, rect]) => ({
  id: `${a}-${b}`,
  name: `${ROOM_DEFS.find((r) => r.id === a)!.name}–${ROOM_DEFS.find((r) => r.id === b)!.name} hallway`,
  rect,
  hallway: [a, b],
}))
export const AREAS: Area[] = [...ROOMS, ...HALLWAYS]
const AREA_BY_ID = new Map(AREAS.map((a) => [a.id, a]))

export function area(id: string): Area {
  return AREA_BY_ID.get(id)!
}

export function isRoom(id: string): id is RoomId {
  return ROOMS.some((r) => r.id === id)
}

/** A short name for talking about a place: rooms by name, hallways as "the hallway by X". */
export function placeName(id: string): string {
  const a = AREA_BY_ID.get(id)
  if (!a) return 'somewhere'
  return a.hallway ? `the ${a.name}` : `${a.name}`
}

/** The rooms next to this one, through one hallway. */
export function neighbours(room: string): RoomId[] {
  return HALLWAYS.filter((h) => h.hallway!.includes(room as RoomId)).map((h) => h.hallway!.find((r) => r !== room)!)
}

function inside(rect: Rect, [x, z]: Vec2, pad = 0) {
  return x >= rect[0] + pad && x <= rect[2] - pad && z >= rect[1] + pad && z <= rect[3] - pad
}

/** Which area a point is in. Points on a doorway belong to the room. Outside everything: the nearest. */
export function areaAt(p: Vec2): string {
  for (const a of AREAS) if (inside(a.rect, p)) return a.id
  let best = AREAS[0]
  let bestD = Infinity
  for (const a of AREAS) {
    const dx = Math.max(a.rect[0] - p[0], 0, p[0] - a.rect[2])
    const dz = Math.max(a.rect[1] - p[1], 0, p[1] - a.rect[3])
    const d = dx * dx + dz * dz
    if (d < bestD) {
      bestD = d
      best = a
    }
  }
  return best.id
}

/** The room a point is in, or for a hallway, the nearer of the two rooms it joins. */
export function roomAt(p: Vec2): RoomId {
  const a = area(areaAt(p))
  if (!a.hallway) return a.id as RoomId
  const [r1, r2] = a.hallway.map((id) => area(id))
  return (dist(p, centre(r1.rect)) <= dist(p, centre(r2.rect)) ? r1.id : r2.id) as RoomId
}

export function centre(rect: Rect): Vec2 {
  return [(rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2]
}

export function dist(a: Vec2, b: Vec2) {
  const dx = a[0] - b[0]
  const dz = a[1] - b[1]
  return Math.sqrt(dx * dx + dz * dz)
}

/** A random standing spot in an area, kept away from the walls and anything in the way. */
export function randomSpot(rng: Rng, areaId: string, pad = 1.2): Vec2 {
  const r = area(areaId).rect
  for (let tries = 0; tries < 20; tries++) {
    const p: Vec2 = [rng.range(r[0] + pad, r[2] - pad), rng.range(r[1] + pad, r[3] - pad)]
    if (!OBSTACLES.some((o) => dist(p, o.at) < o.radius + OBSTACLE_MARGIN + 0.4)) return p
  }
  return centre(r)
}

// ---------- Derived: doors and walls ----------

/** Doors are where a hallway's short end lies on a room's edge. */
function findDoors(): Door[] {
  const doors: Door[] = []
  for (const h of HALLWAYS) {
    const [x0, z0, x1, z1] = h.rect
    const across = x1 - x0 > z1 - z0 // runs left-right, so its doors are its left and right ends
    for (const roomId of h.hallway!) {
      const r = area(roomId).rect
      let at: Vec2
      if (across) {
        const x = Math.abs(x0 - r[2]) < 1e-6 ? x0 : x1
        at = [x, (z0 + z1) / 2]
      } else {
        const z = Math.abs(z0 - r[3]) < 1e-6 ? z0 : z1
        at = [(x0 + x1) / 2, z]
      }
      doors.push({
        id: `${h.id}@${roomId}`,
        areas: [roomId, h.id],
        at,
        along: across ? [0, 1] : [1, 0],
        half: across ? (z1 - z0) / 2 : (x1 - x0) / 2,
      })
    }
  }
  return doors
}

export const DOORS: Door[] = findDoors()

/** One straight wall: [x0, z0, x1, z1]. */
export type Wall = [number, number, number, number]

/** Room outlines with the doorways cut out, plus both long sides of every hallway. */
function findWalls(): Wall[] {
  const walls: Wall[] = []
  const edge = (a: Vec2, b: Vec2, gaps: [number, number][]) => {
    // Walk along the edge from a to b by distance, leaving out each gap.
    const length = dist(a, b)
    const dir: Vec2 = [(b[0] - a[0]) / length, (b[1] - a[1]) / length]
    let start = 0
    for (const [g0, g1] of gaps.sort((p, q) => p[0] - q[0])) {
      if (g0 > start) walls.push([a[0] + dir[0] * start, a[1] + dir[1] * start, a[0] + dir[0] * g0, a[1] + dir[1] * g0])
      start = Math.max(start, g1)
    }
    if (start < length) walls.push([a[0] + dir[0] * start, a[1] + dir[1] * start, b[0], b[1]])
  }
  for (const room of ROOMS) {
    const [x0, z0, x1, z1] = room.rect
    const corners: Vec2[] = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]
    for (let i = 0; i < 4; i++) {
      const a = corners[i]
      const b = corners[(i + 1) % 4]
      const gaps: [number, number][] = []
      for (const door of DOORS) {
        if (door.areas[0] !== room.id) continue
        // On this edge if it lies on the edge's line.
        const onLine = a[0] === b[0] ? Math.abs(door.at[0] - a[0]) < 1e-6 : Math.abs(door.at[1] - a[1]) < 1e-6
        if (!onLine) continue
        const t = dist(a, door.at)
        gaps.push([t - door.half, t + door.half])
      }
      edge(a, b, gaps)
    }
  }
  for (const h of HALLWAYS) {
    const [x0, z0, x1, z1] = h.rect
    if (x1 - x0 > z1 - z0) {
      walls.push([x0, z0, x1, z0], [x0, z1, x1, z1])
    } else {
      walls.push([x0, z0, x0, z1], [x1, z0, x1, z1])
    }
  }
  return walls
}

export const WALLS: Wall[] = findWalls()

/** The whole play area, for cameras and the minimap. */
export const BOUNDS: Rect = [-30, -20, 30, 20]

export function station(id: string): Station {
  return STATIONS.find((s) => s.id === id)!
}

export function vent(id: string): Vent {
  return VENTS.find((v) => v.id === id)!
}
