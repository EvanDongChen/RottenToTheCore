import type { Rng } from '../rng'
import { newPlan, rottenRoam } from '../rotten'
import type { RottenPlan } from '../rotten'
import type { FruitView } from '../view'
import { crewRoam } from './crew'
import { stockChat } from './dialog'
import { crewSpeak, crewVote, rottenSpeak, rottenVote } from './speak'
import type { Ballot, Brain, ChatContext, ChatLine, MeetingLine, MeetingView, RoamAction } from './types'

/**
 * The baseline brain: rules of thumb. Suspicion rises with what it has seen and heard, with no
 * sense of who could have been where. Free and fast.
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
}
const VOTE_ABOVE = 0.6

export function heuristicBeliefs(view: FruitView): Record<string, number> {
  const out: Record<string, number> = {}
  const living = view.others.filter((o) => o.alive)
  if (view.role === 'rotten') {
    for (const o of living) out[o.id] = view.partners.includes(o.id) ? 1 : 0
    return out
  }
  const prior = view.rules.rotten / Math.max(1, living.length)
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
        if (m.told === 'accuse') score += SCORE.accused * c
        else if (m.told === 'vouch') score += SCORE.vouched * c
        else if (m.told === 'kill' || m.told === 'vented') score += SCORE.heardHard * c
        else if (m.told === 'nearBody' || m.told === 'fakeTask') score += SCORE.accused * 2 * c
      }
    }
    score += (view.caught[o.id] ?? 0) * SCORE.caught
    if (view.tailedBy.includes(o.id)) score += SCORE.accused
    // A suspicious nature reads more into the same evidence.
    score *= 0.7 + view.traits.suspicion * 0.6
    const odds = (prior / (1 - prior)) * Math.exp(score)
    out[o.id] = Math.min(0.99, odds / (1 + odds))
  }
  return out
}

export class HeuristicBrain implements Brain {
  readonly kind = 'heuristic' as const
  protected plan: RottenPlan = newPlan()
  protected id: string
  protected rng: Rng

  constructor(id: string, rng: Rng) {
    this.id = id
    this.rng = rng
  }

  beliefs(view: FruitView): Record<string, number> {
    return heuristicBeliefs(view)
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
