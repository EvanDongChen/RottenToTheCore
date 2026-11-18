import { describe, expect, it } from 'vitest'
import type { Ballot, Brain } from '../src/sim/brains/types'
import { checkWin, createGame, fruitById, step } from '../src/sim/engine'
import type { Game } from '../src/sim/engine'
import { playGame } from '../src/sim/game'
import { hashLog } from '../src/sim/log'
import { dist } from '../src/sim/map'
import { runVote } from '../src/sim/meeting'

/** Replace every brain's vote with a fixed ballot per fruit. */
function scriptVotes(game: Game, ballots: Record<string, string>) {
  for (const f of game.fruits) {
    const brain = game.brains.get(f.id)!
    const scripted: Brain = { ...brain, kind: brain.kind, roam: brain.roam.bind(brain), chat: brain.chat.bind(brain), speak: brain.speak.bind(brain), beliefs: brain.beliefs.bind(brain), vote: async (): Promise<Ballot> => ({ target: ballots[f.id] ?? 'skip', reason: '' }) }
    game.brains.set(f.id, scripted)
  }
  game.phase = 'meeting'
  game.meeting = { reason: 'emergency', caller: game.fruits[0].id, at: game.time }
}

describe('game rules', () => {
  it('replays a whole game identically from the same seed (golden replay)', async () => {
    const a = await playGame({ seed: 77 })
    const b = await playGame({ seed: 77 })
    expect(a.winner).toBeTruthy()
    expect(hashLog(a.log)).toBe(hashLog(b.log))
  })

  it('only kills within range and after the cooldown', async () => {
    for (let seed = 1; seed <= 20; seed++) {
      const game = createGame({ seed })
      const lastKill = new Map<string, number>()
      const problems: string[] = []
      game.onEvent = (e) => {
        if (e.kind === 'kill') {
          const killer = fruitById(game, e.killer)!
          if (killer.role !== 'rotten') problems.push(`${e.killer} is not Rotten`)
          if (dist(killer.pos, e.at) > game.rules.killRange + 1e-3) problems.push(`kill from ${dist(killer.pos, e.at)} away`)
          const prev = lastKill.get(e.killer)
          if (prev !== undefined && game.time - prev < game.rules.killCooldown - 1e-6) problems.push('cooldown not respected')
          lastKill.set(e.killer, game.time)
        }
        // A meeting resets the knife to a full cooldown, so measure from there too.
        if (e.kind === 'meeting') for (const f of game.fruits) if (f.role === 'rotten') lastKill.set(f.id, game.time)
        if (e.kind === 'found' && !game.vision.bodies.get(e.who)?.includes(e.body)) problems.push(`${e.who} reported a body it cannot see`)
      }
      await playGame(game)
      expect(problems, `seed ${seed}`).toEqual([])
    }
  })

  it('ejects nobody on a tie', async () => {
    const game = createGame({ seed: 3 })
    const [a, b, ...rest] = game.fruits
    // a and b vote for each other; the other six split three and three: 4 against 4, no skips.
    scriptVotes(game, { [a.id]: b.id, [b.id]: a.id, ...Object.fromEntries(rest.map((f, i) => [f.id, i % 2 ? a.id : b.id])) })
    expect(await runVote(game, async () => {}, [])).toBeNull()
    expect(game.log.at(-1)).toMatchObject({ kind: 'noEject', tie: true, skips: 0 })
  })

  it('ejects nobody when skip has as many votes as the leader', async () => {
    const game = createGame({ seed: 3 })
    const [a, b, c, d] = game.fruits
    scriptVotes(game, { [a.id]: b.id, [b.id]: 'skip', [c.id]: b.id, [d.id]: 'skip' })
    // Everyone else skips too, so skip wins outright.
    expect(await runVote(game, async () => {}, [])).toBeNull()
  })

  it('ejects the fruit with the most votes when it beats skip', async () => {
    const game = createGame({ seed: 3 })
    const target = game.fruits[1]
    scriptVotes(game, Object.fromEntries(game.fruits.map((f) => [f.id, f === target ? 'skip' : target.id])))
    expect((await runVote(game, async () => {}, []))?.id).toBe(target.id)
  })

  it('gives the crew the win when every task is done', () => {
    const game = createGame({ seed: 4 })
    for (const f of game.fruits) if (f.role === 'crew') for (const t of f.tasks) t.done = true
    step(game)
    expect(game.winner).toBe('crew')
    expect(game.how).toBe('tasks')
  })

  it('gives the crew the win when every Rotten is gone', () => {
    const game = createGame({ seed: 4, rules: { rotten: 2 } })
    for (const f of game.fruits) if (f.role === 'rotten') f.alive = false
    expect(checkWin(game)).toBe(true)
    expect(game.winner).toBe('crew')
  })

  it('gives the Rotten the win at half the living fruits', () => {
    const game = createGame({ seed: 4 })
    const crew = game.fruits.filter((f) => f.role === 'crew')
    // 8 fruits, 1 Rotten: kill crew until it is 1 Rotten against 1 crew.
    crew.slice(0, crew.length - 2).forEach((f) => (f.alive = false))
    expect(checkWin(game)).toBe(false)
    crew[crew.length - 2].alive = false
    expect(checkWin(game)).toBe(true)
    expect(game.winner).toBe('rotten')
  })
})

describe('replays', () => {
  it('plays the same game again from the setup in its log', async () => {
    const { createGame: make } = await import('../src/sim/engine')
    const first = await playGame({ seed: 21, brains: { crew: 'bayesian' } })
    const start = first.log[0]
    if (start.kind !== 'start') throw new Error('no start event')
    const again = await playGame(make(start.setup))
    expect(hashLog(again.log)).toBe(hashLog(first.log))
  })
})
