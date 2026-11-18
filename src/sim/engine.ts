import { decide, resolveActions, walk } from './actions'
import { makeBrain } from './brains'
import type { LlmOptions } from './brains/llm'
import type { Brain, BrainKind, ChatContext, Claim, RoamAction } from './brains/types'
import type { FruitView } from './view'
import { BUTTON_COOLDOWN, MAX_GAME_TIME, TICK, TICKS_PER_SECOND } from './constants'
import { encounters } from './encounters'
import { round } from './log'
import type { SimEvent } from './log'
import { areaAt, SEAT_RING, STATIONS } from './map'
import type { TaskLength } from './map'
import type { Sighting } from './memory'
import { startMind } from './mind'
import type { Mind } from './mind'
import { emptyVision, updateVision } from './perception'
import type { Vision } from './perception'
import { makeRng } from './rng'
import type { Rng } from './rng'
import { makeRoster } from './roster'
import { DEFAULT_RULES } from './rules'
import type { FruitDef, Phase, Role, Rules, Vec2, Winner } from './types'
import { observe } from './witness'

export { TICK, TICKS_PER_SECOND, WALK_SPEED } from './constants'

/** Ticks between position frames in the log: twice per sim second. */
const POSITION_EVERY = TICKS_PER_SECOND / 2

export interface TaskState {
  station: string
  length: TaskLength
  duration: number
  progress: number
  done: boolean
}

export interface Body {
  /** The victim's id. */
  id: string
  pos: Vec2
  area: string
  time: number
  killer: string
}

/** Where a fruit was, and when. Its own history, which it remembers exactly. */
export interface TrailStop {
  area: string
  from: number
  to: number
}

/** A fruit in a running game. The sim owns where it is; the 3D fruit only follows. */
export interface SimFruit {
  id: string
  def: FruitDef
  role: Role
  alive: boolean
  pos: Vec2
  /** The area it is standing in, refreshed every tick. */
  area: string
  /** Movement over the last tick, in units per sim second. The renderer uses it to lead the fruit. */
  vel: Vec2
  /** Points still to walk through, in order. */
  path: Vec2[]
  /** Where the current path ends, so a fresh path is only planned when that changes. */
  goal: Vec2 | null
  /** Which side of a doorway this fruit walks on, -1 to 1, so groups spread out. */
  lane: number
  action: RoamAction
  /** When the brain is next asked what to do. */
  decideAt: number
  /** Crew: real tasks. Rotten: a fake list to stand at. */
  tasks: TaskState[]
  /** The station it is working at (or pretending to) right now, and since when. */
  working: string | null
  workSince: number
  /** When it started fixing the lights, if it is. */
  fixSince: number | null
  memory: Sighting[]
  mind: Mind
  /** Rotten: when the knife is ready again. */
  killReadyAt: number
  emergencies: number
  trail: TrailStop[]
  /** Every claim it has made out loud, so a careful Rotten can keep its story straight. */
  ledger: { t: number; claim: Claim }[]
  /** Stopped to talk until this time. */
  busyUntil: number
  /** Who it is talking to right now. */
  talkingTo: string | null
  /** Bodies it has found. */
  seenBodies: string[]
  diedAt: number | null
  /** Walking faster than usual until this time (hurrying past someone it fears). */
  hurryUntil: number
  /** Rotten: who it killed, when and where. Its own secret. */
  kills: { victim: string; time: number; area: string }[]
  /** Its own random stream, for memory bending and noticing. */
  rng: Rng
}

/** Things everyone knows: what was said and decided in meetings, and who has died. */
export type PublicEvent =
  | { t: number; kind: 'meeting'; reason: 'body' | 'emergency'; caller: string; victim?: string; room?: string }
  | { t: number; kind: 'line'; who: string; move: string; target?: string; claim?: Claim; say: string }
  | { t: number; kind: 'vote'; voter: string; target: string }
  | { t: number; kind: 'eject'; who: string; role?: Role }
  | { t: number; kind: 'noEject'; tie: boolean }
  | { t: number; kind: 'dead'; who: string }

export interface MeetingState {
  reason: 'body' | 'emergency'
  caller: string
  body?: Body
  /** Sim time the meeting was called. Roam time stands still until it ends. */
  at: number
}

/** Running totals for the benchmarks. */
export interface GameStats {
  kills: number
  witnessedKills: number
  meetings: number
  ejections: { who: string; role: Role; byBentMemory: boolean }[]
  skips: number
  vents: number
  sabotages: number
  bentMemories: number
  contradictions: number
  chats: number
  rumours: number
  /** Meeting lines a brain got wrong that had to be repaired. */
  repairedLines: number
}

