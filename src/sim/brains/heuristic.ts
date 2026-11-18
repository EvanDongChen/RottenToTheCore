import type { Rng } from '../rng'
import { newPlan, rottenRoam } from '../rotten'
import type { RottenPlan } from '../rotten'
import type { FruitView } from '../view'
import { crewRoam } from './crew'
import { stockChat } from './dialog'
import { deathWindow, grudges, indexMemory, knownBodies, reachable, storyBreaks, trustScores } from './reasoning'
import { crewSpeak, crewVote, rottenSpeak, rottenVote } from './speak'
import type { Ballot, Brain, BrainKind, ChatContext, ChatLine, MeetingLine, MeetingView, RoamAction } from './types'

/**
 * The baseline brain: rules of thumb. Suspicion adds up from what it has seen and heard, weighed
 * by its personality: how suspicious it is, how far it believes others, and whether it holds a
 * grudge against whoever accused it. Free and fast.
 */

/** Rough evidence weights, added up per fruit and squashed into 0..1. */
const SCORE = {
  kill: 10,
  vented: 8,
  nearBody: 0.9,
  fakeTask: 1,
  caught: 1.2,
  accused: 0.3,
  vouched: -0.3,
  heardHard: 1.2,
  /** Told two different stories about the same time, in front of everyone. */
  storyBreak: 2.2,
  /** Couldn't have reached a body in time, or had no alibi at all for when it happened. */
  unreachable: -1.5,
  noAlibi: 0.5,
  /** Went after me in a meeting (I know I'm crew), or stood up for me. Scaled by how much it holds grudges. */
  grudge: 0.45,
  loyalty: -0.35,
}
const VOTE_ABOVE = 0.6

/**
 * How much a fruit holds it against those who accused it: the hot-headed and the stubborn hold
 * grudges, grumpy fruits most of all.
 */
export function grudgeWeight(traits: FruitView['traits']): number {
  return traits.aggression * 0.6 + (traits.temper === 'stubborn' ? 0.3 : 0) + (traits.quirks.includes('grumpy') ? 0.3 : 0)
}

export function heuristicBeliefs(view: FruitView): Record<string, number> {
  const out: Record<string, number> = {}
  const living = view.others.filter((o) => o.alive)
  if (view.role === 'rotten') {
    for (const o of living) out[o.id] = view.partners.includes(o.id) ? 1 : 0
    return out
  }
  const t = view.traits
  const breaks = storyBreaks(view)
  const trust = trustScores(view, breaks)
  const prior = view.rules.rotten / Math.max(1, living.length)
  // What others say counts for more with the gullible, and for less with the stubborn.
  const ears = t.temper === 'gullible' ? 1.5 : t.temper === 'stubborn' ? 0.5 : 1
  const index = indexMemory(view, trust)
  const bodies = knownBodies(view).map((b) => ({ b, window: deathWindow(view, b, trust) }))
  const { against, for: defenders } = grudges(view)
  const grudge = grudgeWeight(t)
  for (const o of living) {
    if (view.cleared.includes(o.id)) {
      out[o.id] = 0.02
      continue
    }
    let score = 0
    for (const m of view.memory) {
      if (m.who !== o.id) continue
      const c = m.now
      if (m.kind === 'kill') score += SCORE.kill * c
      else if (m.kind === 'vented') score += SCORE.vented * c
      else if (m.kind === 'nearBody') score += SCORE.nearBody * c
      else if (m.kind === 'fakeTask') score += SCORE.fakeTask * c
      else if (m.kind === 'heard') {
        // Hearsay counts as far as the teller has earned it.
        const w = c * ears * (m.source ? (trust[m.source] ?? 0.75) : 1)
        if (m.told === 'accuse') score += (t.temper === 'contrarian' ? -0.5 : 1) * SCORE.accused * w
        else if (m.told === 'vouch') score += SCORE.vouched * w
        else if (m.told === 'kill' || m.told === 'vented') score += SCORE.heardHard * w
        else if (m.told === 'nearBody' || m.told === 'fakeTask') score += SCORE.accused * 2 * w
      }
    }
    score += (view.caught[o.id] ?? 0) * SCORE.caught
    score += Math.min(2, breaks.get(o.id)?.length ?? 0) * SCORE.storyBreak
    if (view.tailedBy.includes(o.id)) score += SCORE.accused
    // Who could have got to each body in time.
    for (const { b, window } of bodies) {
      const r = reachable(o.id, b, index, window)
      if (r.open === 0) score += SCORE.unreachable * r.confidence
      else if (r.open > 0.9) score += SCORE.noAlibi
    }
    // Grudges and loyalty: it knows it's crew, so whoever accused it was wrong, maybe on purpose.
    score += Math.min(3, against[o.id] ?? 0) * SCORE.grudge * (0.4 + grudge)
    score += Math.min(3, defenders[o.id] ?? 0) * SCORE.loyalty
    // A suspicious nature reads more into the same evidence.
    score *= 0.7 + t.suspicion * 0.6
    const odds = (prior / (1 - prior)) * Math.exp(score)
    out[o.id] = Math.min(0.99, odds / (1 + odds))
  }
  return out
}

