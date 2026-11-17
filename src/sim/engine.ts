import { round } from './log'
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
const SPAWN_RING = 2.5
const IDLE_MIN = 1
const IDLE_MAX = 4

/** Milestone 1 stand-in for the lab: one empty room. The map replaces it in milestone 2. */
export const ROOM = { minX: -12, maxX: 12, minZ: -8, maxZ: 8 }

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
    const angle = (i / defs.length) * Math.PI * 2
    return {
      id: def.id,
      def,
      role: rotten.has(def.id) ? 'rotten' : 'crew',
      alive: true,
      pos: [Math.cos(angle) * SPAWN_RING, Math.sin(angle) * SPAWN_RING],
      vel: [0, 0],
      path: [],
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
    if (!fruit.path.length && game.time >= fruit.idleUntil) fruit.path = [randomSpot(game.rng)]
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
      fruit.pos = [fruit.pos[0] + (dx / d) * left, fruit.pos[1] + (dz / d) * left]
      left = 0
    }
  }
  fruit.vel = [(fruit.pos[0] - startX) / TICK, (fruit.pos[1] - startZ) / TICK]
}

function randomSpot(rng: Rng): Vec2 {
  return [rng.range(ROOM.minX + 1, ROOM.maxX - 1), rng.range(ROOM.minZ + 1, ROOM.maxZ - 1)]
}

function logPositions(game: Game) {
  game.log.push({
    t: round(game.time),
    kind: 'positions',
    at: game.fruits.filter((f) => f.alive).map((f) => [f.id, round(f.pos[0]), round(f.pos[1])]),
  })
}
