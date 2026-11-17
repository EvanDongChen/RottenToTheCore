import { setAction } from './actions'
import { stockChat } from './brains/dialog'
import type { ChatContext, Claim } from './brains/types'
import { bendRetelling, checkStory, checkWhere, hear } from './claims'
import { fruitById, logEvent } from './engine'
import type { Game, SimFruit } from './engine'
import { round } from './log'
import { dist, station } from './map'
import { feel } from './mind'
import { sees } from './perception'
import { rottenAlibi, rottenRumour } from './rotten'
import { viewFor } from './view'
import type { FruitView } from './view'
import { addSighting } from './witness'

/**
 * Fruits talking between meetings. Only the fruits in a conversation hear it, so what each one
 * knows going into a meeting is different. The engine decides what is said and what each
 * listener takes away; brains only put it into words.
 */

/** Two walkers this close, who can both see each other, have met in passing. */
const PASS_RANGE = 2
/** A pair doesn't chat in passing again for this long. */
const PAIR_COOLDOWN = 30
/** Chance per tick that two fruits working in the same room strike up a chat. */
const TASK_CHAT_CHANCE = 0.012
const LINE_GAP = 1.5
/** A fruit noticing it has been tailed this long gets scared. */
const TAILED_NOTICE = 6

/** A line waiting to be said, a moment after the one before it. */
export interface QueuedLine {
  at: number
  who: string
  to: string
  ctx: ChatContext
  /** The confidence the speaker has in what it is telling. */
  confidence: number
  /** For a retold rumour: who it was first heard from. */
  source?: string
}

const queues = new WeakMap<Game, QueuedLine[]>()
const tailing = new WeakMap<Game, Map<string, number>>()
const lightsWere = new WeakMap<Game, boolean>()

function queue(game: Game): QueuedLine[] {
  let q = queues.get(game)
  if (!q) queues.set(game, (q = []))
  return q
}

