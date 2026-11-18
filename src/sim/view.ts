import type { Claim, RoamAction } from './brains/types'
import { taskBar } from './engine'
import type { Game, PublicEvent, SimFruit, TrailStop } from './engine'
import { roomAt } from './map'
import type { RoomId } from './map'
import { confidence, recall } from './memory'
import type { Sighting } from './memory'
import type { Goal } from './mind'
import type { FruitKind, Mood, Perk, Role, Rules, Traits, Vec2 } from './types'

/**
 * The only door to what a fruit may know. A brain is handed a `FruitView` and nothing else: its
 * own memory, mind and tasks, what it can see right now, and what everyone heard in meetings.
 * It never holds anyone else's role, except that a Rotten knows its partner.
 */

/** Another fruit as seen right now. */
export interface InSight {
  id: string
  pos: Vec2
  area: string
  moving: boolean
  /** The station it is standing at, if any (whether it is really working is not visible). */
  atStation: string | null
}

/** A memory as the fruit believes it right now: bent if bent, with today's confidence. */
export interface Memory extends Sighting {
  /** Confidence now, after fading. */
  now: number
}

/** Another fruit, as far as this one knows. No roles. */
export interface Acquaintance {
  id: string
  name: string
  kind: FruitKind
  /** False once this fruit knows it is dead (it saw the body, or a meeting made it public). */
  alive: boolean
}

export interface FruitView {
  id: string
  name: string
  role: Role
  /** For a Rotten, the other Rotten. Empty for crew. */
  partners: string[]
  traits: Traits
  alive: boolean
  time: number
  rules: Rules
  pos: Vec2
  area: string
  room: RoomId
  /** True while it is still walking somewhere. */
  moving: boolean
  action: RoamAction
  /** The station it is standing at, and since when. */
  working: string | null
  workSince: number
  tasks: { station: string; length: 'short' | 'long'; duration: number; progress: number; done: boolean }[]
  /** Rotten only: seconds until the knife is ready (0 when it is). */
  killReadyIn: number | null
  /** Rotten only: can it turn the lights off right now? */
  canSabotage: boolean | null
  /** Rotten only: its own kills. Empty for crew. */
  kills: { victim: string; time: number; area: string }[]
  /** Fruits it caught following it around. */
  tailedBy: string[]
  emergenciesLeft: number
  buttonReady: boolean
  lightsOut: boolean
  /** Seconds left before a meltdown, if one is going. */
  meltdownIn: number | null
  /** A room with its doors locked right now. */
  lockedRoom: string | null
  /** Its own special ability, if any. */
  perk: Perk | null
  /** Watching the Security cameras right now. */
  watchingCameras: boolean
  visible: InSight[]
  /** Bodies it can see right now. */
  bodies: { id: string; pos: Vec2; area: string }[]
  /** Bodies it has found so far, ever. */
  foundBodies: string[]
  others: Acquaintance[]
  memory: Memory[]
  trail: TrailStop[]
  ledger: { t: number; claim: Claim }[]
  mood: Mood
  goal: Goal
  caught: Record<string, number>
  cleared: string[]
  /** Everything said and decided in meetings so far, oldest first. */
  public: PublicEvent[]
  taskBar: { done: number; total: number }
  meetingsHeld: number
}

/** A memory as the fruit holds it: bending applied, and no marker saying it was bent. */
function remembered(m: Sighting, now: number): Memory {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { recalled, checked, ...rest } = recall(m)
  return { ...rest, now: confidence(m, now) }
}

export function viewFor(game: Game, f: SimFruit): FruitView {
  const rotten = f.role === 'rotten'
  // The Rotten know who they killed. Everyone knows about bodies they found and public deaths.
  // A scientist's vitals board shows every death the moment it happens.
  const vitals = f.perk === 'scientist' ? game.fruits.filter((o) => !o.alive).map((o) => o.id) : []
  const knownDead = new Set([...game.publicDead, ...f.seenBodies, ...vitals, ...(rotten ? game.bodies.filter((b) => b.killer === f.id).map((b) => b.id) : [])])
  const seen = game.vision.sees.get(f.id) ?? new Set<string>()
  const visible: InSight[] = []
  for (const o of game.fruits) {
    if (!seen.has(o.id)) continue
    visible.push({ id: o.id, pos: o.pos, area: o.area, moving: o.path.length > 0, atStation: o.working })
  }
  const bodyIds = game.vision.bodies.get(f.id) ?? []
  const view: Omit<FruitView, 'memory'> = {
    id: f.id,
    name: f.def.name,
    role: f.role,
    partners: rotten ? game.fruits.filter((o) => o.role === 'rotten' && o !== f).map((o) => o.id) : [],
    traits: f.def.traits,
    alive: f.alive,
    time: game.time,
    rules: game.rules,
    pos: f.pos,
    area: f.area,
    room: roomAt(f.pos),
    moving: f.path.length > 0,
    action: f.action,
    working: f.working,
    workSince: f.workSince,
    tasks: f.tasks.map((t) => ({ ...t })),
    killReadyIn: rotten ? Math.max(0, f.killReadyAt - game.time) : null,
    canSabotage: rotten ? !game.lightsOut && !game.meltdown && !game.locked && game.time >= game.sabotageReadyAt : null,
    kills: rotten ? f.kills.map((k) => ({ ...k })) : [],
    tailedBy: [...f.mind.tailedBy],
    emergenciesLeft: f.emergencies,
    buttonReady: game.time >= game.buttonReadyAt,
    lightsOut: game.lightsOut,
    meltdownIn: game.meltdown ? Math.max(0, game.meltdown.until - game.time) : null,
    lockedRoom: game.locked?.room ?? null,
    perk: f.perk,
    watchingCameras: game.vision.watching.has(f.id),
    visible,
    bodies: game.bodies.filter((b) => bodyIds.includes(b.id)).map((b) => ({ id: b.id, pos: b.pos, area: b.area })),
    foundBodies: [...f.seenBodies],
    others: game.fruits.filter((o) => o !== f).map((o) => ({ id: o.id, name: o.def.name, kind: o.def.kind, alive: !knownDead.has(o.id) })),
    trail: f.trail.map((t) => ({ ...t })),
    ledger: [...f.ledger],
    mood: { ...f.mind.mood },
    goal: f.mind.goal,
    caught: { ...f.mind.caught },
    cleared: [...f.mind.cleared],
    public: [...game.public],
    taskBar: taskBar(game),
    meetingsHeld: game.stats.meetings,
  }
  // The memory list is the expensive part, and many decisions never look at it: build it on first read.
  let memory: Memory[] | null = null
  const now = game.time
  return Object.defineProperty(view, 'memory', {
    enumerable: true,
    configurable: true,
    get: () => (memory ??= f.memory.map((m) => remembered(m, now))),
  }) as FruitView
}
