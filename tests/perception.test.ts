import { describe, expect, it } from 'vitest'
import { createGame, fruitById, runFor } from '../src/sim/engine'
import type { Game } from '../src/sim/engine'
import { areaAt, MONITORS } from '../src/sim/map'
import { confidence } from '../src/sim/memory'
import { clearLine, sees, updateVision } from '../src/sim/perception'
import type { Vec2 } from '../src/sim/types'
import { viewFor } from '../src/sim/view'

/** Put two fruits at fixed spots, everyone else far away in Security, and work out vision. */
function place(game: Game, a: Vec2, b: Vec2) {
  const [fa, fb, ...rest] = game.fruits
  fa.pos = a
  fb.pos = b
  rest.forEach((f, i) => (f.pos = [19 + (i % 3) * 3, 11 + Math.floor(i / 3) * 3]))
  for (const f of game.fruits) {
    f.area = areaAt(f.pos)
    f.path = []
  }
  updateVision(game)
  return [fa, fb]
}

describe('perception', () => {
  it('sees a fruit in the same room', () => {
    const game = createGame({ seed: 1 })
    const [a, b] = place(game, [-5, -3], [-1, -3])
    expect(sees(game, a.id, b.id)).toBe(true)
  })

  it('does not see past the vision radius', () => {
    const game = createGame({ seed: 1 })
    const [a, b] = place(game, [-7, -5], [7, 5])
    expect(sees(game, a.id, b.id)).toBe(false)
  })

  it('lets a wall block the line of sight, even within range', () => {
    const game = createGame({ seed: 1, rules: { crewVision: 12, rottenVision: 12 } })
    // Electrical's east wall and the Cafeteria's west wall have no doors between them.
    const [a, b] = place(game, [-18, 0], [-7.5, 0])
    expect(sees(game, a.id, b.id)).toBe(false)
    expect(sees(game, b.id, a.id)).toBe(false)
  })

  it('sees through an open doorway', () => {
    const game = createGame({ seed: 1 })
    const [a, b] = place(game, [0, -4], [0, -8])
    expect(sees(game, a.id, b.id)).toBe(true)
  })

  it('never sees a fruit in another room through solid wall, from anywhere', () => {
    // Points along the inside of the Juicer's south wall, and along the inside of the
    // Cafeteria's north wall, away from the doorway between them.
    for (let x = -7; x <= 7; x += 0.5) {
      if (Math.abs(x) < 3) continue
      expect(clearLine([x, -10.5], 'juicer', [x, -5.5], 'cafeteria')).toBe(false)
    }
  })

  it('sees what the cameras see from the Security monitors', () => {
    const game = createGame({ seed: 1 })
    const [a, b] = place(game, MONITORS, [12.5, 0.5])
    expect(sees(game, a.id, b.id)).toBe(true)
    // Step away from the monitors and the cameras are gone.
    const [c, d] = place(game, [20, 12], [12.5, 0.5])
    expect(sees(game, c.id, d.id)).toBe(false)
  })

  it('cuts crew vision when the lights are out, but not the Rotten', () => {
    const game = createGame({ seed: 1 })
    game.lightsOut = true
    const crew = game.fruits.find((f) => f.role === 'crew')!
    const rotten = game.fruits.find((f) => f.role === 'rotten')!
    crew.pos = [-5, -3]
    rotten.pos = [0, -3]
    for (const f of game.fruits) if (f !== crew && f !== rotten) f.pos = [22, 15]
    for (const f of game.fruits) f.area = areaAt(f.pos)
    updateVision(game)
    expect(sees(game, crew.id, rotten.id)).toBe(false)
    expect(sees(game, rotten.id, crew.id)).toBe(true)
  })
})

describe('memory', () => {
  it('fades and bends the same way for the same seed', () => {
    const a = createGame({ seed: 31 })
    const b = createGame({ seed: 31 })
    runFor(a, 150)
    runFor(b, 150)
    expect(JSON.stringify(a.fruits.map((f) => f.memory))).toBe(JSON.stringify(b.fruits.map((f) => f.memory)))
    expect(a.stats.bentMemories).toBeGreaterThan(0)
  })

  it('halves confidence every half-life', () => {
    const s = { id: 1, kind: 'seen' as const, who: 'x', room: 'lab', from: 0, to: 0, confidence: 0.8, halfLife: 60 }
    expect(confidence(s, 60)).toBeCloseTo(0.4)
    expect(confidence(s, 120)).toBeCloseTo(0.2)
  })

  it('only remembers seeing fruits that were really in sight at the time', () => {
    const game = createGame({ seed: 12 })
    // The truth, tick by tick: who each fruit could see.
    const truth = new Set<string>()
    const problems: string[] = []
    // A victim is seen up to the moment it dies, which is after the tick's vision snapshot below.
    const diedAt = new Map<string, number>()
    game.onEvent = (e) => {
      if (e.kind === 'kill') diedAt.set(e.victim, Math.round(e.t * 10))
    }
    for (let i = 0; i < 900 && game.phase === 'roam'; i++) {
      runFor(game, 0.1)
      for (const [f, seen] of game.vision.sees) {
        for (const id of seen) {
          truth.add(`${f}|${id}|${Math.round(game.time * 10) - 1}`)
          if (!fruitById(game, id)!.alive) problems.push(`${f} sees dead ${id}`)
        }
      }
    }
    for (const f of game.fruits) {
      for (const m of f.memory) {
        if (m.kind !== 'seen' || m.recalled) continue
        for (let t = Math.round(m.from * 10); t <= Math.round(m.to * 10); t++) {
          if (!truth.has(`${f.id}|${m.who}|${t}`) && diedAt.get(m.who) !== t && diedAt.get(f.id) !== t) {
            problems.push(`${f.id} remembers ${m.who} at ${t / 10} but could not see it`)
            break
          }
        }
      }
    }
    expect(problems).toEqual([])
  })
})

describe('viewFor', () => {
  it('never tells a crew fruit anyone else\'s role', () => {
    const game = createGame({ seed: 8, rules: { rotten: 2 } })
    runFor(game, 90)
    for (const f of game.fruits.filter((x) => x.role === 'crew')) {
      const view = viewFor(game, f)
      expect(view.partners).toEqual([])
      const leaks: string[] = []
      const scan = (value: unknown, path: string) => {
        if (!value || typeof value !== 'object') return
        for (const [k, v] of Object.entries(value)) {
          if (k === 'role' && path !== 'view') leaks.push(`${path}.${k}`)
          scan(v, `${path}.${k}`)
        }
      }
      scan(view, 'view')
      expect(leaks).toEqual([])
    }
  })

  it('tells a Rotten who its partner is', () => {
    const game = createGame({ seed: 8, rules: { rotten: 2 } })
    const [r1, r2] = game.fruits.filter((f) => f.role === 'rotten')
    expect(viewFor(game, r1).partners).toEqual([r2.id])
  })

  it('hides whether a memory has been bent', () => {
    const game = createGame({ seed: 31 })
    runFor(game, 150)
    for (const f of game.fruits) {
      const json = JSON.stringify(viewFor(game, f).memory)
      expect(json).not.toContain('recalled')
    }
  })
})
