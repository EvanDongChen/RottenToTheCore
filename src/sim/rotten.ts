import type { Claim, RoamAction } from './brains/types'
import { area, dist, DOORS, neighbours, ROOMS, STATIONS, VENTS } from './map'
import type { Station } from './map'
import { clearLine } from './perception'
import type { Rng } from './rng'
import type { RottenStyle } from './types'
import type { FruitView, InSight } from './view'

/**
 * How a Rotten behaves while roaming: a small state machine, shared by every brain. Its
 * personality sets how bold it is. It plans only from what it can see and remember, never from
 * the true game state.
 *
 *   blend      fake tasks near others, chat, make alibi pacts      knife ready      -> stalk
 *   stalk      pick a target and follow at a distance               alone and safe   -> strike
 *                                                                   too many eyes    -> blend
 *   strike     kill (the engine closes the gap)                     always           -> escape
 *   escape     vent away, or walk off out of sight                  out of sight     -> alibi
 *   alibi      join a group or work next to someone                 knife ready      -> stalk
 *   selfReport report its own kill and lead the meeting             (from strike, when it was probably seen)
 *   sabotage   lights out before striking somewhere dark            lights are out   -> stalk
 */

export type RottenState = 'blend' | 'stalk' | 'strike' | 'escape' | 'alibi' | 'selfReport' | 'sabotage'

export interface RottenPlan {
  state: RottenState
  since: number
  target: string | null
  /** The station being faked, and until when. */
  faking: { station: string; until: number } | null
  /** Where it is escaping to. */
  escapeRoom: string | null
  /** How many kills it had last time it looked, to notice a fresh one. */
  killsSeen: number
  /** When it started feeling watched while stalking. */
  watchedSince: number | null
  /** When the knife last became ready, for growing bolder the longer it waits. */
  readySince: number | null
}

/**
 * How a particular Rotten plays, beyond its personality sliders. All optional: without them it
 * plays as its traits say.
 */
export interface RottenOptions {
  /** Extra wish to kill each fruit it can see (a thinking Rotten silences witnesses). */
  bias?: (o: InSight) => number
}

/** A Rotten's playstyle, set on the setup screen: how it goes about the killing. */
export function styleOf(view: FruitView): RottenStyle | undefined {
  return view.traits.style
}

export function newPlan(): RottenPlan {
  return { state: 'blend', since: 0, target: null, faking: null, escapeRoom: null, killsSeen: 0, watchedSince: null, readySince: null }
}

/** Rooms with only two ways in, where nobody passes through: the best places to strike. */
const QUIET_ROOMS = ['electrical', 'ripening', 'security', 'greenhouse']
/** Fruits it can see within this of a target don't leave it alone. */
const ALONE_RADIUS = 8
/** Stalking with too many eyes about for this long, it gives up for now. */
const STALK_PATIENCE = 14
const ALIBI_TIME = 14
/** Every this many seconds with the knife ready and no strike, it accepts more risk. */
const IMPATIENCE = 40
/** It only commits to a strike from this close. */
const STRIKE_FROM = 3.5

function isRoomId(id: string): boolean {
  return ROOMS.some((r) => r.id === id)
}

function stationRoom(id: string): string {
  return STATIONS.find((st) => st.id === id)?.room ?? ''
}

function go(plan: RottenPlan, state: RottenState, now: number) {
  plan.state = state
  plan.since = now
  if (state !== 'stalk' && state !== 'strike') plan.target = null
  plan.watchedSince = null
}

/** Crew vision as a Rotten imagines it: it knows the rules, and whether the lights are out. */
function crewVision(view: FruitView) {
  return view.lightsOut ? view.rules.lightsOutVision : view.rules.crewVision
}

/**
 * How risky a strike on `target` is right now: every fruit it can see that could see it or the
 * target, plus half a point for an open doorway close by (someone could walk in).
 */
export function strikeRisk(view: FruitView, target: InSight): number {
  const r = crewVision(view)
  let risk = 0
  for (const o of view.visible) {
    if (o.id === target.id || view.partners.includes(o.id)) continue
    const seesMe = dist(o.pos, view.pos) <= r && clearLine(o.pos, o.area, view.pos, view.area)
    const seesTarget = dist(o.pos, target.pos) <= r && clearLine(o.pos, o.area, target.pos, target.area)
    if (seesMe || seesTarget) risk++
  }
  const doorNear = DOORS.some((d) => d.areas.includes(target.area) && dist(d.at, target.pos) < 3.5)
  if (doorNear) risk += 0.5
  return risk
}

