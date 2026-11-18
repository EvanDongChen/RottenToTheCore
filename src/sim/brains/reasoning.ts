import { WALK_SPEED } from '../constants'
import { AREAS, centre, samePlace } from '../map'
import { walkDistance } from '../nav'
import type { FruitView, Memory } from '../view'
import type { Claim } from './types'

/**
 * Crew reasoning shared by the heuristic and Bayesian brains. Everything here is a pure function
 * of what one fruit knows (its `FruitView`): when each victim could have died, who could have got
 * there in time, whose stories have changed between meetings, and whose word can be trusted.
 */

type Where = Extract<Claim, { kind: 'where' }>

// ---------- Bodies and the time of death ----------

export interface KnownBody {
  victim: string
  room: string
  /** When it was found (the meeting it was reported in). */
  found: number
}

/** Bodies this fruit knows about, with where and when they were found. */
export function knownBodies(view: FruitView): KnownBody[] {
  const out: KnownBody[] = []
  for (const e of view.public) if (e.kind === 'meeting' && e.victim && e.room) out.push({ victim: e.victim, room: e.room, found: e.t })
  return out
}

/** With nothing else to go on, a body is taken to be at most this old when found. */
const LONGEST_DEAD = 120

/**
 * When the victim was last known to be alive, before `found`: seen by this fruit, speaking or
 * voting in an earlier meeting, giving an alibi, or named in a trusted fruit's alibi as being
 * with it. Claims count only from fruits it trusts at least half.
 */
export function lastSeenAlive(view: FruitView, victim: string, found: number, trust: Record<string, number> = {}): number {
  let last = -Infinity
  const at = (t: number) => {
    if (t < found && t > last) last = t
  }
  for (const m of view.memory) {
    if ((m.kind === 'seen' || m.kind === 'passed' || m.kind === 'atTask') && m.who === victim && m.now > 0.3) at(m.to)
    else if (m.kind === 'heard' && m.told === 'alibi' && m.source) {
      const trusted = m.source === victim || (trust[m.source] ?? 0.75) >= 0.5
      if (trusted && (m.who === victim || m.with?.includes(victim))) at(m.to)
    }
  }
  for (const e of view.public) {
    // It spoke or voted at an earlier meeting: it was alive then.
    if ((e.kind === 'line' && e.who === victim) || (e.kind === 'vote' && e.voter === victim)) at(e.t)
    if (e.kind === 'line' && e.claim?.kind === 'where' && e.claim.with?.includes(victim) && (trust[e.who] ?? 0.75) >= 0.5) at(e.claim.to)
  }
  return last
}

/** The stretch of time in which the victim must have died: after it was last known alive, before it was found. */
export function deathWindow(view: FruitView, body: KnownBody, trust: Record<string, number> = {}): [number, number] {
  const last = Math.max(lastSeenAlive(view, body.victim, body.found, trust), body.found - LONGEST_DEAD, 0)
  return [Math.min(last, body.found - 2), body.found]
}

/** Seconds of walking between every pair of areas, by their centres. Worked out once. */
const TRAVEL: Record<string, Record<string, number>> = Object.fromEntries(
  AREAS.map((x) => [x.id, Object.fromEntries(AREAS.map((y) => [y.id, x === y ? 0 : walkDistance(centre(x.rect), centre(y.rect)) / WALK_SPEED]))]),
)
export const travel = (a: string, b: string) => TRAVEL[a]?.[b] ?? 0

/** Memories that place each fruit somewhere, grouped by fruit, built once per update. */
export interface MemoryIndex {
  /** Everything that says where each fruit was, with how much to trust it. */
  about: Map<string, { m: Memory; weight: number }[]>
}

/**
 * Index the memories that place fruits somewhere. Its own sightings count fully. Alibis count
 * as far as the teller is trusted, and a fruit's word for itself counts for little (the Rotten lie).
 */
