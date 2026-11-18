import { describe, expect, it } from 'vitest'
import { bayesianBeliefs } from '../src/sim/brains/bayesian'
import { deathWindow, grudges, mustVote, storyBreaks, trustScores } from '../src/sim/brains/reasoning'
import { suspicionOfMe } from '../src/sim/brains/rottenMind'
import { voice, witnessLine } from '../src/sim/brains/speak'
import type { Claim, MeetingView } from '../src/sim/brains/types'
import { createGame } from '../src/sim/engine'
import type { Game, PublicEvent } from '../src/sim/engine'
import { repairLine } from '../src/sim/meeting'
import { ARCHETYPES, archetypeOf } from '../src/sim/personality'
import { makeRng } from '../src/sim/rng'
import { viewFor } from '../src/sim/view'

type Where = Extract<Claim, { kind: 'where' }>
const where = (room: string, from: number, to: number, w: string[] = []): Where => ({ kind: 'where', room, from, to, with: w })
const line = (t: number, who: string, move: string, target?: string, claim?: Claim): PublicEvent => ({ t, kind: 'line', who, move, target, claim, say: '' })

function setup(seed = 3, rotten = 1): { game: Game; crew: Game['fruits']; bad: Game['fruits'] } {
  const game = createGame({ seed, rules: { rotten } })
  return { game, crew: game.fruits.filter((f) => f.role === 'crew'), bad: game.fruits.filter((f) => f.role === 'rotten') }
}

describe('stories that must hold up', () => {
  it('catches two alibis for the same time that name different rooms', () => {
    const { game, crew } = setup()
    const [me, liar, honest] = crew
    game.public.push(line(60, liar.id, 'alibi', undefined, where('lab', 20, 50)))
    game.public.push(line(120, liar.id, 'defend', liar.id, where('electrical', 30, 45)))
    // The same room twice, or a hallway next to it, is not a changed story.
    game.public.push(line(60, honest.id, 'alibi', undefined, where('cafeteria', 20, 50)))
    game.public.push(line(120, honest.id, 'defend', honest.id, where('cafeteria', 25, 40)))
    const breaks = storyBreaks(viewFor(game, me))
    expect(breaks.get(liar.id)?.length).toBe(1)
    expect(breaks.has(honest.id)).toBe(false)
  })

  it('makes the Bayesian brain far more suspicious of a fruit whose story changed', () => {
    const { game, crew } = setup()
    const [me, liar] = crew
    const before = bayesianBeliefs(viewFor(game, me))[liar.id]
    game.public.push(line(60, liar.id, 'alibi', undefined, where('lab', 20, 50)))
    game.public.push(line(120, liar.id, 'defend', liar.id, where('electrical', 30, 45)))
    expect(bayesianBeliefs(viewFor(game, me))[liar.id]).toBeGreaterThan(before * 2)
  })
})

describe('trust', () => {
  it('stops trusting a fruit that stood up for a Rotten who was then caught', () => {
    const { game, crew, bad } = setup()
    const [me, friend, other] = crew
    game.public.push(line(60, friend.id, 'vouch', bad[0].id))
    game.public.push({ t: 70, kind: 'eject', who: bad[0].id, role: 'rotten' })
    const trust = trustScores(viewFor(game, me))
    expect(trust[friend.id]).toBeLessThan(0.4)
    expect(trust[other.id]).toBeGreaterThan(0.7)
  })

  it('remembers who accused it and who defended it', () => {
    const { game, crew } = setup()
    const [me, enemy, ally] = crew
    game.public.push(line(60, enemy.id, 'accuse', me.id))
    game.public.push(line(61, ally.id, 'vouch', me.id))
    const g = grudges(viewFor(game, me))
    expect(g.against[enemy.id]).toBe(1)
    expect(g.for[ally.id]).toBe(1)
  })
})

describe('the time of death', () => {
  it('starts the window when the victim was last known alive, such as voting in a meeting', () => {
    const { game, crew } = setup()
    const [me, victim] = crew
    game.public.push({ t: 80, kind: 'vote', voter: victim.id, target: 'skip' })
    const [w0, w1] = deathWindow(viewFor(game, me), { victim: victim.id, room: 'lab', found: 150 })
    expect(w0).toBe(80)
    expect(w1).toBe(150)
  })
})

