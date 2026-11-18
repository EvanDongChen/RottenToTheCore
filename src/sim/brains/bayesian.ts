import type { Rng } from '../rng'
import type { FruitView } from '../view'
import { rottenRoam } from '../rotten'
import { crewRoam } from './crew'
import { killBias, tableSuspicion } from './rottenMind'
import { deathWindow, indexMemory, knownBodies, provenRotten, reachable, rottenLeft, storyBreaks, trustScores } from './reasoning'
import { HeuristicBrain, tallySoFar } from './heuristic'
import { crewSpeak, crewVote, rottenSpeak, rottenVote } from './speak'
import type { Ballot, BrainKind, MeetingLine, MeetingView, RoamAction } from './types'

/**
 * The strongest non-LLM player. It keeps P(Rotten) for every other living fruit and updates it
 * from evidence with likelihood ratios, each weighted by how sure the memory is (so bent memories
 * mislead it too). On top: who could have reached each body in time, whose stories changed, how
 * far each teller's word goes, and (with two Rotten) which pairs cover for each other.
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
  /** Told two different stories about the same stretch of time, in front of everyone. */
  storyBreak: 6,
  /** What a Rotten's word is worth: its accusations point at crew, its vouches at its partner. */
  liarAccuses: 0.7,
  liarVouches: 2.5,
  /** Two fruits that keep backing each other up, when there are two Rotten. */
  pairBond: 1.8,
}

const VOTE_ABOVE = 0.55
const ACCUSE_ABOVE = 0.5
const MAX_P = 0.99

/** Raise a likelihood ratio to a confidence: a 50% memory moves belief half as far (in log odds). */
const weighted = (lr: number, c: number) => Math.pow(lr, Math.max(0, Math.min(1, c)))

/** What a told thing would be worth from an honest teller. */
function toldRatio(told: string | undefined): number {
  switch (told) {
    case 'kill':
      return LIKELIHOOD.kill
    case 'vented':
      return LIKELIHOOD.vented
    case 'nearBody':
      return LIKELIHOOD.nearBody
    case 'fakeTask':
      return LIKELIHOOD.fakeTask
    case 'accuse':
      return LIKELIHOOD.accusedByTrusted
    case 'vouch':
      return LIKELIHOOD.vouchedByTrusted
  }
  return 1
}

/**
 * P(Rotten) for every other living fruit. Evidence moves each fruit's log odds by a likelihood
 * ratio weighted by how sure the memory is. Then:
 *  - hearsay is weighed as a mixture: the teller is either honest (the ratio as told) or Rotten
 *    (a lie: an accusation then points away, a vouch towards a partner), by how likely it is to be
 *    Rotten itself, and by its track record (trust);
 *  - for every body, who could have got there while the victim could have died;
 *  - stories that changed between meetings;
 *  - with two Rotten, every pair is scored together, so two fruits covering for each other stand out.
 */
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
  const breaks = storyBreaks(view)
  const trust = trustScores(view, breaks)

  // 1. What it saw with its own eyes, and the public record.
  for (const m of view.memory) {
    if (!(m.who in logOdds) || m.kind === 'heard') continue
    if (m.kind === 'kill') add(m.who, weighted(LIKELIHOOD.kill, m.now))
    else if (m.kind === 'vented') add(m.who, weighted(LIKELIHOOD.vented, m.now))
    else if (m.kind === 'nearBody') add(m.who, weighted(LIKELIHOOD.nearBody, m.now))
    else if (m.kind === 'fakeTask') add(m.who, weighted(LIKELIHOOD.fakeTask, m.now))
  }
  // Each time it was caught out counts, up to three; so does every story that changed.
  for (const [id, n] of Object.entries(view.caught)) add(id, Math.pow(LIKELIHOOD.caught, Math.min(3, n)))
  for (const [id, b] of breaks) add(id, Math.pow(LIKELIHOOD.storyBreak, Math.min(2, b.length)))
  for (const id of view.tailedBy) add(id, LIKELIHOOD.tailed)

  // Who could have reached each body while the victim could have died?
  const index = indexMemory(view, trust)
  for (const body of knownBodies(view)) {
    const window = deathWindow(view, body, trust)
    for (const o of living) {
      const r = reachable(o.id, body, index, window)
      if (r.open === 0) add(o.id, weighted(LIKELIHOOD.unreachable, r.confidence))
      else if (r.open === 1) add(o.id, LIKELIHOOD.noAlibi)
      else add(o.id, 0.4 + 0.6 * r.open)
    }
  }

  // Fruits that spoke up for a Rotten who was then ejected look like its partner.
  const caughtRotten = provenRotten(view)
  if (caughtRotten.size) {
    for (const e of view.public) {
      if (e.kind === 'line' && e.target && caughtRotten.has(e.target) && (e.move === 'vouch' || e.move === 'corroborate')) add(e.who, LIKELIHOOD.defendedRotten)
    }
  }

  // 2. Hearsay, weighed by how likely each teller is to be lying. A first look at the odds so far
  // says how likely each teller is to be Rotten.
  const first = normalise(logOdds, left)
  for (const m of view.memory) {
    if (m.kind !== 'heard' || !(m.who in logOdds) || m.told === 'alibi') continue
    const honest = toldRatio(m.told)
    if (honest === 1) continue
    const liar = m.source && m.source !== view.id ? (first[m.source] ?? 0) : 0
    const lie = m.told === 'vouch' ? (left >= 2 ? LIKELIHOOD.liarVouches : 1) : LIKELIHOOD.liarAccuses
    const record = m.source ? (trust[m.source] ?? 0.75) : 1
    // How sure the memory is already carries how far it was trusted when heard; the record now adds to it.
    const c = Math.min(1, m.now * 0.8 * (0.5 + record * 0.5))
    add(m.who, (1 - liar) * weighted(honest, c) + liar * weighted(lie, c))
  }

  for (const id of view.cleared) if (id in logOdds) logOdds[id] = Math.log(LIKELIHOOD.visualTask)
  // 3. With two Rotten left, score each pair: fruits that keep backing each other up go together.
  const p = left === 2 && living.length > 2 ? pairs(view, logOdds) : normalise(logOdds, left)
  for (const id of Object.keys(p)) out[id] = Math.round(Math.min(MAX_P, p[id]) * 1000) / 1000
  return out
}

