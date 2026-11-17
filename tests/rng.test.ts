import { describe, expect, it } from 'vitest'
import { makeRng } from '../src/sim/rng'

describe('rng', () => {
  it('gives the same numbers for the same seed', () => {
    const a = makeRng(42)
    const b = makeRng(42)
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next())
  })

  it('gives different numbers for different seeds', () => {
    expect(makeRng(1).next()).not.toBe(makeRng(2).next())
  })

  it('keeps draws in range', () => {
    const rng = makeRng(7)
    for (let i = 0; i < 1000; i++) {
      const x = rng.next()
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
      expect(rng.int(5)).toBeLessThan(5)
    }
  })

  it('forks streams that do not depend on later draws from the parent', () => {
    const a = makeRng(3)
    const b = makeRng(3)
    const fa = a.fork('x')
    const fb = b.fork('x')
    b.next()
    b.next()
    expect(fa.next()).toBe(fb.next())
  })
})