/** How much it wants to kill each fruit it can see. */
function targetScore(view: FruitView, o: InSight): number {
  let score = 1
  const crowd = view.visible.filter((x) => x.id !== o.id && !view.partners.includes(x.id) && dist(x.pos, o.pos) < ALONE_RADIUS).length
  if (crowd === 0) score += 3
  if (QUIET_ROOMS.includes(o.area)) score += 2
  // Has evidence on me: it accused me, or I heard it was talking about me.
  if (view.memory.some((m) => m.kind === 'heard' && m.who === view.id && m.source === o.id && m.told !== 'alibi' && m.told !== 'vouch')) score += 3
  if (view.public.some((e) => e.kind === 'line' && e.who === o.id && e.target === view.id && e.move !== 'vouch' && e.move !== 'corroborate')) score += 3
  // Saw me around one of my kills.
  if (view.kills.some((k) => view.memory.some((m) => m.kind === 'seen' && m.who === o.id && Math.abs(m.from - k.time) < 8))) score += 3
  // Trusted by many: its vouches carry weight.
  score += Math.min(2, view.public.filter((e) => e.kind === 'line' && e.target === o.id && (e.move === 'vouch' || e.move === 'corroborate')).length * 0.7)
  if (view.goal.kind === 'revenge' && view.goal.target === o.id) score += 2
  // Closer is easier.
  score -= dist(view.pos, o.pos) / 10
  return score
}

/**
 * A station to fake: near other fruits when blending, anywhere otherwise. A careful Rotten keeps
 * away from visual stations, where everyone can see that nothing happens.
 */
function fakeStation(view: FruitView, rng: Rng, nearOthers: boolean): Station {
  const careful = !isCareless(view)
  const pool = STATIONS.filter((s) => !(careful && s.visual))
  if (nearOthers && view.visible.length) {
    const crowded = view.visible.map((o) => o.area)
    const here = pool.filter((s) => crowded.includes(s.room))
    if (here.length) return rng.pick(here)
  }
  return rng.pick(pool)
}

function fake(view: FruitView, plan: RottenPlan, rng: Rng, nearOthers: boolean): RoamAction {
  if (!plan.faking || view.time >= plan.faking.until) {
    const st = fakeStation(view, rng, nearOthers)
    // Stay about as long as the real task would take, plus the walk there. Careless ones linger.
    const duration = st.length === 'short' ? view.rules.shortTaskTime : view.rules.longTaskTime
    const walk = dist(view.pos, st.at) / 2.6
    plan.faking = { station: st.id, until: view.time + walk + duration * rng.range(0.8, isCareless(view) ? 2.2 : 1.1) }
  }
  return { kind: 'fakeTask', station: plan.faking.station }
}