/**
 * Turn odds into probabilities that add up to the Rotten still out there. With one left this is
 * exact: each fruit's odds over everyone's. With more, scale every odds by the same factor until
 * the probabilities sum to the count.
 */
function normalise(logOdds: Record<string, number>, left: number): Record<string, number> {
  const odds = Object.fromEntries(Object.entries(logOdds).map(([id, l]) => [id, Math.exp(Math.max(-30, Math.min(30, l)))]))
  const ids = Object.keys(odds)
  if (left <= 1) {
    const total = ids.reduce((a, id) => a + odds[id], 0)
    return Object.fromEntries(ids.map((id) => [id, odds[id] / total]))
  }
  const sum = (k: number) => ids.reduce((a, id) => a + (k * odds[id]) / (1 + k * odds[id]), 0)
  let lo = 1e-12
  let hi = 1e12
  for (let i = 0; i < 80; i++) {
    const mid = Math.sqrt(lo * hi)
    if (sum(mid) > left) hi = mid
    else lo = mid
  }
  return Object.fromEntries(ids.map((id) => [id, (lo * odds[id]) / (1 + lo * odds[id])]))
}

/**
 * Two Rotten: the chance of each pair being the two, from both fruits' odds and how much they
 * have backed each other (vouching, corroborating, naming each other in alibis); fruits that went
 * after each other are less likely partners. Each fruit's chance is the sum over the pairs it is in.
 */
function pairs(view: FruitView, logOdds: Record<string, number>): Record<string, number> {
  const ids = Object.keys(logOdds)
  const bond = new Map<string, number>()
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
  const bump = (a: string, b: string, n: number) => {
    if (a !== b && a in logOdds && b in logOdds) bond.set(key(a, b), (bond.get(key(a, b)) ?? 0) + n)
  }
  for (const e of view.public) {
    if (e.kind !== 'line' || !e.target) continue
    if (e.move === 'vouch' || e.move === 'corroborate') bump(e.who, e.target, 1)
    else if (e.move === 'accuse' || e.move === 'hardClaim' || e.move === 'contradict') bump(e.who, e.target, -1)
    if (e.claim?.kind === 'where') for (const w of e.claim.with ?? []) bump(e.who, w, 0.5)
  }
  for (const m of view.memory) if (m.kind === 'heard' && m.told === 'alibi' && m.source === m.who) for (const w of m.with ?? []) bump(m.who, w, 0.5)
  const odds = Object.fromEntries(ids.map((id) => [id, Math.exp(Math.max(-30, Math.min(30, logOdds[id])))]))
  const p: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]))
  let total = 0
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const b = Math.max(-2, Math.min(3, bond.get(key(ids[i], ids[j])) ?? 0))
      const w = odds[ids[i]] * odds[ids[j]] * Math.pow(LIKELIHOOD.pairBond, b)
      p[ids[i]] += w
      p[ids[j]] += w
      total += w
    }
  }
  // Each pair counts towards both its fruits, so the chances add up to two.
  for (const id of ids) p[id] = total > 0 ? p[id] / total : 2 / ids.length
  return p
}

