import { FUSE_BOX, dist, ROOMS, station, VENTS } from '../map'
import type { Vec2 } from '../types'
import { walkDistance } from '../nav'
import type { Rng } from '../rng'
import type { FruitView } from '../view'
import type { RoamAction } from './types'

/**
 * How crew get about, shared by every brain: roaming is always rule-based and fast, even for
 * the LLM brain. Beliefs come in only where they matter: who to stay away from, who to tail.
 */

/** Certain evidence worth pressing the button for: a kill or a vent seen since the last meeting. */
export function hardEvidence(view: FruitView): string | null {
  const lastMeeting = [...view.public].reverse().find((e) => e.kind === 'meeting')?.t ?? -1
  const m = view.memory.find((s) => (s.kind === 'kill' || s.kind === 'vented') && s.to > lastMeeting && view.others.find((o) => o.id === s.who)?.alive)
  return m?.who ?? null
}

/** The nearest task still to do, keeping the current one if it is not done yet. */
export function nextTask(view: FruitView): string | null {
  const left = view.tasks.filter((t) => !t.done)
  if (!left.length) return null
  if (view.action.kind === 'goTask' && left.some((t) => t.station === (view.action as { station: string }).station)) return view.action.station
  let best = left[0].station
  let bestD = Infinity
  for (const t of left) {
    const d = walkDistance(view.pos, station(t.station).at)
    if (d < bestD) {
      bestD = d
      best = t.station
    }
  }
  return best
}

export interface CrewOptions {
  /** How sure it must be before it tails someone instead of working. */
  tailAbove: number
}

export function crewRoam(view: FruitView, beliefs: Record<string, number>, rng: Rng, opts: CrewOptions = { tailAbove: 0.75 }): RoamAction {
  const t = view.traits
  // A body in sight: report it. A coward might run off first, but it reports in the end.
  if (view.bodies.length) {
    // A coward runs for the button instead, which looks bad to anyone who sees it leave.
    if (view.action.kind === 'emergency') return view.action
    if (t.aggression < 0.25 && view.emergenciesLeft > 0 && view.mood.fear > 0.4 && rng.chance(0.5)) return { kind: 'emergency' }
    const body = view.bodies.reduce((a, b) => (dist(view.pos, a.pos) <= dist(view.pos, b.pos) ? a : b))
    return { kind: 'report', body: body.id }
  }
  // A meltdown: everyone runs to the panels. Nothing else matters if it goes off.
  if (view.meltdownIn !== null) return { kind: 'fixSabotage' }

  // Saw a kill or a vent: sprint to the button.
  if (hardEvidence(view) && view.emergenciesLeft > 0) return { kind: 'emergency' }
  // A scientist's vitals board shows a death nobody has reported yet: call everyone in.
  if (view.perk === 'scientist' && view.emergenciesLeft > 0 && view.buttonReady && unreportedDeath(view)) return { kind: 'emergency' }
  if (view.action.kind === 'emergency') return view.action

  // Lights out: the brave and the nearby go and fix them.
  if (view.lightsOut) {
    const d = walkDistance(view.pos, FUSE_BOX)
    if (view.action.kind === 'fixSabotage' || d < 22 || t.aggression > 0.6) return { kind: 'fixSabotage' }
    // The rest bunch up with whoever they trust nearby.
    const near = view.visible.filter((o) => (beliefs[o.id] ?? 0.5) < 0.4).sort((a, b) => dist(view.pos, a.pos) - dist(view.pos, b.pos))[0]
    if (near && view.mood.fear > 0.3) return { kind: 'follow', who: near.id }
  }

  // A suspicious fruit keeps an eye on a strong suspect it can see.
  const suspect = view.visible.filter((o) => (beliefs[o.id] ?? 0) > opts.tailAbove).sort((a, b) => beliefs[b.id] - beliefs[a.id])[0]
  if (suspect && t.suspicion > 0.55 && rng.chance(0.3 + t.suspicion * 0.3)) return { kind: 'follow', who: suspect.id }
  if (view.action.kind === 'follow' && view.visible.some((o) => o.id === (view.action as { who: string }).who) && rng.chance(0.85)) return view.action

  const task = nextTask(view)
  // An engineer takes a vent when it is a shortcut to the next task.
  if (task && view.perk === 'engineer') {
    const shortcut = ventShortcut(view, station(task).at)
    if (shortcut) return { kind: 'vent', to: shortcut }
  }
  if (task) return { kind: 'goTask', station: task }

  // All done: drift about, or tag along with whoever it trusts most.
  if (view.action.kind === 'wander' && view.moving) return view.action
  const friend = view.visible.filter((o) => (beliefs[o.id] ?? 0.5) < 0.15).sort((a, b) => beliefs[a.id] - beliefs[b.id])[0]
  if (friend && t.aggression < 0.5 && rng.chance(0.4)) return { kind: 'follow', who: friend.id }
  return { kind: 'wander', room: rng.pick(ROOMS).id }
}

/** Someone the vitals board shows dead, whose death no meeting has made public. */
function unreportedDeath(view: FruitView): boolean {
  const publicDead = new Set(view.public.filter((e) => e.kind === 'dead' || e.kind === 'eject').map((e) => (e.kind === 'dead' || e.kind === 'eject' ? e.who : '')))
  return view.others.some((o) => !o.alive && !publicDead.has(o.id))
}

/** A vent in this room whose other end saves a long walk to `goal`. */
function ventShortcut(view: FruitView, goal: Vec2): string | null {
  const here = VENTS.find((v) => v.room === view.area)
  if (!here) return null
  const exit = VENTS.find((v) => v.id === here.to)!
  const walk = walkDistance(view.pos, goal)
  const viaVent = dist(view.pos, here.at) + walkDistance(exit.at, goal)
  return viaVent + 10 < walk ? exit.id : null
}
