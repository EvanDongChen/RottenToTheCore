import { describe, expect, it } from 'vitest'
import { createGame, ROOM, runFor, WALK_SPEED } from '../src/sim/engine'
import { hashLog } from '../src/sim/log'

describe('engine', () => {
  it('gives the same event log for the same seed (golden replay)', () => {
    const a = createGame({ seed: 123 })
    const b = createGame({ seed: 123 })
    runFor(a, 60)
    runFor(b, 60)
    expect(hashLog(a.log)).toBe(hashLog(b.log))
    expect(a.log.length).toBeGreaterThan(100)
  })

  it('gives a different game for a different seed', () => {
    const a = createGame({ seed: 1 })
    const b = createGame({ seed: 2 })
    runFor(a, 30)
    runFor(b, 30)
    expect(hashLog(a.log)).not.toBe(hashLog(b.log))
  })

  it('deals the right number of Rotten', () => {
    for (const rotten of [1, 2]) {
      const game = createGame({ seed: 5, rules: { rotten } })
      expect(game.fruits.filter((f) => f.role === 'rotten')).toHaveLength(rotten)
    }
  })

  it('keeps fruits in the room and never faster than walking pace', () => {
    const game = createGame({ seed: 9 })
    for (let s = 0; s < 120; s++) {
      runFor(game, 1)
      for (const f of game.fruits) {
        expect(f.pos[0]).toBeGreaterThanOrEqual(ROOM.minX)
        expect(f.pos[0]).toBeLessThanOrEqual(ROOM.maxX)
        expect(f.pos[1]).toBeGreaterThanOrEqual(ROOM.minZ)
        expect(f.pos[1]).toBeLessThanOrEqual(ROOM.maxZ)
        expect(Math.hypot(f.vel[0], f.vel[1])).toBeLessThanOrEqual(WALK_SPEED + 1e-9)
      }
    }
    // Everyone has been somewhere by now.
    const arrivals = new Set(game.log.filter((e) => e.kind === 'arrive').map((e) => (e.kind === 'arrive' ? e.who : '')))
    expect(arrivals.size).toBe(game.fruits.length)
  })
})
