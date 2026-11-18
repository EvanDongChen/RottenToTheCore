import { describe, expect, it } from 'vitest'
import { createGame, runFor } from '../src/sim/engine'
import { playGame } from '../src/sim/game'
import { areaAt } from '../src/sim/map'
import { updateVision } from '../src/sim/perception'
import { strikeRisk } from '../src/sim/rotten'
import { viewFor } from '../src/sim/view'

describe('the Rotten', () => {
  it('sees no risk striking a lone fruit in the middle of a room, and some with a watcher nearby', () => {
    const game = createGame({ seed: 3 })
    const rotten = game.fruits.find((f) => f.role === 'rotten')!
    const [target, watcher, ...rest] = game.fruits.filter((f) => f.role === 'crew')
    rotten.pos = [-23, 0]
    target.pos = [-22, 0]
    watcher.pos = [22, 15]
    rest.forEach((f) => (f.pos = [22, 15]))
    for (const f of game.fruits) f.area = areaAt(f.pos)
    updateVision(game)
    const view = viewFor(game, rotten)
    const t = view.visible.find((v) => v.id === target.id)!
    expect(strikeRisk(view, t)).toBe(0)

    watcher.pos = [-25, 2]
    watcher.area = areaAt(watcher.pos)
    updateVision(game)
    const view2 = viewFor(game, rotten)
    expect(strikeRisk(view2, view2.visible.find((v) => v.id === target.id)!)).toBeGreaterThanOrEqual(1)
  })

  it('fakes tasks without moving the task bar', () => {
    const game = createGame({ seed: 5, rules: { killCooldown: 1e9 } })
    runFor(game, 120)
    const rotten = game.fruits.find((f) => f.role === 'rotten')!
    expect(rotten.tasks.every((t) => t.progress === 0 && !t.done)).toBe(true)
    expect(game.log.some((e) => e.kind === 'task' && e.who === rotten.id)).toBe(false)
  })

  it('kills, vents and sabotages over a batch of games', async () => {
    let kills = 0
    let vents = 0
    let sabotages = 0
    for (let seed = 1; seed <= 30; seed++) {
      const g = await playGame({ seed })
      kills += g.stats.kills
      vents += g.stats.vents
      sabotages += g.stats.sabotages
    }
    expect(kills).toBeGreaterThan(30)
    expect(vents).toBeGreaterThan(0)
    expect(sabotages).toBeGreaterThan(0)
  })

  it('has two Rotten whisper a plan that only the viewer hears', async () => {
    let whispered = false
    for (let seed = 1; seed <= 30 && !whispered; seed++) {
      const g = await playGame({ seed, rules: { rotten: 2 } })
      whispered = g.log.some((e) => e.kind === 'whisper')
      // Nobody else gets a memory of it.
      for (const f of g.fruits.filter((x) => x.role === 'crew')) expect(f.memory.some((m) => m.kind === 'heard' && m.told === undefined)).toBe(false)
    }
    expect(whispered).toBe(true)
  })
})
