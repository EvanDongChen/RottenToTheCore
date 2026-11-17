import type { Claim, RoamAction } from './brains/types'
import { area, dist, neighbours, ROOMS, STATIONS } from './map'
import type { Rng } from './rng'
import type { FruitView } from './view'

/**
 * How a Rotten behaves while roaming. Shared by every brain. It plans only from what it can see
 * and remember, never from the true game state. Filled out into a full state machine in
 * milestone 7; this first version fakes tasks and strikes when a lone fruit is in reach.
 */

export interface RottenPlan {
  /** The station being faked, and until when. */
  faking: { station: string; until: number } | null
}

export function newPlan(): RottenPlan {
  return { faking: null }
}

export function rottenRoam(view: FruitView, plan: RottenPlan, rng: Rng): RoamAction {
  const others = view.visible.filter((o) => !view.partners.includes(o.id))
  if (view.killReadyIn === 0 && others.length === 1) {
    const target = others[0]
    if (dist(view.pos, target.pos) < 8) return { kind: 'kill', who: target.id }
  }
  if (plan.faking && view.time < plan.faking.until) return { kind: 'fakeTask', station: plan.faking.station }
  const st = rng.chance(0.85) ? rng.pick(STATIONS) : null
  if (!st) return { kind: 'wander', room: rng.pick(ROOMS).id }
  plan.faking = { station: st.id, until: view.time + rng.range(8, 20) }
  return { kind: 'fakeTask', station: st.id }
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
  if (!rng.chance(0.25 + view.traits.aggression * 0.35)) return null
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
export function alibiFor(view: FruitView, areaId: string, from: number, to: number, rng: Rng): Claim {
  const said = view.ledger.find((c) => c.claim.kind === 'where' && overlaps(c.claim.from, c.claim.to, from, to))
  if (said && !(isCareless(view) && rng.chance(0.45))) return said.claim
  const guilty = view.kills.some((k) => k.area === areaId || (k.time >= from - 5 && k.time <= to + 5))
  if (!guilty) return { kind: 'where', room: areaId, from, to }
  const decoys = nextRooms(areaId).filter((r) => r !== areaId)
  return { kind: 'where', room: decoys.length ? rng.pick(decoys) : rng.pick(ROOMS).id, from, to }
}

function nextRooms(areaId: string): string[] {
  const a = area(areaId)
  return a.hallway ? [...a.hallway] : neighbours(areaId)
}
