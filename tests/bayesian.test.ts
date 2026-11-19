import { describe, expect, it } from 'vitest'
import { bayesianBeliefs } from '../src/sim/brains/bayesian'
import { deathWindow, indexMemory, reachable } from '../src/sim/brains/reasoning'
import { createGame, runFor } from '../src/sim/engine'
import type { Memory } from '../src/sim/view'
import { viewFor } from '../src/sim/view'

describe('Bayesian brain', () => {
  it('spreads belief so it adds up to the number of Rotten still out there', () => {
    const game = createGame({ seed: 14, brains: { crew: 'bayesian' }, rules: { rotten: 2 } })
    runFor(game, 60)
    const crew = game.fruits.find((f) => f.role === 'crew' && f.alive)!
    const beliefs = bayesianBeliefs(viewFor(game, crew))
    const total = Object.values(beliefs).reduce((a, b) => a + b, 0)
    expect(total).toBeGreaterThan(1.8)
    expect(total).toBeLessThan(2.2)
  })

  it('clears a fruit that was seen too far away to have reached the body', () => {
    const game = createGame({ seed: 14, brains: { crew: 'bayesian' } })
    const me = game.fruits.find((f) => f.role === 'crew')!
    const view = viewFor(game, me)
    const far: Memory = { id: 1, kind: 'seen', who: 'x', room: 'security', from: 70, to: 100, confidence: 1, halfLife: 60, now: 1 }
    const near: Memory = { ...far, id: 2, who: 'y', room: 'electrical' }
    Object.defineProperty(view, 'memory', { value: [far, near] })
    // A body found in Electrical at t=100; the victim was never seen, so it could have died any time before.
    const body = { victim: 'v', room: 'electrical', found: 100 }
    const index = indexMemory(view)
    const window = deathWindow(view, body)
    const x = reachable('x', body, index, window)
    const y = reachable('y', body, index, window)
    const z = reachable('z', body, index, window)
    expect(x.open).toBeLessThan(0.5)
    // Seen in the body's own room is no alibi at all.
    expect(y.open).toBe(1)
    // Never seen: no alibi.
    expect(z.open).toBe(1)
  })

  it('puts a fruit it saw kill at near certainty', () => {
    const game = createGame({ seed: 14, brains: { crew: 'bayesian' } })
    const [me, other] = game.fruits.filter((f) => f.role === 'crew')
    me.memory.push({ id: 99, kind: 'kill', who: other.id, room: 'lab', from: 0, to: 0, confidence: 1, halfLife: 600, victim: game.fruits[2].id })
    expect(bayesianBeliefs(viewFor(game, me))[other.id]).toBeGreaterThan(0.9)
  })

  it('treats a fruit seen doing a visual task as crew', () => {
    const game = createGame({ seed: 14, brains: { crew: 'bayesian' } })
    const [me, other] = game.fruits.filter((f) => f.role === 'crew')
    me.mind.cleared.push(other.id)
    expect(bayesianBeliefs(viewFor(game, me))[other.id]).toBeLessThan(0.05)
  })
})
