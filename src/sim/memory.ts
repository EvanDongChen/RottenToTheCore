import type { Rng } from './rng'

/**
 * What a fruit remembers. Every fruit remembers only what it saw or was told, and memories
 * fade and bend: everything interesting in a meeting (alibis, contradictions, wrong
 * accusations) comes out of this.
 */

export type SightingKind = 'seen' | 'passed' | 'atTask' | 'fakeTask' | 'nearBody' | 'vented' | 'kill' | 'heard'

/** What someone told a fruit, for `heard` memories. */
export type Told = Exclude<SightingKind, 'heard'> | 'accuse' | 'vouch' | 'alibi'

export interface Sighting {
  id: number
  kind: SightingKind
  /** The fruit it is about. For `heard`, the fruit the teller was talking about. */
  who: string
  /** Area id where it happened. */
  room: string
  /** Sim seconds. */
  from: number
  to: number
  /** 0..1 when stored. It fades with age (see `confidence`). */
  confidence: number
  /** Sim seconds for confidence to halve. */
  halfLife: number
  /** The distorted version, once misremembered. The fruit sticks to it from then on. */
  recalled?: { who?: string; room?: string; shift?: number }
  /** The bending roll has been made for this memory. */
  checked?: boolean
  /** For `heard`: who said it. */
  source?: string
  /** For `heard`: what kind of thing was said. */
  told?: Told
  /** For `heard` alibis: who the speaker says it was with. */
  with?: string[]
  /** `kill` and `nearBody`: the victim. */
  victim?: string
  /** `atTask` and `fakeTask`: the station. */
  station?: string
  /** `atTask`: the watcher saw the task's visible effect, which proves the worker is crew. */
  sawEffect?: boolean
  /** `passed`: which area the other fruit was heading for. */
  heading?: string
}

/** Fruits whose colours are close enough to mix up in a fading memory. */
const LOOKALIKES: [string, string][] = [
  ['lemon', 'banana'],
  ['cherry', 'strawberry'],
  ['lime', 'kiwi'],
  ['orange', 'peach'],
  ['apple', 'cherry'],
  ['plum', 'blueberry'],
  ['pear', 'lime'],
]

export function lookalikeKind(kind: string): string | undefined {
  for (const [a, b] of LOOKALIKES) {
    if (a === kind) return b
    if (b === kind) return a
  }
  return undefined
}

/** Certain things are remembered far longer. */
const STURDY: SightingKind[] = ['kill', 'vented']

/** Half-life in sim seconds, from about 30 for a dull fruit to 120 for a sharp one. */
export function halfLifeFor(kind: SightingKind, sharpness: number): number {
  const base = 30 + sharpness * 90
  if (STURDY.includes(kind)) return base * 4
  if (kind === 'heard') return base / 2
  return base
}

/** How sure the fruit is of this memory right now. */
export function confidence(s: Sighting, now: number): number {
  const age = Math.max(0, now - s.to)
  return s.confidence * 0.5 ** (age / s.halfLife)
}

/** Below this, the first recall may bend the memory. */
export const BEND_BELOW = 0.5

/**
 * The first time a memory drops below half confidence, roll once to bend it: it may move to the
 * next room over, shift in time by up to 20 seconds, or swap the fruit for a lookalike.
 * Returns true if it bent.
 */
export function maybeBend(
  s: Sighting,
  now: number,
  rng: Rng,
  bendChance: number,
  options: { neighbours: (room: string) => string[]; lookalike: (who: string) => string | undefined },
): boolean {
  if (s.checked || s.kind === 'kill' || s.kind === 'vented' || confidence(s, now) >= BEND_BELOW) return false
  s.checked = true
  if (!rng.chance(bendChance)) return false
  const roll = rng.next()
  const swap = options.lookalike(s.who)
  if (roll < 0.35 && swap) s.recalled = { who: swap }
  else if (roll < 0.7) {
    const near = options.neighbours(s.room)
    if (!near.length) return false
    s.recalled = { room: rng.pick(near) }
  } else s.recalled = { shift: Math.round(rng.range(-20, 20)) }
  return true
}

/** The memory as the fruit now believes it: with any bending applied. */
export function recall(s: Sighting): Sighting {
  if (!s.recalled) return s
  return {
    ...s,
    who: s.recalled.who ?? s.who,
    room: s.recalled.room ?? s.room,
    from: s.from + (s.recalled.shift ?? 0),
    to: s.to + (s.recalled.shift ?? 0),
  }
}

/** How a fruit puts its certainty into words. */
export function sureness(c: number): 'sure' | 'think' | 'vague' {
  return c > 0.7 ? 'sure' : c >= 0.4 ? 'think' : 'vague'
}