export function rottenRoam(view: FruitView, plan: RottenPlan, rng: Rng, opts: RottenOptions = {}): RoamAction {
  const t = view.traits
  const style = styleOf(view)
  const now = view.time
  const ready = view.killReadyIn === 0
  const crew = view.visible.filter((o) => !view.partners.includes(o.id))
  // A meltdown, now and then, when it is far from the Ripening Chamber itself. (Only with the rule.)
  if (view.canSabotage && view.rules.meltdown && view.area !== 'ripening' && rng.chance((style === 'saboteur' ? 0.06 : 0.02) + t.aggression * 0.03)) {
    return { kind: 'sabotage', what: 'meltdown' }
  }
  if (!ready) plan.readySince = null
  else plan.readySince ??= now

  // A fresh kill: decide how to get away with it.
  if (view.kills.length > plan.killsSeen) {
    plan.killsSeen = view.kills.length
    const watchers = crew.length
    // Probably seen nearby: report it itself and lead the meeting with a confident story. A framer
    // does it whenever it can, to point the finger first.
    const selfReport = style === 'framer' ? 0.8 : 0.25 + t.aggression * 0.4
    if ((watchers > 0 || style === 'framer') && rng.chance(selfReport)) go(plan, 'selfReport', now)
    else go(plan, 'escape', now)
  }

  switch (plan.state) {
    case 'selfReport': {
      const body = view.bodies[0]
      if (body) return { kind: 'report', body: body.id }
      go(plan, 'escape', now)
      break
    }
    case 'escape': {
      // Out of sight of the body and nobody watching: settle into an alibi.
      if (!view.bodies.length && crew.length === 0 && now - plan.since > 3) {
        go(plan, 'alibi', now)
        break
      }
      // A vent in this room, and nobody watching: the cleanest way out.
      const vent = VENTS.find((v) => v.room === view.area)
      if (vent && crew.length === 0 && rng.chance(0.75 + t.aggression * 0.25)) {
        go(plan, 'alibi', now)
        return { kind: 'vent', to: vent.to }
      }
      if (!plan.escapeRoom) {
        const away = nextRooms(view.area).filter((r) => !crew.some((o) => o.area === r))
        plan.escapeRoom = away.length ? rng.pick(away) : rng.pick(ROOMS).id
      }
      if (view.area === plan.escapeRoom && !view.moving) {
        plan.escapeRoom = null
        go(plan, 'alibi', now)
        break
      }
      return { kind: 'wander', room: plan.escapeRoom, hurry: true }
    }
  }
  if (plan.state !== 'escape') plan.escapeRoom = null

  // Two Rotten together: one strikes, the other stands with witnesses.
  const partnerHere = view.visible.find((o) => view.partners.includes(o.id))
  const cover = partnerHere && view.partners.some((p) => p < view.id)

  if (plan.state === 'alibi') {
    if (now - plan.since > ALIBI_TIME && ready) go(plan, 'stalk', now)
    else {
      // Stand with a group, or work next to someone, so it was "with them".
      const friend = crew.sort((a, b) => dist(view.pos, a.pos) - dist(view.pos, b.pos))[0]
      if (friend && rng.chance(0.5)) return { kind: 'follow', who: friend.id }
      return fake(view, plan, rng, true)
    }
  }

  if (plan.state === 'blend' || plan.state === 'sabotage') {
    if (ready && !cover) go(plan, 'stalk', now)
    else return fake(view, plan, rng, true)
  }

  // Stalking or striking.
  if (!ready) {
    go(plan, 'blend', now)
    return fake(view, plan, rng, true)
  }
  const candidates = crew.filter((o) => (view.others.find((x) => x.id === o.id)?.alive ?? true))
  if (!candidates.length) {
    // Nobody in sight: go and wait at a station in a quiet room, where crew come to work alone.
    if (!plan.faking || view.time >= plan.faking.until || !QUIET_ROOMS.includes(stationRoom(plan.faking.station))) {
      const quiet = STATIONS.filter((st) => QUIET_ROOMS.includes(st.room) && !(st.visual && !isCareless(view)))
      const st = rng.pick(quiet)
      plan.faking = { station: st.id, until: view.time + dist(view.pos, st.at) / 2.6 + (st.length === 'short' ? view.rules.shortTaskTime : view.rules.longTaskTime) * rng.range(0.9, 1.1) }
    }
    return { kind: 'fakeTask', station: plan.faking.station }
  }
  const scored = candidates.map((o) => ({ o, score: targetScore(view, o) + (opts.bias?.(o) ?? 0), risk: strikeRisk(view, o) })).sort((a, b) => b.score - a.score)
  const keep = scored.find((s) => s.o.id === plan.target)
  const pick = keep ?? scored[0]
  plan.target = pick.o.id
  // An open doorway nearby is a risk most will take; a very bold Rotten will risk one witness too.
  // The longer the knife has waited, the more risk it will take: half a witness per 40 seconds.
  // An aggressive Rotten grows impatient twice as fast and starts bolder; a patient one waits for a
  // clean chance far longer.
  const wait = style === 'aggressive' ? IMPATIENCE / 2 : style === 'patient' ? IMPATIENCE * 3 : IMPATIENCE
  const impatience = Math.min(1.5, Math.floor((now - (plan.readySince ?? now)) / wait) * 0.5)
  const bold = style === 'aggressive' ? 1 : style === 'patient' ? 0 : t.aggression > 0.75 ? 1 : t.aggression > 0.25 ? 0.5 : 0
  const maxRisk = bold + impatience
  // Only from close in: a long chase gives others time to walk in.
  const safe = scored.find((s) => s.risk <= maxRisk && dist(view.pos, s.o.pos) < STRIKE_FROM)
  if (safe) {
    go(plan, 'strike', now)
    plan.target = safe.o.id
    return { kind: 'kill', who: safe.o.id }
  }
  // Lock the target's room first, so nobody can walk in. (Only with the doors rule.)
  const saboteur = style === 'saboteur' ? 0.4 : 0
  if (view.canSabotage && view.rules.doors && pick.risk <= 1.5 && pick.o.area === view.area && isRoomId(view.area) && rng.chance(0.2 + t.aggression * 0.3 + saboteur)) {
    go(plan, 'sabotage', now)
    return { kind: 'sabotage', what: 'doors', room: view.area }
  }
  // Lights out first, so a strike in the dark is safer.
  if (view.canSabotage && pick.risk <= (saboteur ? 4 : 2.5) && rng.chance(0.25 + t.aggression * 0.3 + saboteur)) {
    go(plan, 'sabotage', now)
    return { kind: 'sabotage', what: 'lights' }
  }
  if (plan.state !== 'stalk') go(plan, 'stalk', now)
  plan.target = pick.o.id
  if (pick.risk > 1) {
    plan.watchedSince ??= now
    if (now - plan.watchedSince > STALK_PATIENCE) {
      go(plan, 'blend', now)
      return fake(view, plan, rng, true)
    }
  } else plan.watchedSince = null
  // Stalk from just outside what the crew can see.
  return { kind: 'follow', who: pick.o.id, gap: crewVision(view) + 0.8 }
}

