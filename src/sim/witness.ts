import { fruitById, logEvent, newId } from './engine'
import type { Game, SimFruit } from './engine'
import { round } from './log'
import { area, areaAt, dist, neighbours, station } from './map'
import { confidence, halfLifeFor, lookalikeKind, maybeBend } from './memory'
import type { Sighting } from './memory'
import { feel } from './mind'
import { sees } from './perception'

/**
 * Turning sight into memory. A sighting is not stored every tick: one is stored when something
 * changes, and the current one is stretched while it doesn't.
 */

/** A watcher must keep its eyes on a worker this long to notice what it is doing. */
const WATCH_TO_NOTICE = 2
/** Standing at a station this much longer than the task takes looks fishy. */
const FAKE_OVERSTAY = 3
/** Within this of a body counts as near it. */
const NEAR_BODY = 4
/** Seen leaving a room this recently before a body turns up there counts as near it too. */
const LOOK_BACK = 6
/** Two walkers this close, heading opposite ways, have passed each other. */
const PASS_DISTANCE = 2
const PASS_COOLDOWN = 10
/** Memories below this confidence are forgotten (except the certain kinds). */
const FORGET_BELOW = 0.04
const MAX_MEMORIES = 260
/** Fading memories are checked for bending this often per fruit. */
const MAINTAIN_EVERY = 5

/** How sure a fruit is of a fresh memory of this kind. Sharper fruits notice better. */
function startConfidence(kind: Sighting['kind'], sharpness: number): number {
  switch (kind) {
    case 'kill':
    case 'vented':
      return 1
    case 'nearBody':
      return 0.8 + sharpness * 0.15
    case 'atTask':
      return 0.8 + sharpness * 0.15
    case 'fakeTask':
      return 0.7 + sharpness * 0.25
    case 'passed':
      return 0.6 + sharpness * 0.25
    default:
      return 0.75 + sharpness * 0.2
  }
}

type NewSighting = Partial<Sighting> & Pick<Sighting, 'kind' | 'who' | 'room'>

/** Store a new memory for `f`. Times default to now. */
export function addSighting(game: Game, f: SimFruit, s: NewSighting): Sighting {
  const sharp = f.def.traits.sharpness
  const full: Sighting = {
    id: newId(game),
    from: game.time,
    to: game.time,
    confidence: startConfidence(s.kind, sharp),
    halfLife: halfLifeFor(s.kind, sharp),
    ...s,
  }
  f.memory.push(full)
  if (s.kind === 'kill' || s.kind === 'vented') logEvent(game, { t: round(game.time), kind: 'witness', who: f.id, saw: s.kind, about: s.who })
  if (f.memory.length > MAX_MEMORIES) {
    // Make room by dropping the faintest everyday sighting.
    let worst = -1
    let worstC = Infinity
    f.memory.forEach((m, i) => {
      if (m.kind !== 'seen' && m.kind !== 'passed') return
      const c = confidence(m, game.time)
      if (c < worstC) {
        worstC = c
        worst = i
      }
    })
    if (worst >= 0) f.memory.splice(worst, 1)
  }
  return full
}

/** Per watcher: the `seen` sighting being stretched for each fruit in view. */
const openSeen = new WeakMap<Game, Map<string, Sighting>>()
/** When each watcher started watching each worker at its station, for noticing. */
const watching = new WeakMap<Game, Map<string, { since: number; noted: boolean; fake: boolean }>>()

