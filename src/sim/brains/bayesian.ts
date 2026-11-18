import { WALK_SPEED } from '../constants'
import { AREAS, centre } from '../map'
import { walkDistance } from '../nav'
import type { Rng } from '../rng'
import type { FruitView, Memory } from '../view'
import { crewRoam } from './crew'
import { HeuristicBrain, tallySoFar } from './heuristic'
import { crewSpeak, crewVote, rottenSpeak, rottenVote } from './speak'
import type { Ballot, BrainKind, MeetingLine, MeetingView, RoamAction } from './types'

/**
 * The strongest non-LLM player. It keeps P(Rotten) for every other living fruit and updates it
 * from evidence with fixed likelihood ratios, each weighted by how sure the memory is (so bent
 * memories mislead it too). On top, for every body it checks who could have reached it in time.
 */

/** Likelihood ratios: how much more likely each piece of evidence is if the fruit is Rotten. Tune here. */
export const LIKELIHOOD = {
  visualTask: 0.02,
  kill: 60,
  vented: 40,
  nearBody: 3,
  fakeTask: 2,
  caught: 2.5,
  accusedByTrusted: 1.3,
  vouchedByTrusted: 0.8,
  tailed: 1.4,
  /** Couldn't have reached the body: all but cleared. */
  unreachable: 0.15,
  /** Reachable and nobody saw it anywhere around then. */
  noAlibi: 1.4,
  /** Spoke up for a fruit that turned out to be Rotten. */
  defendedRotten: 3,
} as const

const VOTE_ABOVE = 0.55
const ACCUSE_ABOVE = 0.5
const MAX_P = 0.99

/** Raise a likelihood ratio to a confidence: a 50% memory moves belief half as far (in log odds). */
const weighted = (lr: number, c: number) => Math.pow(lr, Math.max(0, Math.min(1, c)))

/** Where each living fruit is public knowledge to be crew (ejected and confirmed, or dead). */
function rottenLeft(view: FruitView): number {
  const caught = view.public.filter((e) => e.kind === 'eject' && e.role === 'rotten').length
  return Math.max(0, view.rules.rotten - caught)
}

interface Body {
  victim: string
  room: string
  /** When it was found (the meeting it was reported in). */
  found: number
}

/** Bodies this fruit knows about, with where and when they were found. */
function knownBodies(view: FruitView): Body[] {
  const out: Body[] = []
  for (const e of view.public) if (e.kind === 'meeting' && e.victim && e.room) out.push({ victim: e.victim, room: e.room, found: e.t })
  return out
}

/** Seconds of walking between every pair of areas, by their centres. Worked out once. */
const TRAVEL: Record<string, Record<string, number>> = Object.fromEntries(
  AREAS.map((x) => [x.id, Object.fromEntries(AREAS.map((y) => [y.id, x === y ? 0 : walkDistance(centre(x.rect), centre(y.rect)) / WALK_SPEED]))]),
)
const travel = (a: string, b: string) => TRAVEL[a]?.[b] ?? 0

/**
 * Could `who` have been at the body at some moment in the kill window? Each sighting of it
 * elsewhere rules out the times it could not have walked there from where it was seen.
 * Returns the share of the window left open (0: cleared, 1: no alibi at all), weighted by confidence.
 */