export function indexMemory(view: FruitView, trust: Record<string, number> = {}): MemoryIndex {
  const about = new Map<string, { m: Memory; weight: number }[]>()
  const put = (who: string, m: Memory, weight: number) => {
    if (!about.has(who)) about.set(who, [])
    about.get(who)!.push({ m, weight })
  }
  for (const m of view.memory) {
    if (m.kind === 'seen' || m.kind === 'passed' || m.kind === 'atTask') put(m.who, m, 1)
    else if (m.kind === 'heard' && m.told === 'alibi') {
      const t = m.source ? (trust[m.source] ?? 0.75) : 0.75
      if (m.source === m.who) put(m.who, m, 0.25 * t)
      else put(m.who, m, t)
      for (const w of m.with ?? []) if (w !== m.source) put(w, m, t)
    }
  }
  return { about }
}

/**
 * Could `who` have been at the body at some moment while the victim could have died? Each
 * sighting of it elsewhere rules out the times it could not have walked there from where it was
 * seen. Returns the share of the window left open (0: cleared, 1: no alibi at all), and how sure
 * the alibis that close it are.
 */
export function reachable(who: string, body: KnownBody, index: MemoryIndex, window: [number, number]): { open: number; confidence: number } {
  const [w0, w1] = window
  const blocks: [number, number, number][] = []
  for (const { m, weight } of index.about.get(who) ?? []) {
    const slack = travel(m.room, body.room)
    // Seen in the body's own room, or nowhere near the kill window, tells nothing here.
    if (slack === 0 || m.to + slack < w0 || m.from - slack > w1) continue
    blocks.push([m.from - slack, m.to + slack, m.now * weight])
  }
  if (!blocks.length) return { open: 1, confidence: 1 }
  const steps = 30
  let open = 0
  let sure = 0
  for (let i = 0; i < steps; i++) {
    const t = w0 + ((i + 0.5) / steps) * (w1 - w0)
    let best = -1
    for (const [a, b, c] of blocks) if (t >= a && t <= b && c > best) best = c
    if (best < 0) open++
    else sure += best
  }
  return { open: open / steps, confidence: steps - open > 0 ? sure / (steps - open) : 1 }
}

// ---------- Stories that must hold up ----------

export interface StoryBreak {
  /** The two claims about the same time that can't both be true. */
  before: { t: number; claim: Where }
  after: { t: number; claim: Where }
}

/** Two claims overlapping by more than this many seconds must agree. */
const STORY_OVERLAP = 3

/**
 * Every fruit's stories across all meetings, checked against each other: two alibis for the
 * same stretch of time that name different places. Everyone heard them, so everyone knows.
 */
export function storyBreaks(view: FruitView): Map<string, StoryBreak[]> {
  const said = new Map<string, { t: number; claim: Where }[]>()
  for (const e of view.public) {
    if (e.kind !== 'line' || e.claim?.kind !== 'where') continue
    if (!said.has(e.who)) said.set(e.who, [])
    said.get(e.who)!.push({ t: e.t, claim: e.claim })
  }
  const out = new Map<string, StoryBreak[]>()
  for (const [who, claims] of said) {
    const breaks: StoryBreak[] = []
    for (let i = 0; i < claims.length; i++) {
      for (let j = i + 1; j < claims.length; j++) {
        const a = claims[i].claim
        const b = claims[j].claim
        const overlap = Math.min(a.to, b.to) - Math.max(a.from, b.from)
        if (overlap > STORY_OVERLAP && !samePlace(a.room, b.room)) breaks.push({ before: claims[i], after: claims[j] })
      }
    }
    if (breaks.length) out.set(who, breaks)
  }
  return out
}

// ---------- Trust ----------

const AGAINST = ['accuse', 'hardClaim', 'bandwagon', 'contradict']
const FOR = ['vouch', 'corroborate']

/** Fruits known for sure to be crew: dead (the Rotten don't kill each other), ejected and shown crew, or proven by a visual task. */
export function provenCrew(view: FruitView): Set<string> {
  const out = new Set<string>(view.cleared)
  for (const o of view.others) if (!o.alive) out.add(o.id)
  for (const e of view.public) {
    if (e.kind === 'eject' && e.role === 'crew') out.add(e.who)
    if (e.kind === 'eject' && e.role === 'rotten') out.delete(e.who)
  }
  return out
}

