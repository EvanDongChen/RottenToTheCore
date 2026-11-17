import type { Rng } from './rng'
import type { Mood, Temper } from './types'

/**
 * Each fruit's inner life, kept by the engine for every brain: mood, a personal goal, and
 * grudges. Beliefs (who is Rotten) are worked out by each brain from the fruit's memory, then
 * cached here so the screen can show them.
 */

export const MOODS = ['fear', 'anger', 'grief', 'guilt', 'smug'] as const

export const TEMPERS: Record<Temper, { label: string; text: string }> = {
  steady: { label: 'Steady', text: 'Weighs what it hears and changes its mind when the evidence does.' },
  stubborn: { label: 'Stubborn', text: 'Makes up its mind early and almost never changes it.' },
  gullible: { label: 'Gullible', text: 'Believes the last thing it was told.' },
  contrarian: { label: 'Contrarian', text: 'Distrusts whatever everyone else agrees on.' },
}

/** Something personal a fruit wants, besides its side winning. */
export type Goal = { kind: 'truth' } | { kind: 'survive' } | { kind: 'protect'; target: string } | { kind: 'revenge'; target: string }

export interface Mind {
  mood: Mood
  goal: Goal
  /** How sure it is, 0..1, that each other fruit is Rotten. Cached from the brain for the screen. */
  beliefs: Record<string, number>
  /** When the beliefs were last copied from the brain. */
  beliefsAt?: number
  /** One private sentence about what it plans or fears. */
  thought: string
  /** How many times it caught each fruit in a contradiction. */
  caught: Record<string, number>
  /** Fruits it watched do a visual task: certainly crew. */
  cleared: string[]
  /** Fruits it caught following it around. */
  tailedBy: string[]
}

export function emptyMood(): Mood {
  return { fear: 0, anger: 0, grief: 0, guilt: 0, smug: 0 }
}

const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n))

/** A fresh mind. Goals are rolled once, from the game's random stream. */
export function startMind(rng: Rng, others: string[]): Mind {
  const someone = others.length ? rng.pick(others) : undefined
  const roll = rng.next()
  let goal: Goal = { kind: 'truth' }
  if (someone) {
    if (roll < 0.25) goal = { kind: 'protect', target: someone }
    else if (roll < 0.4) goal = { kind: 'revenge', target: someone }
    else if (roll < 0.6) goal = { kind: 'survive' }
  }
  return { mood: emptyMood(), goal, beliefs: {}, thought: '', caught: {}, cleared: [], tailedBy: [] }
}

/** Feelings build up from events. */
export function feel(mind: Mind, mood: keyof Mood, delta: number) {
  mind.mood[mood] = clamp(mind.mood[mood] + delta)
}

/** Feelings fade with time: about a fifth per sim minute. */
export function calmDown(mind: Mind, seconds: number) {
  const keep = 0.8 ** (seconds / 60)
  for (const m of MOODS) mind.mood[m] *= keep
}
