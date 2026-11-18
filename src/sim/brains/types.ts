import type { SightingKind } from '../memory'
import type { FruitView } from '../view'

/**
 * The decision-maker for one fruit. The engine enforces the rules; the brain only chooses.
 * Every fruit has its own brain, and kinds can be mixed in one game, which is what makes the
 * benchmarks possible. A brain only ever sees a `FruitView`, and must always return something
 * legal: repair it, never throw.
 *
 * Benchmarks depend on this interface: ask before changing it.
 */
export interface Brain {
  readonly kind: BrainKind
  /** Fast and synchronous: called at each roam checkpoint. */
  roam(view: FruitView): RoamAction
  /** One or two lines in a hallway or task-side chat. Only the wording: the engine has already decided what is shared. */
  chat(view: FruitView, chat: ChatContext): Promise<ChatLine[]>
  /** One turn in a meeting. */
  speak(view: FruitView, meeting: MeetingView): Promise<MeetingLine>
  vote(view: FruitView, meeting: MeetingView): Promise<Ballot>
  /** How sure it is, 0..1, that each other living fruit is Rotten. Shown on screen and used for metrics. */
  beliefs(view: FruitView): Record<string, number>
}

export type BrainKind = 'heuristic' | 'bayesian' | 'llm'
export const BRAIN_KINDS: BrainKind[] = ['heuristic', 'bayesian', 'llm']

export type RoamAction =
  | { kind: 'goTask'; station: string }
  /** Walk to a random spot in a room; `hurry` walks faster (and looks it). */
  | { kind: 'wander'; room: string; hurry?: boolean }
  /** Follow at about `gap` units (default 2.5): close for company, far back for stalking. */
  | { kind: 'follow'; who: string; gap?: number }
  | { kind: 'report'; body: string }
  | { kind: 'emergency' }
  | { kind: 'fixSabotage' }
  | { kind: 'idle' }
  // Rotten only
  | { kind: 'kill'; who: string }
  | { kind: 'vent'; to: string }
  | { kind: 'sabotage'; what: 'lights' }
  | { kind: 'fakeTask'; station: string }

/** Something a fruit says happened. Structured so the sim can check it without reading text. */
export type Claim =
  /** "I was in `room` from `from` to `to`", optionally with other fruits. */
  | { kind: 'where'; room: string; from: number; to: number; with?: string[] }
  /** "I saw `who` do `what` in `room` around `at`." */
  | { kind: 'saw'; what: Exclude<SightingKind, 'heard'>; who: string; room: string; at: number; victim?: string }

export interface ChatContext {
  partner: string
  /** What sort of chat: a word in passing, a stop to gossip, or talk at the task stations. */
  setting: 'pass' | 'gossip' | 'task'
  /** What this fruit is going to say, decided by the engine. */
  topic: 'greet' | 'heading' | 'smallTalk' | 'progress' | 'where' | 'pact' | 'rumour' | 'accuse' | 'fear'
  /** The claim this line carries, if any. */
  claim?: Claim
  /** For accusations and rumours: who it is about. */
  about?: string
  /** For `heading`: where it is off to. */
  room?: string
  /** For `progress`: tasks left. */
  left?: number
  /** For rumours: how sure the speaker is, 0..1. Above 0.7 it is sure; below that it hedges. */
  confidence?: number
}

export interface ChatLine {
  say: string
  accuses?: string
  vouches?: string
  claim?: Claim
}

export type Move =
  | 'report'
  | 'alibi'
  | 'accuse'
  | 'defend'
  | 'vouch'
  | 'question'
  | 'corroborate'
  | 'contradict'
  | 'hardClaim'
  | 'bandwagon'
  | 'skip'
  | 'pass'

export interface MeetingLine {
  move: Move
  target?: string
  /** For display only: the structured fields drive the sim. */
  say: string
  claim?: Claim
}

export interface Ballot {
  target: string | 'skip'
  reason: string
}

export interface MeetingView {
  reason: 'body' | 'emergency'
  caller: string
  body?: { victim: string; room: string }
  /** Which part of the meeting this turn belongs to. */
  step: 'report' | 'roundup' | 'open' | 'lastCall' | 'vote'
  /** Everything said so far, in order. */
  lines: { who: string; line: MeetingLine }[]
  /** Someone asked this fruit a question it must answer now. */
  askedBy?: string
  living: string[]
  /**
   * What this fruit made of claims said so far, checked against its own memory: it remembers the
   * same (match), clearly otherwise (conflict), or vaguely otherwise (hedge). Not yet spoken about.
   */
  checks: MeetingCheck[]
}

export interface MeetingCheck {
  speaker: string
  how: 'match' | 'conflict' | 'hedge'
  claim: Claim
  /** What this fruit remembers instead (or the same), as a claim it could say out loud. */
  mine: Claim
  /** How sure it is of its own memory, 0..1. */
  confidence: number
}
