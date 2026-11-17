import { describe, expect, it } from 'vitest'
import type { Brain, MeetingLine } from '../src/sim/brains/types'
import { createGame } from '../src/sim/engine'
import { playGame } from '../src/sim/game'
import type { SimEvent } from '../src/sim/log'
import { repairLine, runMeeting } from '../src/sim/meeting'

type Say = Extract<SimEvent, { kind: 'say' }>

describe('meetings', () => {
  it('has a fruit contradict another fruit\'s alibi in most runs of 20 games', async () => {
    // "Most 20-game runs": check several runs of 20 and require a meeting contradiction of an
    // alibi in at least 4 of 5. Each run is seeds 20k+1..20k+20.
    let runsWithOne = 0
    for (let run = 0; run < 5; run++) {
      let found = false
      for (let seed = run * 20 + 1; seed <= run * 20 + 20 && !found; seed++) {
        const game = await playGame({ seed })
        const says = game.log.filter((e): e is Say => e.kind === 'say')
        found = says.some((c) => c.line.move === 'contradict' && says.some((a) => a.who === c.line.target && a.line.claim?.kind === 'where' && a.t === c.t))
      }
      if (found) runsWithOne++
    }
    expect(runsWithOne).toBeGreaterThanOrEqual(4)
  })

  it('runs the meeting in order: reporter, roundup, open floor, vote', async () => {
    const game = createGame({ seed: 2 })
    while (game.phase === 'roam') {
      const { step } = await import('../src/sim/engine')
      step(game)
    }
    expect(game.phase).toBe('meeting')
    const start = game.log.length
    await runMeeting(game)
    const events = game.log.slice(start)
    const steps = events.filter((e): e is Say => e.kind === 'say').map((e) => e.step)
    const firstOpen = steps.indexOf('open')
    expect(steps[0]).toBe('report')
    expect(steps.slice(1, firstOpen).every((s) => s === 'roundup' || s === 'open')).toBe(true)
    expect(steps.filter((s) => s === 'open').length).toBeGreaterThanOrEqual(game.rules.discussionTurns)
    const lastSay = events.map((e) => e.kind).lastIndexOf('say')
    expect(events.findIndex((e) => e.kind === 'vote')).toBeGreaterThan(lastSay)
  })

  it('repairs illegal lines instead of throwing', () => {
    const game = createGame({ seed: 2 })
    const me = game.fruits[0]
    const bad = repairLine(game, me, { move: 'accuse', target: me.id, say: '' } as MeetingLine)
    expect(bad.move).toBe('pass')
    expect(bad.repaired).toBe(true)
    const nonsense = repairLine(game, me, { move: 'dance', target: 'nobody', say: 'hi', claim: { kind: 'where', room: 'moon', from: 0, to: 1 } } as unknown as MeetingLine)
    expect(nonsense.move).toBe('pass')
    expect(nonsense.claim).toBeUndefined()
  })

  it('survives a brain that throws or returns nonsense', async () => {
    const game = createGame({ seed: 6 })
    for (const f of game.fruits) {
      const brain = game.brains.get(f.id)!
      const broken: Brain = {
        kind: brain.kind,
        roam: brain.roam.bind(brain),
        chat: brain.chat.bind(brain),
        beliefs: brain.beliefs.bind(brain),
        speak: async () => {
          throw new Error('boom')
        },
        vote: async () => ({ target: 'nobody', reason: 42 }) as never,
      }
      game.brains.set(f.id, broken)
    }
    await playGame(game)
    expect(game.winner).toBeTruthy()
  })
})
