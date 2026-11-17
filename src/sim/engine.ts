import { round } from './log'
import { AREAS, dist, OBSTACLE_MARGIN, OBSTACLES, randomSpot, ROOMS, SEAT_RING, STATIONS } from './map'
import { findPath } from './nav'
import type { SimEvent } from './log'
import { makeRng } from './rng'
import type { Rng } from './rng'
import { makeRoster } from './roster'
import { DEFAULT_RULES } from './rules'
import type { FruitDef, Phase, Role, Rules, Vec2 } from './types'

export const TICKS_PER_SECOND = 10
/** One sim step, in sim seconds. */
export const TICK = 1 / TICKS_PER_SECOND
/** How far a fruit walks in one sim second. */
export const WALK_SPEED = 2.6
/** Ticks between position frames in the log: twice per sim second. */
const POSITION_EVERY = TICKS_PER_SECOND / 2
const IDLE_MIN = 1
const IDLE_MAX = 4

/** A fruit in a running game. The sim owns where it is; the 3D fruit only follows. */
export interface SimFruit {
  id: string
  def: FruitDef
  role: Role
  alive: boolean
  /** Logical position, advanced every tick. */
  pos: Vec2
  /** Movement over the last tick, in units per sim second. The renderer uses it to lead the fruit. */
  vel: Vec2
  /** Points still to walk through, in order. */
  path: Vec2[]
  /** Which side of a doorway this fruit walks on, -1 to 1, so groups spread out. */
  lane: number
  /** Standing still until this sim time before picking somewhere new. */
  idleUntil: number
}

export interface Game {
  seed: number
  rules: Rules
  phase: Phase
  /** Sim seconds since the start. */
  time: number
  tick: number
  fruits: SimFruit[]
  rng: Rng
  log: SimEvent[]
}

export interface GameSetup {
  seed: number
  /** Left out: a random roster is drawn from the seed. */
  roster?: FruitDef[]
  rules?: Partial<Rules>
}

export function createGame({ seed, roster, rules }: GameSetup): Game {
  const fullRules = { ...DEFAULT_RULES, ...rules }
  // Separate streams, so editing the roster never changes the game's own draws.
  const base = makeRng(seed)
  const rosterRng = base.fork('roster')
  const rng = base.fork('game')
  const defs = roster ?? makeRoster(rosterRng, fullRules.fruits)
  const rotten = new Set(rng.shuffle(defs.map((d) => d.id)).slice(0, fullRules.rotten))

  const fruits: SimFruit[] = defs.map((def, i) => {
    return {
      id: def.id,
      def,
      role: rotten.has(def.id) ? 'rotten' : 'crew',
      alive: true,
      pos: seatPos(i, defs.length),
      vel: [0, 0],
      path: [],
      lane: rng.range(-1, 1),
      idleUntil: rng.range(0, IDLE_MAX),
    }
  })

  const game: Game = { seed, rules: fullRules, phase: 'roam', time: 0, tick: 0, fruits, rng, log: [] }
  game.log.push({
    t: 0,
    kind: 'start',
    seed,
    roster: fruits.map((f) => ({ id: f.id, name: f.def.name, kind: f.def.kind, role: f.role })),
  })
  logPositions(game)
  return game
}

/** Advance the game by one tick. */
export function step(game: Game) {
  if (game.phase === 'over') return
  for (const fruit of game.fruits) {
    if (!fruit.alive) continue
    if (!fruit.path.length && game.time >= fruit.idleUntil) fruit.path = findPath(fruit.pos, somewhere(game.rng), fruit.lane)
    walk(game, fruit)
  }
  game.tick++
  game.time = game.tick * TICK
  if (game.tick % POSITION_EVERY === 0) logPositions(game)
}

/** Run ticks until `seconds` of sim time have passed. */
export function runFor(game: Game, seconds: number) {
  const end = game.tick + Math.round(seconds * TICKS_PER_SECOND)
  while (game.tick < end && game.phase !== 'over') step(game)
}

/** Move a fruit along its path by one tick's worth of walking. */
function walk(game: Game, fruit: SimFruit) {
  const [startX, startZ] = fruit.pos
  let left = WALK_SPEED * TICK
  while (left > 0 && fruit.path.length) {
    const [tx, tz] = fruit.path[0]
    const dx = tx - fruit.pos[0]
    const dz = tz - fruit.pos[1]
    // Math.sqrt rather than Math.hypot: hypot's rounding is not pinned down by the spec.
    const d = Math.sqrt(dx * dx + dz * dz)
    if (d <= left) {
      fruit.pos = [tx, tz]
      fruit.path.shift()
      left -= d
      if (!fruit.path.length) {
        fruit.idleUntil = game.time + game.rng.range(IDLE_MIN, IDLE_MAX)
        game.log.push({ t: round(game.time), kind: 'arrive', who: fruit.id, at: [round(tx), round(tz)] })
      }
    } else {
      fruit.pos = avoidObstacles(fruit.pos, [fruit.pos[0] + (dx / d) * left, fruit.pos[1] + (dz / d) * left], fruit.lane)
      left = 0
    }
  }
  fruit.vel = [(fruit.pos[0] - startX) / TICK, (fruit.pos[1] - startZ) / TICK]
}

/** Milestone 2 wandering: half the time a task station, otherwise a random spot in a random room. */
function somewhere(rng: Rng): Vec2 {
  return rng.chance(0.5) ? rng.pick(STATIONS).at : randomSpot(rng, rng.pick(ROOMS).id)
}

/** Seat i of n round the meeting table. */
export function seatPos(i: number, n: number): Vec2 {
  const angle = (i / n) * Math.PI * 2 - Math.PI / 2
  return [Math.cos(angle) * SEAT_RING, Math.sin(angle) * SEAT_RING]
}

/**
 * A step that would end inside an obstacle slides round its edge instead, always the same way
 * for the same fruit, so a fruit walking straight at the table goes round it rather than stopping.
 */
export function avoidObstacles(from: Vec2, to: Vec2, lane: number): Vec2 {
  for (const o of OBSTACLES) {
    const keep = o.radius + OBSTACLE_MARGIN
    if (dist(to, o.at) >= keep) continue
    const rx = from[0] - o.at[0]
    const rz = from[1] - o.at[1]
    const r = Math.sqrt(rx * rx + rz * rz) || 1
    const step = dist(from, to)
    // Tangent direction, picked by which side the step was heading, or the lane when dead on.
    const side = Math.sign(rx * (to[1] - from[1]) - rz * (to[0] - from[0])) || (lane >= 0 ? 1 : -1)
    const tx = (-rz / r) * side
    const tz = (rx / r) * side
    // Stepping along the tangent from outside the rim always ends further out, so no
    // correction is needed; only a fruit that somehow started inside is pushed back out.
    const nx = from[0] + tx * step - o.at[0]
    const nz = from[1] + tz * step - o.at[1]
    const n = Math.sqrt(nx * nx + nz * nz) || 1
    if (n >= keep) return [o.at[0] + nx, o.at[1] + nz]
    return [o.at[0] + (nx / n) * keep, o.at[1] + (nz / n) * keep]
  }
  return to
}

/** Every area's id, for checks. */
export const AREA_IDS = AREAS.map((a) => a.id)

function logPositions(game: Game) {
  game.log.push({
    t: round(game.time),
    kind: 'positions',
    at: game.fruits.filter((f) => f.alive).map((f) => [f.id, round(f.pos[0]), round(f.pos[1])]),
  })
}
