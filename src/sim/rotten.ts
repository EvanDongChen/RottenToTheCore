import type { RoamAction } from './brains/types'
import { dist, ROOMS, STATIONS } from './map'
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