export interface Game {
  seed: number
  rules: Rules
  phase: Phase
  /** Sim seconds since the start. Stands still during meetings. */
  time: number
  tick: number
  fruits: SimFruit[]
  /** The game's own random stream. Brains and memories have their own forks. */
  rng: Rng
  log: SimEvent[]
  brains: Map<string, Brain>
  bodies: Body[]
  vision: Vision
  lightsOut: boolean
  sabotageReadyAt: number
  buttonReadyAt: number
  meeting: MeetingState | null
  public: PublicEvent[]
  /** Fruits everyone knows are dead. */
  publicDead: Set<string>
  winner: Winner | 'draw' | null
  /** How the game ended: tasks, ejection, kills or timeout. */
  how: string | null
  stats: GameStats
  /** Per-pair cooldowns for chats in passing, and other encounter bookkeeping. */
  encounterAt: Map<string, number>
  nextId: number
  /** Called for every event as it is logged (the screen listens here). */
  onEvent?: (e: SimEvent) => void
  /** Called when a fruit says a roaming line, so an LLM brain can reword it for the screen. */
  onChat?: (who: string, ctx: ChatContext, view: FruitView) => void
}

export interface GameSetup {
  seed: number
  /** Left out: a random roster is drawn from the seed. */
  roster?: FruitDef[]
  rules?: Partial<Rules>
  /** Brain for each side. Defaults to heuristic. */
  brains?: { crew?: BrainKind; rotten?: BrainKind }
  llm?: LlmOptions
}

/** Seat i of n round the meeting table. */
export function seatPos(i: number, n: number): Vec2 {
  const angle = (i / n) * Math.PI * 2 - Math.PI / 2
  return [Math.cos(angle) * SEAT_RING, Math.sin(angle) * SEAT_RING]
}

/** A fruit's private list of stations: the right number of short and long ones, all different. */
function dealTasks(rng: Rng, rules: Rules): TaskState[] {
  const pick = (length: TaskLength, n: number) =>
    rng
      .shuffle(STATIONS.filter((s) => s.length === length))
      .slice(0, n)
      .map((s) => ({
        station: s.id,
        length,
        duration: length === 'short' ? rules.shortTaskTime : rules.longTaskTime,
        progress: 0,
        done: false,
      }))
  return rng.shuffle([...pick('short', rules.shortTasks), ...pick('long', rules.longTasks)])
}

export function createGame({ seed, roster, rules, brains, llm }: GameSetup): Game {
  const fullRules = { ...DEFAULT_RULES, ...rules }
  // Separate streams, so editing the roster never changes the game's own draws.
  const base = makeRng(seed)
  const rosterRng = base.fork('roster')
  const rng = base.fork('game')
  const defs = roster ?? makeRoster(rosterRng, fullRules.fruits)
  const rotten = new Set(rng.shuffle(defs.map((d) => d.id)).slice(0, fullRules.rotten))

  const fruits: SimFruit[] = defs.map((def, i) => {
    const pos = seatPos(i, defs.length)
    return {
      id: def.id,
      def,
      role: rotten.has(def.id) ? 'rotten' : 'crew',
      alive: true,
      pos,
      area: areaAt(pos),
      vel: [0, 0],
      path: [],
      goal: null,
      lane: rng.range(-1, 1),
      action: { kind: 'idle' },
      // Staggered, so the fruits don't all decide on the same tick.
      decideAt: (i % TICKS_PER_SECOND) * TICK,
      tasks: dealTasks(rng, fullRules),
      working: null,
      workSince: 0,
      fixSince: null,
      memory: [],
      mind: startMind(rng, defs.filter((d) => d.id !== def.id).map((d) => d.id)),
      killReadyAt: fullRules.killCooldown,
      emergencies: fullRules.emergencyMeetings,
      trail: [{ area: areaAt(pos), from: 0, to: 0 }],
      ledger: [],
      busyUntil: 0,
      talkingTo: null,
      seenBodies: [],
      diedAt: null,
      hurryUntil: 0,
      kills: [],
      rng: base.fork(`fruit:${def.id}`),
    }
  })

  const game: Game = {
    seed,
    rules: fullRules,
    phase: 'roam',
    time: 0,
    tick: 0,
    fruits,
    rng,
    log: [],
    brains: new Map(),
    bodies: [],
    vision: emptyVision(),
    lightsOut: false,
    sabotageReadyAt: 20,
    buttonReadyAt: BUTTON_COOLDOWN,
    meeting: null,
    public: [],
    publicDead: new Set(),
    winner: null,
    how: null,
    stats: { kills: 0, witnessedKills: 0, meetings: 0, ejections: [], skips: 0, vents: 0, sabotages: 0, bentMemories: 0, contradictions: 0, chats: 0, rumours: 0, repairedLines: 0 },
    encounterAt: new Map(),
    nextId: 1,
  }
  for (const f of fruits) {
    const kind = f.role === 'rotten' ? (brains?.rotten ?? 'heuristic') : (brains?.crew ?? 'heuristic')
    game.brains.set(f.id, makeBrain(kind, f.id, base.fork(`brain:${f.id}`), llm))
  }
  logEvent(game, {
    t: 0,
    kind: 'start',
    seed,
    roster: fruits.map((f) => ({ id: f.id, name: f.def.name, kind: f.def.kind, role: f.role })),
  })
  logPositions(game)
  return game
}

