import { describe, expect, it } from 'vitest'
import { sabotageTimers } from '../src/sim/actions'
import { createGame, step } from '../src/sim/engine'
import { playGame } from '../src/sim/game'
import { areaAt, doorsOf, MELTDOWN_PANELS } from '../src/sim/map'
import { findPath } from '../src/sim/nav'
import { updateVision, sees } from '../src/sim/perception'
import { viewFor } from '../src/sim/view'

describe('stretch: meltdown', () => {
  it('gives the Rotten the win if nobody holds both panels in time', () => {
    const game = createGame({ seed: 2, rules: { meltdown: true } })
    game.meltdown = { until: game.time + 1 }
    // Keep everyone far from the Ripening Chamber.
    for (const f of game.fruits) {
      f.pos = [22, 14]
      f.area = areaAt(f.pos)
    }
    game.time = 2
    sabotageTimers(game)
    expect(game.winner).toBe('rotten')
    expect(game.how).toBe('meltdown')
  })

  it('is stopped when two fruits stand at the two panels', () => {
    const game = createGame({ seed: 2, rules: { meltdown: true } })
    game.meltdown = { until: game.time + 30 }
    const [a, b] = game.fruits
    a.pos = MELTDOWN_PANELS[0]
    b.pos = MELTDOWN_PANELS[1]
    sabotageTimers(game)
    expect(game.meltdown).toBeNull()
    expect(game.winner).toBeNull()
  })

  it('gets played: the Rotten start meltdowns and the crew run to the panels', async () => {
    let started = 0
    let fixed = 0
    for (let seed = 1; seed <= 20; seed++) {
      const g = await playGame({ seed, rules: { meltdown: true } })
      started += g.log.filter((e) => e.kind === 'sabotage' && e.what === 'meltdown').length
      fixed += g.log.filter((e) => e.kind === 'fixed' && e.what === 'meltdown').length
    }
    expect(started).toBeGreaterThan(0)
    expect(fixed).toBeGreaterThan(0)
  })
})

describe('stretch: doors', () => {
  it('blocks paths through a locked room and sight through its doorways', () => {
    const blocked = new Set(doorsOf('cafeteria').map((d) => d.id))
    // From the Juicer to Cold Storage the straight way is through the Cafeteria.
    const around = findPath([0, -14], [0, 14], 0, blocked)
    expect(around.length).toBeGreaterThan(2)
    expect(around.some((p) => Math.abs(p[0]) < 8 && Math.abs(p[1]) < 6)).toBe(false)
    // Inside the locked room there is no way out at all.
    expect(findPath([0, 3], [0, -14], 0, blocked)).toEqual([])

    const game = createGame({ seed: 1, rules: { doors: true } })
    const [a, b, ...rest] = game.fruits
    a.pos = [0, -4.5]
    b.pos = [0, -8]
    rest.forEach((f) => (f.pos = [22, 15]))
    for (const f of game.fruits) f.area = areaAt(f.pos)
    updateVision(game)
    expect(sees(game, a.id, b.id)).toBe(true)
    game.locked = { room: 'cafeteria', until: 99 }
    updateVision(game)
    expect(sees(game, a.id, b.id)).toBe(false)
  })
})

describe('stretch: roles', () => {
  it('lets an engineer use a vent, and only an engineer among the crew', async () => {
    const game = createGame({ seed: 3, rules: { engineers: 1 } })
    const engineer = game.fruits.find((f) => f.perk === 'engineer')!
    expect(engineer.role).toBe('crew')
    const g = await playGame({ seed: 3, rules: { engineers: 2 } })
    const vents = g.log.filter((e) => e.kind === 'vent')
    const engineers = g.fruits.filter((f) => f.perk === 'engineer').map((f) => f.id)
    for (const v of vents) {
      if (v.kind !== 'vent') continue
      const f = g.fruits.find((x) => x.id === v.who)!
      expect(f.role === 'rotten' || engineers.includes(f.id)).toBe(true)
    }
  })

  it('shows a scientist every death at once', () => {
    const game = createGame({ seed: 3, rules: { scientists: 1 } })
    const scientist = game.fruits.find((f) => f.perk === 'scientist')!
    const victim = game.fruits.find((f) => f.role === 'crew' && f !== scientist)!
    victim.alive = false
    expect(viewFor(game, scientist).others.find((o) => o.id === victim.id)!.alive).toBe(false)
    const other = game.fruits.find((f) => f.role === 'crew' && f !== scientist && f !== victim)!
    expect(viewFor(game, other).others.find((o) => o.id === victim.id)!.alive).toBe(true)
    void step
  })
})