/**
 * The question worth asking: where was someone at the moment the victim most likely died? Worth
 * most for the fruit it is least sure about (p near a half) whose whereabouts then nobody has
 * accounted for, and who hasn't already been asked or said.
 */
export function bestQuestion(view: FruitView, meeting: MeetingView, beliefs: Record<string, number>): { who: string; at: number } | null {
  if (!meeting.body) return null
  const found = [...view.public].reverse().find((e) => e.kind === 'meeting')?.t ?? view.time
  const body = { victim: meeting.body.victim, room: meeting.body.room, found }
  const trust = trustScores(view)
  const window = deathWindow(view, body, trust)
  const at = Math.round((window[0] + window[1]) / 2)
  const index = indexMemory(view, trust)
  let best: { who: string; at: number } | null = null
  let bestInfo = QUESTION_WORTH
  for (const who of meeting.living) {
    if (who === view.id || view.cleared.includes(who)) continue
    const asked = meeting.lines.some((l) => (l.line.move === 'question' && l.line.target === who) || (l.who === who && l.line.claim?.kind === 'where' && l.line.claim.from <= at && l.line.claim.to >= at))
    if (asked) continue
    const p = beliefs[who] ?? 0
    const info = p * (1 - p) * reachable(who, body, index, window).open
    if (info > bestInfo) {
      bestInfo = info
      best = { who, at }
    }
  }
  return best
}

/** The fruit in sight it is least sure about: watching it settles the most. Nobody, if all are clear-cut. */
export function worthWatching(view: FruitView, beliefs: Record<string, number>): string | null {
  let best: string | null = null
  let bestDoubt = WATCH_DOUBT
  for (const o of view.visible) {
    if (view.cleared.includes(o.id)) continue
    const p = beliefs[o.id] ?? 0
    const doubt = p * (1 - p)
    if (doubt > bestDoubt) {
      bestDoubt = doubt
      best = o.id
    }
  }
  return best
}

/** Only worth watching if it is somewhere between about 15% and 85% likely to be Rotten. */
const WATCH_DOUBT = 0.13

/** Below this, no question is worth the meeting's time. */
const QUESTION_WORTH = 0.04

export class BayesianBrain extends HeuristicBrain {
  // Same roaming and Rotten behaviour as the heuristic brain; only how it reasons as crew differs.
  override readonly kind: BrainKind = 'bayesian'

  constructor(id: string, rng: Rng) {
    super(id, rng)
  }

  override beliefs(view: FruitView): Record<string, number> {
    return this.cached(view, bayesianBeliefs)
  }

  override roam(view: FruitView): RoamAction {
    // As Rotten it thinks about what the crew think of it: silence witnesses, keep scapegoats.
    if (view.role === 'rotten') return rottenRoam(view, this.plan, this.rng, { bias: killBias(view) })
    return crewRoam(view, this.beliefs(view), this.rng, { tailAbove: 0.7, curious: worthWatching })
  }

  override async speak(view: FruitView, meeting: MeetingView): Promise<MeetingLine> {
    if (view.role === 'rotten') return rottenSpeak(view, meeting, this.rng, { smart: true, table: tableSuspicion(view) })
    return crewSpeak(view, meeting, this.beliefs(view), this.rng, { accuseAbove: ACCUSE_ABOVE, question: bestQuestion })
  }

  override async vote(view: FruitView, meeting: MeetingView): Promise<Ballot> {
    const tally = tallySoFar(view)
    if (view.role === 'rotten') return rottenVote(view, meeting, this.rng, tally, { smart: true })
    return crewVote(view, meeting, this.beliefs(view), this.rng, VOTE_ABOVE, tally)
  }
}