/** Two time spans overlap. */
function overlaps(a0: number, a1: number, b0: number, b1: number) {
  return a0 <= b1 && b0 <= a1
}

/**
 * A rumour to plant: point the finger at someone, ideally whoever has been accusing it.
 * Returns null most of the time; a Rotten who spreads too much gossip gets noticed.
 */
export function rottenRumour(view: FruitView, listener: string, rng: Rng): { claim: Claim; confidence: number; source?: string } | null {
  if (!rng.chance((styleOf(view) === 'framer' ? 0.45 : 0.25) + view.traits.aggression * 0.35)) return null
  const pool = view.others.filter((o) => o.alive && o.id !== listener && !view.partners.includes(o.id))
  if (!pool.length) return null
  const accuser = view.memory.find((m) => m.kind === 'heard' && m.told === 'accuse' && m.who === view.id && m.source && pool.some((o) => o.id === m.source))?.source
  const target = accuser ?? rng.pick(pool).id
  const lastSeen = [...view.memory].reverse().find((m) => m.kind === 'seen' && m.who === target)
  const room = lastSeen?.room ?? rng.pick(ROOMS).id
  const at = Math.round(lastSeen ? lastSeen.to : Math.max(0, view.time - rng.range(5, 30)))
  const bodies = view.others.filter((o) => !o.alive)
  const what = bodies.length && rng.chance(0.4) ? 'nearBody' : 'fakeTask'
  return { claim: { kind: 'saw', what, who: target, room, at, victim: what === 'nearBody' ? rng.pick(bodies).id : undefined }, confidence: 0.85 }
}

/** A careless Rotten improvises; a careful one sticks to what it said before. */
export function isCareless(view: FruitView): boolean {
  return view.traits.honesty < 0.35 && view.traits.quirks.some((q) => q === 'dramatic' || q === 'nervous' || q === 'gossip')
}

/**
 * Where the Rotten says it was on its last stop. The truth, unless it killed then or there, in
 * which case it names a room next door. A careful Rotten repeats any earlier claim about the same
 * time; a careless one sometimes makes up a new one.
 */
export function rottenAlibi(view: FruitView, rng: Rng): Claim | null {
  const stops = view.trail.filter((t) => t.to - t.from > 3 && t.area !== view.area)
  const last = stops.at(-1)
  if (!last) return null
  return alibiFor(view, last.area, Math.round(last.from), Math.round(last.to), rng)
}

/** The Rotten's story for one stretch of time it spent in `areaId`. */
export function alibiFor(view: FruitView, areaId: string, from: number, to: number, rng: Rng, smart = false): Claim {
  const careless = !smart && isCareless(view)
  const said = view.ledger.find((c) => c.claim.kind === 'where' && overlaps(c.claim.from, c.claim.to, from, to))
  if (said && !(careless && rng.chance(0.45))) return said.claim
  const guilty = view.kills.some((k) => k.area === areaId || (k.time >= from - 5 && k.time <= to + 5))
  if (!guilty) return { kind: 'where', room: areaId, from, to }
  // Anyone it saw there probably saw it too, so a lie would be caught: own up to the room and
  // leave out who else was about. Only a careless Rotten lies anyway.
  const seenBy = view.memory.some((m) => m.kind === 'seen' && m.room === areaId && m.from <= to && m.to >= from && !view.partners.includes(m.who) && view.others.find((o) => o.id === m.who)?.alive)
  if (seenBy && !(careless && rng.chance(0.5))) return { kind: 'where', room: areaId, from, to }
  let decoys = nextRooms(areaId).filter((r) => r !== areaId)
  // Thinking it through: a room where it saw crew about then is a lie they would catch. If every
  // room next door had someone in it, owning up to the real one is safer.
  if (smart) {
    decoys = decoys.filter((r) => !view.memory.some((m) => m.kind === 'seen' && m.room === r && m.from <= to && m.to >= from && !view.partners.includes(m.who)))
    if (!decoys.length) return { kind: 'where', room: areaId, from, to }
  }
  return { kind: 'where', room: decoys.length ? rng.pick(decoys) : rng.pick(ROOMS).id, from, to }
}

function nextRooms(areaId: string): string[] {
  const a = area(areaId)
  return a.hallway ? [...a.hallway] : neighbours(areaId)
}