export function reachable(view: FruitView, who: string, body: Body, index = indexMemory(view)): { open: number; confidence: number } {
  // The kill happened after the victim was last seen alive (by this fruit) and before it was found.
  const lastAlive = Math.max(...(index.seen.get(body.victim) ?? []).map((m) => m.to), body.found - 90)
  const w0 = Math.min(lastAlive, body.found - 2)
  const w1 = body.found
  const blocks: [number, number, number][] = []
  for (const { m, weight } of index.about.get(who) ?? []) {
    const slack = travel(m.room, body.room)
    // Seen in the body's own room, or nowhere near the kill window, tells nothing here.
    if (slack === 0 || m.to + slack < w0 || m.from - slack > w1) continue
    blocks.push([m.from - slack, m.to + slack, m.now * weight])
  }
  if (!blocks.length) return { open: 1, confidence: 1 }
  // How much of the window is covered by any block, and how sure those blocks are.
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

/** Memories that place each fruit somewhere, grouped by fruit, built once per update. */
interface MemoryIndex {
  /** Direct sightings of each fruit. */
  seen: Map<string, Memory[]>
  /** Everything that says where each fruit was, with how much to trust it. */
  about: Map<string, { m: Memory; weight: number }[]>
}

export function indexMemory(view: FruitView): MemoryIndex {
  const seen = new Map<string, Memory[]>()
  const about = new Map<string, { m: Memory; weight: number }[]>()
  const put = (who: string, m: Memory, weight: number) => {
    if (!about.has(who)) about.set(who, [])
    about.get(who)!.push({ m, weight })
  }
  for (const m of view.memory) {
    if (m.kind === 'seen' || m.kind === 'passed' || m.kind === 'atTask') {
      if (!seen.has(m.who)) seen.set(m.who, [])
      seen.get(m.who)!.push(m)
      put(m.who, m, 1)
    } else if (m.kind === 'heard' && m.told === 'alibi') {
      // Its own word counts for little (the Rotten lie); others vouching for where it was count fully.
      if (m.source === m.who) put(m.who, m, 0.25)
      else put(m.who, m, 1)
      for (const w of m.with ?? []) if (w !== m.source) put(w, m, 1)
    }
  }
  return { seen, about }
}

export function bayesianBeliefs(view: FruitView): Record<string, number> {
  const living = view.others.filter((o) => o.alive)
  const out: Record<string, number> = {}
  if (view.role === 'rotten') {
    for (const o of living) out[o.id] = view.partners.includes(o.id) ? 1 : 0
    return out
  }
  const left = rottenLeft(view)
  if (!living.length || left === 0) {
    for (const o of living) out[o.id] = 0
    return out
  }
  const prior = Math.min(MAX_P, left / living.length)
  const logOdds: Record<string, number> = {}
  for (const o of living) logOdds[o.id] = Math.log(prior / (1 - prior))
  const add = (id: string, lr: number) => {
    if (id in logOdds) logOdds[id] += Math.log(lr)
  }
  // A first pass, used as trust in what others say: trust = 1 - P(they are Rotten).
  const firstTrust = () => 1 - Math.min(0.9, prior)

  for (const m of view.memory) {
    if (!(m.who in logOdds)) continue
    evidence(m, add, firstTrust)
  }
  // Each time it was caught out counts, up to three.
  for (const [id, n] of Object.entries(view.caught)) add(id, Math.pow(LIKELIHOOD.caught, Math.min(3, n)))
  for (const id of view.tailedBy) add(id, LIKELIHOOD.tailed)

  // Who could have reached each body in time?
  const index = indexMemory(view)
  for (const body of knownBodies(view)) {
    for (const o of living) {
      const r = reachable(view, o.id, body, index)
      if (r.open === 0) add(o.id, weighted(LIKELIHOOD.unreachable, r.confidence))
      else if (r.open === 1) add(o.id, LIKELIHOOD.noAlibi)
      else add(o.id, 0.4 + 0.6 * r.open)
    }
  }

  // Fruits that spoke up for a Rotten who was then ejected look like its partner.
  const caughtRotten = new Set(view.public.filter((e) => e.kind === 'eject' && e.role === 'rotten').map((e) => (e.kind === 'eject' ? e.who : '')))
  if (caughtRotten.size) {
    for (const e of view.public) {
      if (e.kind === 'line' && e.target && caughtRotten.has(e.target) && (e.move === 'vouch' || e.move === 'corroborate')) add(e.who, LIKELIHOOD.defendedRotten)
    }
  }

  for (const id of view.cleared) if (id in logOdds) logOdds[id] = Math.log(LIKELIHOOD.visualTask)
  // Turn odds into probabilities that add up to the Rotten still out there. With one left this is
  // exact: each fruit's odds over everyone's. With more, scale every odds by the same factor until
  // the probabilities sum to the count.
  const odds = Object.fromEntries(Object.entries(logOdds).map(([id, l]) => [id, Math.exp(Math.max(-30, Math.min(30, l)))]))
  const ids = Object.keys(odds)
  let p: Record<string, number>
  if (left === 1) {
    const total = ids.reduce((a, id) => a + odds[id], 0)
    p = Object.fromEntries(ids.map((id) => [id, odds[id] / total]))
  } else {
    const sum = (k: number) => ids.reduce((a, id) => a + (k * odds[id]) / (1 + k * odds[id]), 0)
    let lo = 1e-12
    let hi = 1e12
    for (let i = 0; i < 80; i++) {
      const mid = Math.sqrt(lo * hi)
      if (sum(mid) > left) hi = mid
      else lo = mid
    }
    p = Object.fromEntries(ids.map((id) => [id, (lo * odds[id]) / (1 + lo * odds[id])]))
  }
  for (const id of ids) out[id] = Math.round(Math.min(MAX_P, p[id]) * 1000) / 1000
  return out
}

/** One memory's effect on the odds. */
function evidence(m: Memory, add: (id: string, lr: number) => void, trust: () => number) {
  const c = m.now
  switch (m.kind) {
    case 'kill':
      add(m.who, weighted(LIKELIHOOD.kill, c))
      break
    case 'vented':
      add(m.who, weighted(LIKELIHOOD.vented, c))
      break
    case 'nearBody':
      add(m.who, weighted(LIKELIHOOD.nearBody, c))
      break
    case 'fakeTask':
      add(m.who, weighted(LIKELIHOOD.fakeTask, c))
      break
    case 'heard': {
      // Hearsay counts as far as the teller is trusted (its confidence already carries that).
      const lr =
        m.told === 'kill'
          ? LIKELIHOOD.kill
          : m.told === 'vented'
            ? LIKELIHOOD.vented
            : m.told === 'nearBody'
              ? LIKELIHOOD.nearBody
              : m.told === 'fakeTask'
                ? LIKELIHOOD.fakeTask
                : m.told === 'accuse'
                  ? LIKELIHOOD.accusedByTrusted
                  : m.told === 'vouch'
                    ? LIKELIHOOD.vouchedByTrusted
                    : 1
      if (lr !== 1) add(m.who, weighted(lr, c * (m.source ? trust() : 1) * 0.8))
      break
    }
  }
}

export class BayesianBrain extends HeuristicBrain {
  // Same roaming and Rotten behaviour as the heuristic brain; only how it reasons as crew differs.
  override readonly kind: BrainKind = 'bayesian'

  constructor(id: string, rng: Rng) {
    super(id, rng)
  }

  private cache: { time: number; key: string; beliefs: Record<string, number> } | null = null

  /** Worked out afresh when the evidence changes, or every couple of sim seconds as memories fade. */
  override beliefs(view: FruitView): Record<string, number> {
    const key = `${view.memory.length}|${view.public.length}|${Object.keys(view.caught).length}|${view.tailedBy.length}|${view.cleared.length}`
    if (this.cache && this.cache.key === key && view.time - this.cache.time < 2) return this.cache.beliefs
    const beliefs = bayesianBeliefs(view)
    this.cache = { time: view.time, key, beliefs }
    return beliefs
  }

  override roam(view: FruitView): RoamAction {
    return view.role === 'rotten' ? super.roam(view) : crewRoam(view, this.beliefs(view), this.rng, { tailAbove: 0.7 })
  }

  override async speak(view: FruitView, meeting: MeetingView): Promise<MeetingLine> {
    if (view.role === 'rotten') return rottenSpeak(view, meeting, this.rng)
    return crewSpeak(view, meeting, this.beliefs(view), this.rng, { accuseAbove: ACCUSE_ABOVE })
  }

  override async vote(view: FruitView, meeting: MeetingView): Promise<Ballot> {
    const tally = tallySoFar(view)
    if (view.role === 'rotten') return rottenVote(view, meeting, this.rng, tally)
    return crewVote(view, meeting, this.beliefs(view), this.rng, VOTE_ABOVE, tally)
  }
}
