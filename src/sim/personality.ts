import type { RottenStyle, Temper, Traits } from './types'
import { TRAIT_KEYS } from './types'

/**
 * Ready-made personalities: a set of slider values and a temper, picked on the setup screen and
 * shown in the mind panel. The sliders stay editable afterwards; a fruit whose sliders have
 * wandered far from every archetype is "Custom".
 */
export interface Archetype {
  id: string
  label: string
  /** One line on how it plays. */
  blurb: string
  traits: Record<(typeof TRAIT_KEYS)[number], number>
  temper: Temper
}

export const ARCHETYPES: Archetype[] = [
  { id: 'detective', label: 'Detective', blurb: 'Notices everything and trusts evidence over talk.', traits: { aggression: 0.5, honesty: 0.9, talkativeness: 0.6, suspicion: 0.7, sharpness: 1 }, temper: 'steady' },
  { id: 'paranoid', label: 'Paranoid', blurb: 'Suspects everyone, and holds on to it.', traits: { aggression: 0.6, honesty: 0.7, talkativeness: 0.6, suspicion: 1, sharpness: 0.5 }, temper: 'stubborn' },
  { id: 'sheep', label: 'Sheep', blurb: 'Goes along with whatever the crowd says.', traits: { aggression: 0.2, honesty: 0.8, talkativeness: 0.3, suspicion: 0.3, sharpness: 0.4 }, temper: 'gullible' },
  { id: 'loudmouth', label: 'Loudmouth', blurb: 'Never stops talking, and accuses freely.', traits: { aggression: 0.8, honesty: 0.6, talkativeness: 1, suspicion: 0.6, sharpness: 0.4 }, temper: 'steady' },
  { id: 'hothead', label: 'Hothead', blurb: 'Quick to anger, quick to vote, never forgets an accusation.', traits: { aggression: 1, honesty: 0.5, talkativeness: 0.7, suspicion: 0.7, sharpness: 0.4 }, temper: 'stubborn' },
  { id: 'wallflower', label: 'Wallflower', blurb: 'Quiet and careful; hardly ever votes anyone out.', traits: { aggression: 0.1, honesty: 0.8, talkativeness: 0.1, suspicion: 0.4, sharpness: 0.6 }, temper: 'steady' },
  { id: 'contrarian', label: 'Contrarian', blurb: 'Distrusts whatever everyone else agrees on.', traits: { aggression: 0.6, honesty: 0.6, talkativeness: 0.6, suspicion: 0.6, sharpness: 0.6 }, temper: 'contrarian' },
]

/** Sliders further than this (summed) from every archetype make a fruit "Custom". */
const CUSTOM_BEYOND = 1.1

/** The archetype a fruit's personality is closest to, if it is close to any. */
export function archetypeOf(traits: Traits): Archetype | null {
  let best: Archetype | null = null
  let bestD = Infinity
  for (const a of ARCHETYPES) {
    let d = TRAIT_KEYS.reduce((sum, k) => sum + Math.abs(traits[k] - a.traits[k]), 0)
    if (a.temper !== traits.temper) d += 0.5
    if (d < bestD) {
      bestD = d
      best = a
    }
  }
  return bestD <= CUSTOM_BEYOND ? best : null
}

export const STYLE_INFO: Record<RottenStyle, { label: string; blurb: string }> = {
  aggressive: { label: 'Aggressive', blurb: 'Strikes early and takes risks.' },
  patient: { label: 'Patient', blurb: 'Waits for a perfectly clean chance.' },
  framer: { label: 'Framer', blurb: 'Reports its own kills and points the finger first.' },
  saboteur: { label: 'Saboteur', blurb: 'Lights out and locked doors before it strikes.' },
}
