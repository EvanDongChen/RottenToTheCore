import type { Claim, MeetingLine } from './brains/types'
import { hashString } from './rng'
import type { FruitKind, Role, Vec2, Winner } from './types'

/**
 * Everything that happened in a game, in order. It drives replays, the recap and the metrics,
 * and its hash is what the golden replay test compares. `t` is sim seconds; during a meeting
 * roam time stands still, so meeting events share the time the meeting was called.
 */
export type SimEvent =
  | { t: number; kind: 'start'; seed: number; roster: { id: string; name: string; kind: FruitKind; role: Role }[] }
  /** Every living fruit's position, logged twice per sim second for replays. */
  | { t: number; kind: 'positions'; at: [id: string, x: number, z: number][] }
  | { t: number; kind: 'task'; who: string; station: string; ghost: boolean }
  | { t: number; kind: 'kill'; killer: string; victim: string; at: Vec2; room: string; witnesses: string[] }
  | { t: number; kind: 'found'; who: string; body: string }
  | { t: number; kind: 'vent'; who: string; from: string; to: string; seenBy: string[] }
  | { t: number; kind: 'sabotage'; who: string; what: 'lights' }
  | { t: number; kind: 'fixed'; who: string; what: 'lights' }
  | { t: number; kind: 'witness'; who: string; saw: string; about: string; bent?: boolean }
  | { t: number; kind: 'chat'; who: string; to: string; say: string; topic: string; accuses?: string; vouches?: string; claim?: Claim }
  | { t: number; kind: 'encounter'; a: string; b: string; what: string }
  | { t: number; kind: 'meeting'; reason: 'body' | 'emergency'; caller: string; victim?: string; room?: string }
  | { t: number; kind: 'say'; who: string; line: MeetingLine; step: string }
  | { t: number; kind: 'react'; who: string; to: string; how: 'corroborate' | 'contradict' | 'hedge'; bent: boolean }
  | { t: number; kind: 'vote'; voter: string; target: string; reason: string }
  | { t: number; kind: 'eject'; who: string; role: Role; votes: number; lastWords: string }
  | { t: number; kind: 'noEject'; tie: boolean; skips: number }
  | { t: number; kind: 'whisper'; who: string; to: string; say: string }
  | { t: number; kind: 'over'; winner: Winner | 'draw'; how: string }

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