/** Called once per tick, after vision: everything each living fruit sees becomes memory. */
export function observe(game: Game) {
  let open = openSeen.get(game)
  if (!open) openSeen.set(game, (open = new Map()))
  let watch = watching.get(game)
  if (!watch) watching.set(game, (watch = new Map()))
  const stillWatching = new Set<string>()

  for (const a of game.fruits) {
    if (!a.alive) continue
    const inView = game.vision.sees.get(a.id) ?? new Set<string>()
    for (const bId of inView) {
      const b = fruitById(game, bId)!
      // Seen: one memory per stretch of time the other fruit stays in view in the same place.
      const key = `${a.id}|${bId}`
      const current = open.get(key)
      if (current && current.room === b.area && current.to >= game.time - 0.15) current.to = game.time
      else open.set(key, addSighting(game, a, { kind: 'seen', who: bId, room: b.area }))

      // Working at a station: a real visual task proves crew; standing too long looks fake.
      if (b.working) {
        const wkey = `${key}|${b.working}|${b.workSince}`
        stillWatching.add(wkey)
        let w = watch.get(wkey)
        if (!w) watch.set(wkey, (w = { since: game.time, noted: false, fake: false }))
        const st = station(b.working)
        const watched = game.time - w.since
        if (!w.noted && watched >= WATCH_TO_NOTICE) {
          w.noted = true
          const proof = st.visual && b.role === 'crew'
          addSighting(game, a, { kind: 'atTask', who: bId, room: b.area, station: st.id, sawEffect: proof, from: w.since })
          if (proof && !a.mind.cleared.includes(bId)) a.mind.cleared.push(bId)
        }
        const duration = st.length === 'short' ? game.rules.shortTaskTime : game.rules.longTaskTime
        // A visual station with no effect gives a faker away quickly; otherwise it is overstaying.
        const suspicious = (st.visual && b.role === 'rotten' && watched >= WATCH_TO_NOTICE + 1) || watched >= duration + FAKE_OVERSTAY
        if (!w.fake && suspicious) {
          w.fake = true
          if (a.rng.chance(0.35 + a.def.traits.sharpness * 0.55)) addSighting(game, a, { kind: 'fakeTask', who: bId, room: b.area, station: st.id, from: w.since })
        }
      }

      // Passing in a hallway, heading opposite ways.
      if (a.id < bId && dist(a.pos, b.pos) < PASS_DISTANCE && a.path.length && b.path.length && a.vel[0] * b.vel[0] + a.vel[1] * b.vel[1] < 0 && sees(game, bId, a.id)) {
        const pkey = `pass|${a.id}|${bId}`
        if ((game.encounterAt.get(pkey) ?? -Infinity) + PASS_COOLDOWN <= game.time) {
          game.encounterAt.set(pkey, game.time)
          addSighting(game, a, { kind: 'passed', who: bId, room: a.area, heading: b.goal ? areaAt(b.goal) : b.area })
          addSighting(game, b, { kind: 'passed', who: a.id, room: b.area, heading: a.goal ? areaAt(a.goal) : a.area })
        }
      }
    }

    // Bodies: the first sight of one is a shock, and anyone near it is remembered.
    for (const bodyId of game.vision.bodies.get(a.id) ?? []) {
      const body = game.bodies.find((x) => x.id === bodyId)!
      const first = !a.seenBodies.includes(bodyId)
      if (first) {
        a.seenBodies.push(bodyId)
        feel(a.mind, 'fear', 0.35 + (1 - a.def.traits.aggression) * 0.2)
        if (a.mind.goal.kind === 'protect' && a.mind.goal.target === bodyId) feel(a.mind, 'grief', 0.7)
        else feel(a.mind, 'grief', 0.2)
        a.decideAt = game.time
        logEvent(game, { t: round(game.time), kind: 'witness', who: a.id, saw: 'body', about: bodyId })
        // Who was in that room shortly before? They were near the body, as far as a's memory goes.
        const recent = new Set(
          a.memory
            // Seen there shortly before, and gone since: it left the room the body is in.
            .filter((m) => m.kind === 'seen' && m.room === body.area && m.to >= game.time - LOOK_BACK && m.to < game.time - 1 && m.who !== bodyId && !inView.has(m.who))
            .map((m) => m.who),
        )
        for (const who of recent) {
          addSighting(game, a, { kind: 'nearBody', who, room: body.area, victim: bodyId, confidence: 0.55 + a.def.traits.sharpness * 0.2 })
        }
      }
      for (const bId of inView) {
        const b = fruitById(game, bId)!
        if (dist(b.pos, body.pos) > NEAR_BODY) continue
        if (a.memory.some((m) => m.kind === 'nearBody' && m.who === bId && m.victim === bodyId)) continue
        addSighting(game, a, { kind: 'nearBody', who: bId, room: body.area, victim: bodyId })
      }
    }
  }

  // Close anything no longer being watched.
  for (const key of watch.keys()) if (!stillWatching.has(key)) watch.delete(key)
}

/** The areas next to this one: a room's neighbours, or a hallway's two rooms. */
export function nextDoor(areaId: string): string[] {
  const a = area(areaId)
  return a.hallway ? [...a.hallway] : neighbours(areaId)
}

/** The fruit in this game that looks most like `who`, if any. */
function lookalike(game: Game, who: string): string | undefined {
  const f = fruitById(game, who)
  const kind = f && lookalikeKind(f.def.kind)
  return kind ? game.fruits.find((o) => o.def.kind === kind && o.id !== who)?.id : undefined
}

const lastMaintained = new WeakMap<SimFruit, number>()

/**
 * Fading memories: the first time one drops below half confidence, it may bend (dull fruits
 * bend more), and the faintest are forgotten. Runs every few seconds per fruit.
 */
export function maintainMemory(game: Game, f: SimFruit) {
  if (game.time - (lastMaintained.get(f) ?? -Infinity) < MAINTAIN_EVERY) return
  lastMaintained.set(f, game.time)
  const bendChance = 0.45 - f.def.traits.sharpness * 0.3
  const options = { neighbours: nextDoor, lookalike: (who: string) => lookalike(game, who) }
  f.memory = f.memory.filter((m) => {
    if (maybeBend(m, game.time, f.rng, bendChance, options)) {
      game.stats.bentMemories++
      logEvent(game, { t: round(game.time), kind: 'witness', who: f.id, saw: m.kind, about: m.who, bent: true })
    }
    return m.kind === 'kill' || m.kind === 'vented' || confidence(m, game.time) >= FORGET_BELOW
  })
}