/** Lines still waiting to be said (for tests and the screen). */
export function pendingLines(game: Game): readonly QueuedLine[] {
  return queue(game)
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

function beliefOf(f: SimFruit, other: string, game: Game): number {
  return f.mind.beliefs[other] ?? game.rules.rotten / Math.max(1, game.fruits.length - 1)
}

/** Once per tick: start new encounters, say queued lines, and notice tails. */
export function encounters(game: Game) {
  sayQueued(game)
  lightsReaction(game)
  noticeTails(game)

  const living = game.fruits.filter((f) => f.alive && game.time >= f.busyUntil)
  for (let i = 0; i < living.length; i++) {
    for (let j = i + 1; j < living.length; j++) {
      const a = living[i]
      const b = living[j]
      const key = pairKey(a.id, b.id)
      if ((game.encounterAt.get(key) ?? -Infinity) + PAIR_COOLDOWN > game.time) continue
      if (!sees(game, a.id, b.id) || !sees(game, b.id, a.id)) continue
      const passing = a.path.length > 0 && b.path.length > 0 && dist(a.pos, b.pos) < PASS_RANGE
      const working = !!a.working && !!b.working && a.area === b.area
      if (passing) {
        game.encounterAt.set(key, game.time)
        // Whose point of view the meeting is rolled from.
        const [x, y] = game.rng.chance(0.5) ? [a, b] : [b, a]
        hallway(game, x, y)
      } else if (working && game.rng.chance(TASK_CHAT_CHANCE)) {
        game.encounterAt.set(key, game.time)
        taskChat(game, a, b)
      }
    }
  }
}

type Outcome = 'nod' | 'quickLine' | 'gossip' | 'sideEye' | 'tail' | 'buddy' | 'hurry'

/** Two fruits meet in a hallway. One roll on what happens, weighted by personality and belief. */
function hallway(game: Game, a: SimFruit, b: SimFruit) {
  const ta = a.def.traits
  const tb = b.def.traits
  const belief = beliefOf(a, b.id, game)
  const trust = 1 - belief
  const fear = a.mind.mood.fear
  const rotten = a.role === 'rotten'
  const weights: [Outcome, number][] = [
    ['nod', 1],
    ['quickLine', ta.talkativeness * 1.2],
    ['gossip', ((ta.talkativeness + tb.talkativeness) / 2) * trust * 1.6],
    ['sideEye', !rotten && belief > 0.6 ? 2 : 0],
    ['tail', !rotten && ta.suspicion > 0.6 && belief > 0.7 ? 2 : 0],
    ['buddy', !rotten && trust > 0.8 && fear > 0.4 ? 1.5 : 0],
    ['hurry', !rotten && fear > 0.5 && belief > 0.4 ? 2 : 0],
  ]
  const total = weights.reduce((s, [, w]) => s + w, 0)
  let roll = game.rng.next() * total
  let outcome: Outcome = 'nod'
  for (const [o, w] of weights) {
    roll -= w
    if (roll < 0) {
      outcome = o
      break
    }
  }
  logEvent(game, { t: round(game.time), kind: 'encounter', a: a.id, b: b.id, what: outcome })

  switch (outcome) {
    case 'quickLine': {
      const goal = a.action.kind === 'goTask' || a.action.kind === 'fakeTask' ? station(a.action.station).room : a.action.kind === 'wander' ? a.action.room : a.area
      push(game, { at: game.time, who: a.id, to: b.id, ctx: { partner: b.id, setting: 'pass', topic: 'heading', room: goal }, confidence: 1 })
      break
    }
    case 'gossip': {
      // Both stop, face each other and trade a few lines.
      const lines = 2 + game.rng.int(3)
      const until = game.time + lines * LINE_GAP + 1
      for (const f of [a, b]) {
        f.busyUntil = until
        f.vel = [0, 0]
      }
      a.talkingTo = b.id
      b.talkingTo = a.id
      for (let i = 0; i < lines; i++) {
        const [s, l] = i % 2 ? [b, a] : [a, b]
        push(game, gossipLine(game, s, l, game.time + i * LINE_GAP, 'gossip'))
      }
      break
    }
    case 'tail':
      setAction(game, a, { kind: 'follow', who: b.id })
      a.decideAt = game.time + 12
      break
    case 'buddy':
      setAction(game, a, { kind: 'follow', who: b.id })
      a.decideAt = game.time + 20
      break
    case 'hurry':
      a.hurryUntil = game.time + 4
      feel(a.mind, 'fear', 0.05)
      break
  }
}

/** Two fruits working in the same room chat while the bars keep filling. */
function taskChat(game: Game, a: SimFruit, b: SimFruit) {
  const lines = 1 + game.rng.int(3)
  for (let i = 0; i < lines; i++) {
    const [s, l] = i % 2 ? [b, a] : [a, b]
    push(game, gossipLine(game, s, l, game.time + i * LINE_GAP, 'task'))
  }
}

/** What one fruit says to another: a rumour if it has one worth telling, otherwise chatter. */
function gossipLine(game: Game, s: SimFruit, l: SimFruit, at: number, setting: 'gossip' | 'task'): QueuedLine {
  const base = { at, who: s.id, to: l.id }
  const view = viewFor(game, s)
  const share = s.role === 'rotten' ? rottenRumour(view, l.id, s.rng) : bestShare(view, l.id)
  if (share && s.rng.chance(setting === 'gossip' ? 0.75 : 0.5)) {
    const claim = share.source ? bendRetelling(game, share.claim, s.rng) : share.claim
    return { ...base, ctx: { partner: l.id, setting, topic: 'rumour', claim, confidence: share.confidence }, confidence: share.confidence, source: share.source }
  }
  const t = s.def.traits
  const belief = Object.entries(s.mind.beliefs).filter(([id]) => id !== l.id && fruitById(game, id)?.alive).sort((x, y) => y[1] - x[1])[0]
  const options: [ChatContext['topic'], number][] = [
    ['smallTalk', 1],
    ['progress', setting === 'task' ? 1.2 : 0.4],
    ['where', 1.2],
    ['pact', setting === 'task' && s.area === l.area ? 0.8 + (s.role === 'rotten' ? 0.8 : 0) : 0],
    ['accuse', s.role === 'crew' && belief && belief[1] > 0.5 ? 1 + t.suspicion : 0],
  ]
  const total = options.reduce((x, [, w]) => x + w, 0)
  let roll = s.rng.next() * total
  let topic: ChatContext['topic'] = 'smallTalk'
  for (const [o, w] of options) {
    roll -= w
    if (roll < 0) {
      topic = o
      break
    }
  }
  const ctx: ChatContext = { partner: l.id, setting, topic }
  if (topic === 'progress') ctx.left = s.role === 'crew' ? s.tasks.filter((x) => !x.done).length : 1 + s.rng.int(3)
  if (topic === 'accuse') ctx.about = belief![0]
  if (topic === 'pact') {
    ctx.room = s.area
    ctx.claim = { kind: 'where', room: s.area, from: Math.max(0, game.time - 20), to: game.time + 10, with: [l.id] }
  }
  if (topic === 'where') {
    const claim = s.role === 'rotten' ? rottenAlibi(view, s.rng) : honestWhere(view)
    if (claim) ctx.claim = claim
    else ctx.topic = 'smallTalk'
  }
  return { ...base, ctx, confidence: 0.9 }
}

/** Where a crew fruit was on its last stop, and who it remembers seeing there. */
function honestWhere(view: FruitView): Claim | null {
  const stops = view.trail.filter((t) => t.to - t.from > 3 && t.area !== view.area)
  const last = stops.at(-1)
  if (!last) return null
  const met = [...new Set(view.memory.filter((m) => m.kind === 'seen' && m.room === last.area && m.from <= last.to && m.to >= last.from && m.now > 0.5).map((m) => m.who))]
  return { kind: 'where', room: last.area, from: Math.round(last.from), to: Math.round(last.to), with: met.slice(0, 2) }
}

/** The juiciest thing this fruit could tell the listener: a sighting or rumour about someone else. */
function bestShare(view: FruitView, listener: string): { claim: Claim; confidence: number; source?: string } | null {
  const SCORE: Record<string, number> = { kill: 10, vented: 9, nearBody: 5, fakeTask: 4, atTask: 1.5 }
  let best: { claim: Claim; confidence: number; source?: string; score: number } | null = null
  for (const m of view.memory) {
    // Below 0.4 a fruit stays quiet unless asked.
    if (m.now < 0.4 || m.who === listener || m.who === view.id) continue
    if (!view.others.find((o) => o.id === m.who)?.alive) continue
    const what = m.kind === 'heard' ? m.told : m.kind
    if (!what || !(what in SCORE) || (what === 'atTask' && !m.sawEffect && m.kind !== 'heard')) continue
    const score = SCORE[what] * m.now * (m.kind === 'heard' ? 0.6 : 1)
    if (best && score <= best.score) continue
    best = {
      claim: { kind: 'saw', what: what as Exclude<Claim, { kind: 'where' }>['what'], who: m.who, room: m.room, at: Math.round(m.from), victim: m.victim },
      confidence: m.now,
      source: m.kind === 'heard' ? m.source : undefined,
      score,
    }
  }
  return best
}

function push(game: Game, line: QueuedLine) {
  const q = queue(game)
  q.push(line)
  // Said in time order; stable for lines due at the same moment.
  q.sort((x, y) => x.at - y.at)
}

/** Say every queued line that is due. */
function sayQueued(game: Game) {
  const q = queue(game)
  while (q.length && q[0].at <= game.time + 1e-9) deliver(game, q.shift()!)
}

/** One line is said out loud; the listener takes away what it can. */
function deliver(game: Game, item: QueuedLine) {
  const s = fruitById(game, item.who)!
  const l = fruitById(game, item.to)!
  if (!s.alive || !l.alive) return
  const view = viewFor(game, s)
  const line = stockChat(view, item.ctx, s.rng)
  game.stats.chats++
  if (item.source) game.stats.rumours++
  logEvent(game, { t: round(game.time), kind: 'chat', who: s.id, to: l.id, say: line.say, topic: item.ctx.topic, accuses: line.accuses, vouches: line.vouches, claim: line.claim, source: item.source })
  game.onChat?.(s.id, item.ctx, view)

  const claim = item.ctx.claim
  if (claim) {
    s.ledger.push({ t: game.time, claim })
    if (claim.kind === 'where') {
      // Does the listener remember otherwise, or has it heard a different story before?
      const check = checkWhere(game, l, s.id, claim)
      const story = checkStory(l, s.id, claim)
      if (check?.result === 'conflict' || story) {
        l.mind.caught[s.id] = (l.mind.caught[s.id] ?? 0) + 1
        game.stats.contradictions++
        logEvent(game, { t: round(game.time), kind: 'react', who: l.id, to: s.id, how: 'contradict', bent: !!check?.bent })
      }
      hear(game, l, s, claim, item.confidence)
    } else if (claim.who === l.id) {
      // Told to its face that it did something it didn't: the teller is lying or wrong.
      if (l.role === 'crew') l.mind.caught[s.id] = (l.mind.caught[s.id] ?? 0) + 0.5
      feel(l.mind, 'anger', 0.2)
    } else hear(game, l, s, claim, item.confidence, item.source ? { source: s.id } : {})
  }
  if (item.ctx.topic === 'accuse' && item.ctx.about && item.ctx.about !== l.id) {
    addSighting(game, l, { kind: 'heard', told: 'accuse', who: item.ctx.about, source: s.id, room: l.area, confidence: 0.6 * (1 - (l.mind.beliefs[s.id] ?? 0.2)) })
  }
}

/** When the lights go out, frightened fruits say so. */
function lightsReaction(game: Game) {
  const was = lightsWere.get(game) ?? false
  lightsWere.set(game, game.lightsOut)
  if (!game.lightsOut || was) return
  for (const f of game.fruits) {
    if (!f.alive || f.role !== 'crew' || f.mind.mood.fear + (1 - f.def.traits.aggression) * 0.4 < 0.5) continue
    if (f.rng.chance(0.6)) push(game, { at: game.time + f.rng.range(0.2, 1.5), who: f.id, to: f.id, ctx: { partner: f.id, setting: 'pass', topic: 'fear' }, confidence: 1 })
  }
}

/** A fruit that keeps seeing the same fruit behind it notices it is being followed. */
function noticeTails(game: Game) {
  let tails = tailing.get(game)
  if (!tails) tailing.set(game, (tails = new Map()))
  for (const f of game.fruits) {
    if (!f.alive || f.action.kind !== 'follow') continue
    const target = fruitById(game, f.action.who)!
    const key = `${f.id}>${target.id}`
    if (!target.alive || !sees(game, target.id, f.id)) {
      tails.delete(key)
      continue
    }
    const since = tails.get(key) ?? game.time
    tails.set(key, since)
    if (game.time - since >= TAILED_NOTICE && !target.mind.tailedBy.includes(f.id)) {
      target.mind.tailedBy.push(f.id)
      feel(target.mind, 'fear', 0.2)
      logEvent(game, { t: round(game.time), kind: 'encounter', a: target.id, b: f.id, what: 'noticedTail' })
    }
  }
}

/** A meeting interrupts every conversation. */
export function clearChats(game: Game) {
  queue(game).length = 0
  for (const f of game.fruits) f.talkingTo = null
}