export class HeuristicBrain implements Brain {
  readonly kind: BrainKind = 'heuristic'
  protected plan: RottenPlan = newPlan()
  protected id: string
  protected rng: Rng

  constructor(id: string, rng: Rng) {
    this.id = id
    this.rng = rng
  }

  private beliefCache: { time: number; key: string; beliefs: Record<string, number> } | null = null

  beliefs(view: FruitView): Record<string, number> {
    return this.cached(view, heuristicBeliefs)
  }

  /** Worked out afresh when the evidence changes, or every couple of sim seconds as memories fade. */
  protected cached(view: FruitView, work: (view: FruitView) => Record<string, number>): Record<string, number> {
    const key = `${view.memory.length}|${view.public.length}|${Object.values(view.caught).reduce((a, b) => a + b, 0)}|${view.tailedBy.length}|${view.cleared.length}|${view.others.filter((o) => o.alive).length}`
    if (this.beliefCache && this.beliefCache.key === key && view.time - this.beliefCache.time < 2) return this.beliefCache.beliefs
    const beliefs = work(view)
    this.beliefCache = { time: view.time, key, beliefs }
    return beliefs
  }

  roam(view: FruitView): RoamAction {
    if (view.role === 'rotten') return rottenRoam(view, this.plan, this.rng)
    return crewRoam(view, this.beliefs(view), this.rng)
  }

  async chat(view: FruitView, chat: ChatContext): Promise<ChatLine[]> {
    return [stockChat(view, chat, this.rng)]
  }

  async speak(view: FruitView, meeting: MeetingView): Promise<MeetingLine> {
    if (view.role === 'rotten') return rottenSpeak(view, meeting, this.rng)
    return crewSpeak(view, meeting, this.beliefs(view), this.rng)
  }

  async vote(view: FruitView, meeting: MeetingView): Promise<Ballot> {
    const tally = tallySoFar(view)
    if (view.role === 'rotten') return rottenVote(view, meeting, this.rng, tally)
    return crewVote(view, meeting, this.beliefs(view), this.rng, VOTE_ABOVE, tally)
  }
}

/** Votes cast so far in this meeting, per target (skips left out). */
export function tallySoFar(view: FruitView): Record<string, number> {
  const since = [...view.public].reverse().findIndex((e) => e.kind === 'meeting')
  const recent = since < 0 ? view.public : view.public.slice(view.public.length - since)
  const tally: Record<string, number> = {}
  for (const e of recent) if (e.kind === 'vote' && e.target !== 'skip') tally[e.target] = (tally[e.target] ?? 0) + 1
  return tally
}