export function logEvent(game: Game, e: SimEvent) {
  game.log.push(e)
  game.onEvent?.(e)
}

export function fruitById(game: Game, id: string): SimFruit | undefined {
  return game.fruits.find((f) => f.id === id)
}

export function nameOf(game: Game, id: string): string {
  return fruitById(game, id)?.def.name ?? id
}

/**
 * Crew tasks done and in total. A dead fruit's tasks stay on the bar: with ghost tasks on its
 * ghost can still finish them; with them off they stay undone, so the crew must win by votes.
 */
export function taskBar(game: Game): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const f of game.fruits) {
    if (f.role !== 'crew') continue
    for (const t of f.tasks) {
      total++
      if (t.done) done++
    }
  }
  return { done, total }
}

/** Advance the game by one roam tick, in the order the plan sets out. */
export function step(game: Game) {
  if (game.phase !== 'roam') return
  // 1-2. Move everyone (work at stations is advanced in step 6, with the other actions).
  for (const f of game.fruits) {
    if (game.time < f.busyUntil) {
      f.vel = [0, 0]
      continue
    }
    walk(game, f)
    const area = areaAt(f.pos)
    if (area !== f.area) {
      f.trail.push({ area, from: game.time, to: game.time })
      if (f.trail.length > 200) f.trail.shift()
    }
    f.area = area
    f.trail[f.trail.length - 1].to = game.time
  }
  // 3. Perception, turned into memories.
  updateVision(game)
  observe(game)
  // 4. Hallway passes and task-side chats.
  encounters(game)
  // 5. Roam decisions, at most once per sim second per fruit. Dead crew keep doing tasks as ghosts.
  for (const f of game.fruits) {
    if (game.time >= f.decideAt && (f.alive || (f.role === 'crew' && game.rules.ghostTasks)) && game.phase === 'roam') decide(game, f)
  }
  // 6. Work, kills, reports, vents and sabotage.
  resolveActions(game)
  // 7. Win check.
  checkWin(game)
  game.tick++
  game.time = game.tick * TICK
  if (game.time >= MAX_GAME_TIME && !game.winner) endGame(game, 'draw', 'timeout')
  // 8. Positions for replays.
  if (game.tick % POSITION_EVERY === 0) logPositions(game)
}

/** Ends the game if a side has won. Returns true if it has. */
export function checkWin(game: Game): boolean {
  if (game.winner) return true
  const living = game.fruits.filter((f) => f.alive)
  const rotten = living.filter((f) => f.role === 'rotten').length
  const bar = taskBar(game)
  if (rotten === 0) endGame(game, 'crew', 'ejection')
  else if (bar.done >= bar.total) endGame(game, 'crew', 'tasks')
  else if (rotten * 2 >= living.length) endGame(game, 'rotten', 'kills')
  return !!game.winner
}

export function endGame(game: Game, winner: Winner | 'draw', how: string) {
  game.winner = winner
  game.how = how
  game.phase = 'over'
  logEvent(game, { t: round(game.time), kind: 'over', winner, how })
}

/** Run roam ticks until `seconds` of sim time have passed, the game ends or a meeting is called. */
export function runFor(game: Game, seconds: number) {
  const end = game.tick + Math.round(seconds * TICKS_PER_SECOND)
  while (game.tick < end && game.phase === 'roam') step(game)
}

function logPositions(game: Game) {
  logEvent(game, {
    t: round(game.time),
    kind: 'positions',
    at: game.fruits.filter((f) => f.alive).map((f) => [f.id, round(f.pos[0]), round(f.pos[1])]),
  })
}

/** A new id for a memory or anything else that needs one. */
export function newId(game: Game): number {
  return game.nextId++
}
