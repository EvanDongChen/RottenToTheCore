import { hashString } from './rng'
import type { FruitKind, Role, Vec2 } from './types'

/**
 * Everything that happened in a game, in order. It drives replays, the recap and the metrics,
 * and its hash is what the golden replay test compares. `t` is sim seconds.
 */
export type SimEvent =
  | { t: number; kind: 'start'; seed: number; roster: { id: string; name: string; kind: FruitKind; role: Role }[] }
  /** Every living fruit's position, logged twice per sim second for replays. */
  | { t: number; kind: 'positions'; at: [id: string, x: number, z: number][] }
  | { t: number; kind: 'arrive'; who: string; at: Vec2 }

/** Positions are rounded in the log so it stays small and hashes the same everywhere. */
export function round(n: number) {
  return Math.round(n * 1000) / 1000
}

/** One short hex string for a whole log. Same inputs, same hash. */
export function hashLog(events: readonly SimEvent[]): string {
  let h = 0x811c9dc5
  for (const event of events) h = hashString(JSON.stringify(event), h)
  return h.toString(16).padStart(8, '0')
}
