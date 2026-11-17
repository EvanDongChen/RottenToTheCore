import { describe, expect, it } from 'vitest'
import { createGame } from '../src/sim/engine'
import { playGame } from '../src/sim/game'
import type { SimEvent } from '../src/sim/log'

describe('encounters', () => {
  it('has fruits stop and chat while roaming', async () => {
    const game = await playGame({ seed: 5 })
    const chats = game.log.filter((e) => e.kind === 'chat')
    expect(chats.length).toBeGreaterThan(5)
    // Gossip: some pairs trade lines back and forth.
    const pairs = new Set(chats.map((e) => (e.kind === 'chat' ? `${e.who}>${e.to}` : '')))
    expect([...pairs].some((p) => pairs.has(p.split('>').reverse().join('>')))).toBe(true)
  })

  it('passes a rumour from one fruit to another, traceable in the log', async () => {
    // A retold rumour names who it was first heard from. Find one whose teller heard it from
    // the named source earlier in the same game.
    let traced = false
    for (let seed = 1; seed <= 20 && !traced; seed++) {
      const game = await playGame({ seed })
      const chats = game.log.filter((e): e is Extract<SimEvent, { kind: 'chat' }> => e.kind === 'chat')
      for (const retold of chats.filter((c) => c.source && c.claim?.kind === 'saw')) {
        const first = chats.find((c) => c.who === retold.source && c.to === retold.who && c.t <= retold.t && c.claim?.kind === 'saw')
        if (first) {
          traced = true
          break
        }
      }
    }
    expect(traced).toBe(true)
  })

  it('stays deterministic with chats on', async () => {
    const a = await playGame({ seed: 9 })
    const b = await playGame(createGame({ seed: 9 }))
    expect(JSON.stringify(a.log)).toBe(JSON.stringify(b.log))
  })
})
