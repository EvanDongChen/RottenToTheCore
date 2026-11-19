/**
 * Seeded random numbers. Every random draw in the sim goes through one of these, so the same
 * seed always gives the same game. Never call Math.random() in src/sim.
 */
export interface Rng {
  /** A float in [0, 1). */
  next(): number
  /** An integer in [0, n). */
  int(n: number): number
  /** A float in [lo, hi). */
  range(lo: number, hi: number): number
  chance(p: number): boolean
  pick<T>(items: readonly T[]): T
  /** A shuffled copy; the input is left alone. */
  shuffle<T>(items: readonly T[]): T[]
  /**
   * A separate stream, seeded from this one and a label. Lets one part of the sim draw more or
   * fewer numbers without shifting every draw that comes after it elsewhere.
   */
  fork(label: string): Rng
}

/** 32-bit FNV-1a. Used to turn labels and logs into seeds and hashes. */
export function hashString(text: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32: tiny, fast and good enough for a game. */
export function makeRng(seed: number): Rng {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const rng: Rng = {
    next,
    int: (n) => Math.floor(next() * n),
    range: (lo, hi) => lo + next() * (hi - lo),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)],
    shuffle: (items) => {
      const out = [...items]
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[out[i], out[j]] = [out[j], out[i]]
      }
      return out
    },
    fork: (label) => makeRng(hashString(label, Math.floor(next() * 4294967296))),
  }
  return rng
}
