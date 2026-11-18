import type { Claim } from './brains/types'
import type { Game, SimFruit } from './engine'
import { samePlace } from './map'
import { confidence, recall } from './memory'
import type { Sighting } from './memory'
import { addSighting, nextDoor } from './witness'

/**
 * Checking what someone says against what you remember. Used for chats and meetings alike.
 * Every listener compares a location claim with its own sightings of the speaker at that time.
 */

export type Check = { result: 'match' | 'conflict' | 'hedge'; memory: Sighting; bent: boolean } | null

/** Seconds at each end of a claimed stay that don't count against it. */
const EDGE = 4

/** Two time spans overlap, with a little slack for vague memories. */
function overlaps(a0: number, a1: number, b0: number, b1: number, slack = 2) {
  return a0 <= b1 + slack && b0 <= a1 + slack
}

/**
 * Compare a "where" claim by `speaker` with what `listener` remembers seeing of it then.
 * Matching sighting above 0.6: match. Conflicting above 0.6: conflict. Conflicting 0.4 to 0.6: hedge.
 */
export function checkWhere(game: Game, listener: SimFruit, speaker: string, claim: Extract<Claim, { kind: 'where' }>): Check {
  let best: Check = null
  for (const m of listener.memory) {
    if (m.kind !== 'seen' && m.kind !== 'atTask' && m.kind !== 'passed' && m.kind !== 'nearBody') continue
    const r = recall(m)
    if (r.who !== speaker || !overlaps(r.from, r.to, claim.from, claim.to)) continue
    const c = confidence(m, game.time)
    if (c < 0.4) continue
    const agree = samePlace(r.room, claim.room)
    // Seen elsewhere only counts against an alibi well inside the claimed time: right at its
    // edges the speaker was just arriving or leaving.
    const inside = r.to >= claim.from + EDGE && r.from <= claim.to - EDGE
    if (!agree && !inside) continue
    const result = agree ? (c > 0.6 ? 'match' : null) : c > 0.6 ? 'conflict' : 'hedge'
    if (!result) continue
    // A conflict outranks a match: one clear sighting elsewhere breaks an alibi.
    const rank = { conflict: 3, hedge: 2, match: 1 }
    if (!best || rank[result] > rank[best.result]) best = { result, memory: m, bent: !!m.recalled }
  }
  return best
}

/**
 * Compare a "where" claim with earlier claims the listener heard the speaker make about the
 * same time. Two different stories: caught.
 */
export function checkStory(listener: SimFruit, speaker: string, claim: Extract<Claim, { kind: 'where' }>): Sighting | null {
  for (const m of listener.memory) {
    if (m.kind !== 'heard' || m.told !== 'alibi' || m.source !== speaker || m.who !== speaker) continue
    if (overlaps(m.from, m.to, claim.from, claim.to, -1) && !samePlace(m.room, claim.room)) return m
  }
  return null
}

/** How much `listener` trusts `teller`, 0..1, from its cached beliefs. */
export function trustIn(listener: SimFruit, teller: string, game: Game): number {
  if (listener.role === 'rotten' && game.fruits.find((f) => f.id === teller)?.role === 'rotten') return 1
  const b = listener.mind.beliefs[teller]
  return b === undefined ? 0.75 : Math.max(0.1, 1 - b)
}

/** Store what a listener heard a teller claim, with confidence scaled by trust. */
export function hear(game: Game, listener: SimFruit, teller: SimFruit, claim: Claim, tellerConfidence: number, extra: Partial<Sighting> = {}): Sighting {
  const c = Math.min(1, tellerConfidence) * trustIn(listener, teller.id, game)
  if (claim.kind === 'where') {
    return addSighting(game, listener, { kind: 'heard', told: 'alibi', who: teller.id, source: teller.id, room: claim.room, from: claim.from, to: claim.to, with: claim.with, confidence: c, ...extra })
  }
  return addSighting(game, listener, { kind: 'heard', told: claim.what, who: claim.who, source: teller.id, room: claim.room, from: claim.at, to: claim.at, victim: claim.victim, confidence: c, ...extra })
}

/** A rumour passed on again may bend again: a room over, or a lookalike fruit. */
export function bendRetelling(game: Game, claim: Claim, rng: { chance(p: number): boolean; pick<T>(xs: readonly T[]): T }): Claim {
  if (!rng.chance(0.25)) return claim
  if (claim.kind === 'where') return { ...claim, room: rng.pick(nextDoor(claim.room)) }
  const who = game.fruits.find((f) => f.id === claim.who)
  const swap = who && game.fruits.find((f) => f !== who && f.alive && LOOKALIKE_KIND[who.def.kind] === f.def.kind)
  if (swap && rng.chance(0.5)) return { ...claim, who: swap.id }
  return { ...claim, room: rng.pick(nextDoor(claim.room)) }
}

const LOOKALIKE_KIND: Record<string, string> = {
  lemon: 'banana',
  banana: 'lemon',
  cherry: 'strawberry',
  strawberry: 'cherry',
  lime: 'kiwi',
  kiwi: 'lime',
  orange: 'peach',
  peach: 'orange',
  plum: 'blueberry',
  blueberry: 'plum',
}