describe('the endgame', () => {
  it('knows when a skip could lose the game', () => {
    const { game, crew } = setup()
    const view = viewFor(game, crew[0])
    expect(mustVote(view, 4)).toBe(true)
    expect(mustVote(view, 3)).toBe(true)
    expect(mustVote(view, 6)).toBe(false)
  })
})

describe('two Rotten', () => {
  it('suspects two fruits more together once they keep vouching for each other', () => {
    const { game, crew } = setup(5, 2)
    const [me, a, b] = crew
    const before = bayesianBeliefs(viewFor(game, me))
    game.public.push(line(60, a.id, 'vouch', b.id), line(61, b.id, 'vouch', a.id), line(62, a.id, 'corroborate', b.id))
    const after = bayesianBeliefs(viewFor(game, me))
    expect(after[a.id]).toBeGreaterThan(before[a.id])
    expect(after[b.id]).toBeGreaterThan(before[b.id])
    // Still adds up to the two Rotten out there.
    expect(Object.values(after).reduce((x, y) => x + y, 0)).toBeCloseTo(2, 1)
  })
})

describe('witnesses', () => {
  const meeting = (game: Game, who: string, claim: Where): MeetingView => ({
    reason: 'body',
    caller: who,
    step: 'open',
    lines: [],
    living: game.fruits.filter((f) => f.alive).map((f) => f.id),
    checks: [],
    confirm: { who, claim },
  })

  it('backs up a story it saw for itself, and denies one it saw otherwise', () => {
    const { game, crew } = setup()
    const [me, them] = crew
    me.memory.push({ id: 900, kind: 'seen', who: them.id, room: 'lab', from: 30, to: 45, confidence: 1, halfLife: 600 })
    game.time = 60
    const yes = witnessLine(viewFor(game, me), meeting(game, them.id, where('lab', 25, 50)), makeRng(1))
    expect(yes?.move).toBe('corroborate')
    expect(yes?.claim?.kind).toBe('where')
    const no = witnessLine(viewFor(game, me), meeting(game, them.id, where('electrical', 25, 50)), makeRng(1))
    expect(no?.move).toBe('contradict')
  })

  it('keeps a named witness only if it is someone else still at the table', () => {
    const { game, crew } = setup()
    const [me, them] = crew
    const ok = repairLine(game, me, { move: 'defend', target: me.id, say: 'Ask them.', claim: where('lab', 1, 2), witness: them.id })
    expect(ok.witness).toBe(them.id)
    const self = repairLine(game, me, { move: 'defend', target: me.id, say: 'Ask me.', witness: me.id })
    expect(self.witness).toBeUndefined()
  })
})

describe('the thinking Rotten', () => {
  it('reckons whoever accused it suspects it most', () => {
    const { game, crew, bad } = setup()
    const [accuser, quiet] = crew
    game.public.push(line(60, accuser.id, 'accuse', bad[0].id))
    const s = suspicionOfMe(viewFor(game, bad[0]))
    expect(s[accuser.id]).toBeGreaterThan(s[quiet.id])
  })
})

describe('personalities', () => {
  it('recognises each archetype from its own sliders', () => {
    const { crew } = setup()
    for (const a of ARCHETYPES) expect(archetypeOf({ ...crew[0].def.traits, ...a.traits, temper: a.temper })?.id).toBe(a.id)
  })

  it('has a hothead shout its accusations', () => {
    const { game, crew } = setup()
    const [me, them] = crew
    me.def.traits = { ...me.def.traits, aggression: 1 }
    const said = Array.from({ length: 12 }, (_, i) => voice(viewFor(game, me), { move: 'accuse', target: them.id, say: `I think it was ${them.def.name}. Call it a hunch.` }, makeRng(i)).say)
    expect(said.some((s) => /[A-Z]{3,}|!/.test(s))).toBe(true)
  })
})
