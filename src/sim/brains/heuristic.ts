import type { Rng } from '../rng'
import { newPlan, rottenRoam } from '../rotten'
import type { RottenPlan } from '../rotten'
import type { FruitView } from '../view'
import { crewRoam } from './crew'
import { stockChat } from './dialog'
import type { Ballot, Brain, ChatContext, ChatLine, MeetingLine, MeetingView, RoamAction } from './types'

/**
 * The baseline brain: rules of thumb. Suspicion rises with what it has seen and heard, with no
 * sense of who could have been where. Free and fast.
 */

/** Rough evidence weights, added up per fruit and squashed into 0..1. */
const SCORE = {
  kill: 10,
  vented: 8,
  nearBody: 1.2,
  fakeTask: 1,
  caught: 1.2,
  accused: 0.35,
  vouched: -0.3,
  heardHard: 1.5,
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
    void view
    void meeting
    return { move: 'pass', say: '…' }
  }

  async vote(view: FruitView, meeting: MeetingView): Promise<Ballot> {
    const living = meeting.living.filter((id) => id !== view.id)
    if (view.role === 'rotten') return rottenVote(view, meeting, this.rng)
    const beliefs = this.beliefs(view)
    const top = living.filter((id) => id in beliefs).sort((a, b) => beliefs[b] - beliefs[a])[0]
    if (top && beliefs[top] > VOTE_ABOVE) return { target: top, reason: 'I have seen enough.' }
    return { target: 'skip', reason: 'Not sure yet.' }
  }
}

/** Votes cast so far in this meeting, per target. */
export function tallySoFar(view: FruitView, meeting: MeetingView): Record<string, number> {
  const since = [...view.public].reverse().findIndex((e) => e.kind === 'meeting')
  const recent = since < 0 ? view.public : view.public.slice(view.public.length - since)
  const tally: Record<string, number> = {}
  for (const e of recent) if (e.kind === 'vote' && e.target !== 'skip') tally[e.target] = (tally[e.target] ?? 0) + 1
  void meeting
  return tally
}

/** A Rotten votes with a crowd against a crew fruit, or skips to stay quiet. */
export function rottenVote(view: FruitView, meeting: MeetingView, rng: Rng): Ballot {
  const tally = tallySoFar(view, meeting)
  const crowd = Object.entries(tally)
    .filter(([id]) => id !== view.id && !view.partners.includes(id) && meeting.living.includes(id))
    .sort((a, b) => b[1] - a[1])[0]
  if (crowd && crowd[1] >= 1) return { target: crowd[0], reason: 'Everyone else seems sure.' }
  // Someone accused me in this meeting: point back at them, sometimes.
  const accuser = meeting.lines.find((l) => l.line.target === view.id && (l.line.move === 'accuse' || l.line.move === 'hardClaim'))
  if (accuser && meeting.living.includes(accuser.who) && rng.chance(0.5 + view.traits.aggression * 0.4)) return { target: accuser.who, reason: 'Funny how keen they are to blame me.' }
  return { target: 'skip', reason: 'We do not know enough.' }
}
