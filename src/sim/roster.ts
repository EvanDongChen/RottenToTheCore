import { BACKSTORIES } from './brains/dialog'
import { QUIRK_PRESETS } from './quirks'
import type { Rng } from './rng'
import { FRUIT_KINDS } from './types'
import type { FruitDef, Traits } from './types'

const NAMES = [
  'Pip', 'Clem', 'Zest', 'Dusk', 'Bosc', 'Key', 'Fuzz', 'Indigo', 'Bing', 'Tang', 'Mango', 'Fig',
  'Juju', 'Pomelo', 'Quince', 'Rind', 'Nectar', 'Pith', 'Sorbet', 'Jam', 'Peel', 'Mellow', 'Tart', 'Squash',
]

export function randomTraits(rng: Rng): Traits {
  const r = () => Math.round(rng.next() * 10) / 10
  // One quirk, sometimes two.
  const presets = rng.shuffle(QUIRK_PRESETS)
  return {
    aggression: r(),
    honesty: r(),
    talkativeness: r(),
    suspicion: r(),
    sharpness: r(),
    quirks: presets.slice(0, rng.chance(0.3) ? 2 : 1).map((p) => p.id),
    backstory: rng.pick(BACKSTORIES),
    // Most fruits are level-headed; the rest are split between the three awkward kinds.
    temper: rng.chance(0.4) ? 'steady' : rng.pick(['stubborn', 'gullible', 'contrarian'] as const),
  }
}

/** A new random fruit: a name and a kind nobody in the roster has yet, if any are left. */
export function makeFruit(rng: Rng, roster: FruitDef[]): FruitDef {
  const names = NAMES.filter((n) => !roster.some((f) => f.name === n))
  const kinds = FRUIT_KINDS.filter((k) => !roster.some((f) => f.kind === k))
  // Ids only need to be unique within the roster, and stay stable for the same seed.
  let n = roster.length + 1
  while (roster.some((f) => f.id === `f${n}`)) n++
  return {
    id: `f${n}`,
    name: names.length ? rng.pick(names) : `Fruit ${roster.length + 1}`,
    kind: rng.pick(kinds.length ? kinds : FRUIT_KINDS),
    traits: randomTraits(rng),
  }
}

export function makeRoster(rng: Rng, count: number): FruitDef[] {
  const roster: FruitDef[] = []
  for (let i = 0; i < count; i++) roster.push(makeFruit(rng, roster))
  return roster
}
