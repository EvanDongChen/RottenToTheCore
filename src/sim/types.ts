// Shared shapes for the sim. Pure data: nothing here may import three, React, Rapier or Zustand.

export const FRUIT_KINDS = [
  'apple',
  'orange',
  'lemon',
  'plum',
  'pear',
  'lime',
  'peach',
  'blueberry',
  'cherry',
  'kiwi',
  'banana',
  'strawberry',
  'watermelon',
] as const
export type FruitKind = (typeof FRUIT_KINDS)[number]

/** Crew do tasks; the Rotten fake them and slice the crew when nobody is looking. */
export type Role = 'crew' | 'rotten'

export type Phase = 'setup' | 'roam' | 'meeting' | 'over'

export type Winner = 'crew' | 'rotten'

/** A point on the floor: x across, z down the screen. Sim units. */
export type Vec2 = [number, number]

/** How a fruit changes its mind. */
export type Temper = 'steady' | 'stubborn' | 'gullible' | 'contrarian'

/** Feelings that build up from events and fade over time, each 0..1. */
export interface Mood {
  fear: number
  anger: number
  grief: number
  guilt: number
  smug: number
}

/** Personality sliders, each 0..1, plus up to three quirks. */
export interface Traits {
  aggression: number
  honesty: number
  talkativeness: number
  suspicion: number
  /** Sharp fruits notice more and forget more slowly. */
  sharpness: number
  /** Each is a preset's id (see quirks.ts) or, for one the user wrote, the text itself. */
  quirks: string[]
  /** One line of history, in the fruit's own words, which it brings up in conversation. */
  backstory: string
  temper: Temper
}

export const TRAIT_KEYS = ['aggression', 'honesty', 'talkativeness', 'suspicion', 'sharpness'] as const

/** What the user edits on the setup screen. */
export interface FruitDef {
  id: string
  name: string
  kind: FruitKind
  traits: Traits
}

/** A short burst of body language. */
export type Reaction = 'gasp' | 'shake' | 'cheer' | 'sulk' | 'puzzle' | 'blush'

/** Every tunable number in a game. Times are sim seconds, distances sim units. */
export interface Rules {
  fruits: number
  rotten: number
  shortTasks: number
  longTasks: number
  shortTaskTime: number
  longTaskTime: number
  killCooldown: number
  killRange: number
  crewVision: number
  rottenVision: number
  lightsOutVision: number
  emergencyMeetings: number
  discussionTurns: number
  confirmEjects: boolean
}
