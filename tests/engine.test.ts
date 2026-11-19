import { describe, expect, it } from 'vitest'
import { createGame, runFor, WALK_SPEED } from '../src/sim/engine'
import { HURRY } from '../src/sim/actions'
import { BOUNDS, dist, TABLE } from '../src/sim/map'
import { crossesWall } from '../src/sim/geom'
import { WALLS } from '../src/sim/map'
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

  it('keeps fruits inside the lab, off the table, out of the walls and at walking pace', () => {
    const game = createGame({ seed: 9, rules: { killCooldown: 1e9 } })
    const problems: string[] = []
    for (let s = 0; s < 1200; s++) {
      const before = game.fruits.map((f) => f.pos)
      runFor(game, 0.1)
      game.fruits.forEach((f, i) => {
        const at = `${f.id} at t=${game.time.toFixed(1)}`
        if (f.pos[0] < BOUNDS[0] || f.pos[0] > BOUNDS[2] || f.pos[1] < BOUNDS[1] || f.pos[1] > BOUNDS[3]) problems.push(`${at} left the lab`)
        if (dist(f.pos, TABLE.at) <= TABLE.radius) problems.push(`${at} is on the table`)
        if (Math.hypot(f.vel[0], f.vel[1]) > WALK_SPEED * HURRY + 1e-9) problems.push(`${at} is too fast`)
        if (WALLS.some((w) => crossesWall(before[i], f.pos, w))) problems.push(`${at} walked through a wall`)
      })
    }
    expect(problems).toEqual([])
    // Crew have been getting their tasks done.
    expect(game.log.filter((e) => e.kind === 'task').length).toBeGreaterThan(5)
  })
})
