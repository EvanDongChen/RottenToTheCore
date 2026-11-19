import { crossesWall } from './geom'
import { CAMERAS, dist, doorsOf, doorWall, MONITORS, WALLS } from './map'
import type { Wall } from './map'
import type { Game, SimFruit } from './engine'
import type { Vec2 } from './types'

/**
 * Who can see whom, worked out once per tick. A fruit sees another (or a body) when it is within
 * its vision radius and the straight line between them crosses no wall. Rooms and hallways are
 * convex, so two fruits in the same area always have a clear line, and only pairs in different
 * areas are tested against the walls. A fruit sitting at the Security monitors also sees what
 * the cameras see.
 */

/** Sitting this close to the monitors, and standing still, means watching the cameras. */
const MONITOR_REACH = 1.2

export interface Vision {
  /** For each fruit that can see: the living fruits it sees right now. */
  sees: Map<string, Set<string>>
  /** For each fruit: the bodies (victim ids) it sees right now. */
  bodies: Map<string, string[]>
  /** Fruits watching the cameras this tick. */
  watching: Set<string>
}

export function emptyVision(): Vision {
  return { sees: new Map(), bodies: new Map(), watching: new Set() }
}

/** How far this fruit can see right now. */
export function visionRadius(game: Game, f: SimFruit): number {
  if (f.role === 'rotten') return game.rules.rottenVision
  return game.lightsOut ? game.rules.lightsOutVision : game.rules.crewVision
}

/** True when nothing blocks the straight line from a to b. `extra` adds walls (closed doors). */
export function clearLine(a: Vec2, aArea: string, b: Vec2, bArea: string, extra?: readonly Wall[]): boolean {
  if (aArea === bArea) return true
  for (const w of WALLS) if (crossesWall(a, b, w)) return false
  if (extra) for (const w of extra) if (crossesWall(a, b, w)) return false
  return true
}

/** Can a camera see this point? */
function onCamera(p: Vec2, pArea: string): boolean {
  return CAMERAS.some((c) => dist(c.at, p) <= c.radius && clearLine(c.at, '', p, pArea))
}

/** Work out what everyone sees this tick. Only living fruits see or are seen; ghosts are invisible. */
export function updateVision(game: Game) {
  const vision = emptyVision()
  const shut = game.locked ? doorsOf(game.locked.room).map(doorWall) : undefined
  const living = game.fruits.filter((f) => f.alive)
  const radius = new Map(living.map((f) => [f.id, visionRadius(game, f)]))
  for (const f of living) vision.sees.set(f.id, new Set())

  for (let i = 0; i < living.length; i++) {
    const a = living[i]
    for (let j = i + 1; j < living.length; j++) {
      const b = living[j]
      const d = dist(a.pos, b.pos)
      const ra = radius.get(a.id)!
      const rb = radius.get(b.id)!
      if (d > Math.max(ra, rb)) continue
      // The line is the same both ways, so it is tested once per pair.
      if (!clearLine(a.pos, a.area, b.pos, b.area, shut)) continue
      if (d <= ra) vision.sees.get(a.id)!.add(b.id)
      if (d <= rb) vision.sees.get(b.id)!.add(a.id)
    }
  }

  for (const f of living) {
    const seen: string[] = []
    for (const body of game.bodies) {
      if (dist(f.pos, body.pos) <= radius.get(f.id)! && clearLine(f.pos, f.area, body.pos, body.area, shut)) seen.push(body.id)
    }
    vision.bodies.set(f.id, seen)
  }

  // Security: whoever sits at the monitors also sees through the cameras.
  for (const f of living) {
    if (dist(f.pos, MONITORS) > MONITOR_REACH || f.path.length) continue
    vision.watching.add(f.id)
    const sees = vision.sees.get(f.id)!
    for (const o of living) if (o !== f && onCamera(o.pos, o.area)) sees.add(o.id)
    const bodies = vision.bodies.get(f.id)!
    for (const body of game.bodies) if (!bodies.includes(body.id) && onCamera(body.pos, body.area)) bodies.push(body.id)
  }

  game.vision = vision
}

/** Does `a` see `b` this tick? */
export function sees(game: Game, a: string, b: string): boolean {
  return game.vision.sees.get(a)?.has(b) ?? false
}