export function provenRotten(view: FruitView): Set<string> {
  const out = new Set<string>()
  for (const e of view.public) if (e.kind === 'eject' && e.role === 'rotten') out.add(e.who)
  return out
}

/**
 * How far this fruit trusts each other fruit's word, 0..1, from its record: caught lying,
 * stories that changed, accusations against fruits that turned out crew, defending a fruit that
 * turned out Rotten, and alibis its own eyes confirmed. Its temper colours the lot: the gullible
 * believe almost anyone, the stubborn hardly anyone.
 */
export function trustScores(view: FruitView, breaks = storyBreaks(view)): Record<string, number> {
  const crew = provenCrew(view)
  const rotten = provenRotten(view)
  const out: Record<string, number> = {}
  const wrongAccusations = new Map<string, number>()
  const backedRotten = new Map<string, number>()
  for (const e of view.public) {
    if (e.kind !== 'line' || !e.target) continue
    if (AGAINST.includes(e.move) && crew.has(e.target)) wrongAccusations.set(e.who, (wrongAccusations.get(e.who) ?? 0) + 1)
    if (FOR.includes(e.move) && rotten.has(e.target)) backedRotten.set(e.who, (backedRotten.get(e.who) ?? 0) + 1)
  }
  // Alibis it heard that its own eyes confirmed.
  const confirmed = new Map<string, number>()
  for (const m of view.memory) {
    if (m.kind !== 'heard' || m.told !== 'alibi' || !m.source || m.source !== m.who) continue
    const seen = view.memory.some((s) => (s.kind === 'seen' || s.kind === 'atTask') && s.who === m.who && s.now > 0.5 && samePlace(s.room, m.room) && s.from <= m.to && s.to >= m.from)
    if (seen) confirmed.set(m.who, (confirmed.get(m.who) ?? 0) + 1)
  }
  const temper = view.traits.temper
  for (const o of view.others) {
    let t = 0.8
    t *= Math.pow(0.6, Math.min(3, view.caught[o.id] ?? 0))
    t *= Math.pow(0.45, Math.min(2, breaks.get(o.id)?.length ?? 0))
    t *= Math.pow(0.85, Math.min(3, wrongAccusations.get(o.id) ?? 0))
    t *= Math.pow(0.3, Math.min(2, backedRotten.get(o.id) ?? 0))
    for (let i = 0; i < Math.min(3, confirmed.get(o.id) ?? 0); i++) t += (1 - t) * 0.15
    if (crew.has(o.id)) t = Math.max(t, 0.9)
    if (rotten.has(o.id)) t = 0.05
    if (temper === 'gullible') t = 0.5 + t * 0.5
    else if (temper === 'stubborn') t *= 0.75
    out[o.id] = Math.max(0.05, Math.min(1, t))
  }
  return out
}

// ---------- Grudges ----------

/**
 * Who has gone after this fruit in meetings, and who has stood up for it, counted per fruit.
 * A crew fruit knows for certain that anyone accusing it is wrong, which is a real clue; it also
 * makes for grudges, which aren't always fair.
 */
export function grudges(view: FruitView): { against: Record<string, number>; for: Record<string, number> } {
  const against: Record<string, number> = {}
  const forMe: Record<string, number> = {}
  for (const e of view.public) {
    if (e.kind !== 'line' || e.target !== view.id || e.who === view.id) continue
    if (AGAINST.includes(e.move)) against[e.who] = (against[e.who] ?? 0) + 1
    else if (FOR.includes(e.move)) forMe[e.who] = (forMe[e.who] ?? 0) + 1
  }
  return { against, for: forMe }
}

// ---------- The endgame ----------

/** How many Rotten are still out there, as far as this fruit knows. */
export function rottenLeft(view: FruitView): number {
  return Math.max(0, view.rules.rotten - provenRotten(view).size)
}

/**
 * Is this a vote the crew can't afford to waste? If skipping, or putting the wrong fruit in the
 * Juicer, and then losing one more to the knife would hand the Rotten the game.
 */
export function mustVote(view: FruitView, living: number): boolean {
  const left = rottenLeft(view)
  return left > 0 && left * 2 >= living - 2
}
