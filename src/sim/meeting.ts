import { stop } from './actions'
import { lastWordsFor } from './brains/speak'
import type { Ballot, Claim, MeetingCheck, MeetingLine, MeetingView, Move } from './brains/types'
import { checkStory, checkWhere, hear } from './claims'
import { BUTTON_COOLDOWN } from './constants'
import { clearChats } from './encounters'
import { checkWin, fruitById, logEvent, seatPos } from './engine'
import type { Game, SimFruit } from './engine'
import { round } from './log'
import { AREAS, areaAt } from './map'
import { confidence, recall } from './memory'
import { feel } from './mind'
import { viewFor } from './view'
import { addSighting } from './witness'

/**
 * A meeting, one turn at a time. Every fruit hears every line, so each line can change the next
 * speaker's mind. Roam time is paused throughout. `pace` is how the caller lets time pass between
 * turns: the browser waits so viewers can read, headless runs don't wait at all.
 */
export type Pace = (simSeconds: number) => Promise<void>

export const noPace: Pace = async () => {}

const MOVES: Move[] = ['report', 'alibi', 'accuse', 'defend', 'vouch', 'question', 'corroborate', 'contradict', 'hardClaim', 'bandwagon', 'skip', 'pass']
/** Moves that point at someone else. */
const TARGETED: Move[] = ['accuse', 'vouch', 'question', 'corroborate', 'contradict', 'hardClaim', 'bandwagon']
/** Moves that put a fruit on the spot until it answers. */
const AGAINST: Move[] = ['accuse', 'hardClaim', 'contradict', 'bandwagon', 'question']

/** Meeting state that only lives as long as the meeting. */
interface Talk {
  lines: MeetingView['lines']
  /** Per listener: its unspoken reactions to claims so far. */
  checks: Map<string, MeetingCheck[]>
  /** Fruits with an accusation they have not answered yet. */
  unanswered: Set<string>
  /** Fruits accused using a memory that had bent. */
  bentAgainst: Set<string>
  /** How many times each fruit has spoken. */
  spoke: Map<string, number>
  /** Who must speak next, who asked them, and what about: a moment, or a story to back up. */
  asked: { who: string; by: string; at?: number; confirm?: MeetingView['confirm'] } | null
}

/** Seat everyone at the table and clear the floor. */
function gather(game: Game) {
  const living = game.fruits.filter((f) => f.alive)
  living.forEach((f, i) => {
    f.pos = seatPos(i, living.length)
    f.area = areaAt(f.pos)
    f.trail.push({ area: f.area, from: game.time, to: game.time })
    stop(f)
    f.vel = [0, 0]
    f.action = { kind: 'idle' }
    f.working = null
    f.busyUntil = 0
    f.talkingTo = null
  })
  // After a meeting everybody knows who is missing.
  for (const f of game.fruits) {
    if (!f.alive && !game.publicDead.has(f.id)) {
      game.publicDead.add(f.id)
      game.public.push({ t: game.time, kind: 'dead', who: f.id })
    }
  }
  game.bodies = []
  clearChats(game)
}

export function meetingView(game: Game, step: MeetingView['step'], lines: MeetingView['lines'] = [], askedBy?: string, checks: MeetingCheck[] = [], ask: { at?: number; confirm?: MeetingView['confirm'] } = {}): MeetingView {
  const m = game.meeting!
  return {
    reason: m.reason,
    caller: m.caller,
    body: m.body ? { victim: m.body.id, room: m.body.area } : undefined,
    step,
    lines: [...lines],
    askedBy,
    askedAt: ask.at,
    confirm: ask.confirm,
    living: game.fruits.filter((f) => f.alive).map((f) => f.id),
    checks: [...checks],
  }
}

const living = (game: Game, id: string | undefined) => !!id && !!game.fruits.find((f) => f.id === id && f.alive)

function repairClaim(game: Game, c: Claim | undefined): Claim | undefined {
  if (!c || typeof c !== 'object') return undefined
  const areaOk = typeof c.room === 'string' && AREAS.some((a) => a.id === c.room)
  if (!areaOk) return undefined
  if (c.kind === 'where') {
    if (!Number.isFinite(c.from) || !Number.isFinite(c.to)) return undefined
    return { kind: 'where', room: c.room, from: Math.min(c.from, c.to), to: Math.max(c.from, c.to), with: (c.with ?? []).filter((id) => game.fruits.some((f) => f.id === id)).slice(0, 3) }
  }
  if (c.kind === 'saw') {
    if (!game.fruits.some((f) => f.id === c.who) || !Number.isFinite(c.at)) return undefined
    const what = ['seen', 'passed', 'atTask', 'fakeTask', 'nearBody', 'vented', 'kill'].includes(c.what) ? c.what : 'seen'
    return { kind: 'saw', what, who: c.who, room: c.room, at: c.at, victim: c.victim && game.fruits.some((f) => f.id === c.victim) ? c.victim : undefined }
  }
  return undefined
}

/** Make a line legal: a known move, a living target other than the speaker, a well-formed claim. Never throws. */
export function repairLine(game: Game, speaker: SimFruit, line: MeetingLine | undefined): MeetingLine & { repaired: boolean } {
  let repaired = false
  if (!line || typeof line !== 'object') return { move: 'pass', say: '…', repaired: true }
  let move: Move = MOVES.includes(line.move) ? line.move : 'pass'
  if (move !== line.move) repaired = true
  let target = line.target
  if (TARGETED.includes(move) && (!living(game, target) || target === speaker.id)) {
    repaired = true
    target = undefined
    move = 'pass'
  }
  if (!TARGETED.includes(move) && move !== 'defend') target = undefined
  const claim = repairClaim(game, line.claim)
  if (line.claim && !claim) repaired = true
  const say = typeof line.say === 'string' && line.say.trim() ? line.say.trim().slice(0, 240) : '…'
  // A witness must be someone else at the table; a question's moment must be a time already past.
  const witness = (move === 'defend' || move === 'alibi') && living(game, line.witness) && line.witness !== speaker.id ? line.witness : undefined
  const at = move === 'question' && Number.isFinite(line.at) && line.at! >= 0 && line.at! <= game.time ? Math.round(line.at!) : undefined
  return { move, target, claim, say, repaired, ...(witness ? { witness } : {}), ...(at !== undefined ? { at } : {}) }
}

/** Make a ballot legal: a living fruit other than the voter, or skip. */
export function repairBallot(game: Game, voter: SimFruit, b: Ballot | undefined): Ballot {
  const target = b?.target
  const ok = target === 'skip' || game.fruits.some((f) => f.id === target && f.alive && f.id !== voter.id)
  return { target: ok ? target! : 'skip', reason: typeof b?.reason === 'string' ? b.reason.slice(0, 160) : '' }
}

/** Seconds a line stays up for reading, at 1x. */
function readTime(say: string) {
  return 1.6 + say.length * 0.045
}

/** Ask one fruit for its turn, make it legal, say it, and let everyone take it in. */
async function turn(game: Game, talk: Talk, f: SimFruit, step: MeetingView['step'], pace: Pace) {
  const brain = game.brains.get(f.id)!
  const ask = talk.asked?.who === f.id ? talk.asked : null
  const askedBy = ask?.by
  if (ask) talk.asked = null
  let raw: MeetingLine | undefined
  game.onThinking?.(f.id, true)
  try {
    raw = await brain.speak(viewFor(game, f), meetingView(game, step, talk.lines, askedBy, talk.checks.get(f.id), { at: ask?.at, confirm: ask?.confirm }))
  } catch {
    raw = undefined
  }
  game.onThinking?.(f.id, false)
  const { repaired, ...line } = repairLine(game, f, raw)
  if (repaired) game.stats.repairedLines = (game.stats.repairedLines ?? 0) + 1
  talk.lines.push({ who: f.id, line })
  talk.spoke.set(f.id, (talk.spoke.get(f.id) ?? 0) + 1)
  const t = round(game.time)
  game.public.push({ t, kind: 'line', who: f.id, move: line.move, target: line.target, claim: line.claim, say: line.say })
  logEvent(game, { t, kind: 'say', who: f.id, line, step })
  absorbLine(game, talk, f, line)
  await pace(readTime(line.say))
}

/** Everyone takes in a line: claims are stored and checked, accusations noted. */
function absorbLine(game: Game, talk: Talk, speaker: SimFruit, line: MeetingLine) {
  const t = game.time
  if (line.claim) speaker.ledger.push({ t, claim: line.claim })
  // Whatever this fruit had to say about earlier claims, it has now said.
  if (line.move === 'contradict' || line.move === 'corroborate' || line.move === 'defend') {
    talk.checks.set(speaker.id, (talk.checks.get(speaker.id) ?? []).filter((c) => c.speaker !== line.target))
  }
  if (line.move === 'defend' || line.move === 'alibi') talk.unanswered.delete(speaker.id)
  if (line.target && AGAINST.includes(line.move)) talk.unanswered.add(line.target)
  if (line.move === 'question' && line.target) talk.asked = { who: line.target, by: speaker.id, at: line.at }
  // "Ask Kiwi": the named witness must say whether the story holds.
  if (line.witness && line.claim?.kind === 'where') talk.asked = { who: line.witness, by: speaker.id, confirm: { who: speaker.id, claim: line.claim } }

  for (const l of game.fruits) {
    if (!l.alive || l === speaker) continue
    const claim = line.claim
    if (claim?.kind === 'where') {
      // An alibi: check it against what this listener saw, and anything it heard before.
      const check = checkWhere(game, l, speaker.id, claim)
      const story = checkStory(l, speaker.id, claim)
      if (story) {
        l.mind.caught[speaker.id] = (l.mind.caught[speaker.id] ?? 0) + 1
        game.stats.contradictions++
      }
      if (check) {
        const m = recall(check.memory)
        const mine: Claim = { kind: 'saw', what: 'seen', who: speaker.id, room: m.room, at: Math.round((m.from + m.to) / 2) }
        const list = talk.checks.get(l.id) ?? []
        list.push({ speaker: speaker.id, how: check.result, claim, mine, confidence: confidence(check.memory, t) })
        talk.checks.set(l.id, list)
        if (check.result === 'conflict') {
          l.mind.caught[speaker.id] = (l.mind.caught[speaker.id] ?? 0) + 1
          if (check.bent) talk.bentAgainst.add(speaker.id)
        }
      }
      if (claim.room) hear(game, l, speaker, claim, 0.9)
    } else if (claim?.kind === 'saw') {
      if (claim.who === l.id) {
        // Said about me, and I know it's not true.
        if (l.role === 'crew' && claim.what !== 'atTask' && claim.what !== 'seen') {
          l.mind.caught[speaker.id] = (l.mind.caught[speaker.id] ?? 0) + 1
          feel(l.mind, 'anger', 0.25)
        }
      } else {
        hear(game, l, speaker, claim, line.move === 'hardClaim' ? 1 : 0.85)
        // Someone else claims to have seen what I saw: that is a match worth saying.
        const mineToo = l.memory.find((m) => m.kind === claim.what && recall(m).who === claim.who && confidence(m, t) > 0.6)
        if (mineToo && claim.what !== 'seen') {
          const list = talk.checks.get(l.id) ?? []
          list.push({ speaker: speaker.id, how: 'match', claim, mine: claim, confidence: confidence(mineToo, t) })
          talk.checks.set(l.id, list)
        }
      }
    }
    if (line.target && line.target !== l.id) {
      if (line.move === 'accuse' || line.move === 'bandwagon' || line.move === 'contradict') {
        addSighting(game, l, { kind: 'heard', told: 'accuse', who: line.target, source: speaker.id, room: l.area, confidence: 0.7 })
      } else if (line.move === 'vouch' || line.move === 'corroborate') {
        // Backing up someone's story is a mild vouch for them.
        addSighting(game, l, { kind: 'heard', told: 'vouch', who: line.target, source: speaker.id, room: l.area, confidence: line.move === 'vouch' ? 0.7 : 0.4 })
      }
    }
    if (line.target === l.id && AGAINST.includes(line.move)) {
      feel(l.mind, 'anger', 0.15 + l.def.traits.aggression * 0.15)
      feel(l.mind, 'fear', 0.1 + (1 - l.def.traits.aggression) * 0.15)
    }
  }
  if (line.move === 'contradict' && line.target) {
    game.stats.contradictions++
    logEvent(game, { t: round(t), kind: 'react', who: speaker.id, to: line.target, how: 'contradict', bent: talk.bentAgainst.has(line.target) })
    // Listeners who trust the contradicter count it as the target caught out.
    for (const l of game.fruits) {
      if (!l.alive || l === speaker || l.id === line.target) continue
      const trust = 1 - (l.mind.beliefs[speaker.id] ?? 0.2)
      l.mind.caught[line.target] = (l.mind.caught[line.target] ?? 0) + trust * 0.6
    }
  }
}

/** Who speaks next on the open floor, by weight: chatty fruits, the accused, those with evidence or something to react to. */
function pickSpeaker(game: Game, talk: Talk): SimFruit {
  const living = game.fruits.filter((f) => f.alive)
  if (talk.asked) {
    const asked = fruitById(game, talk.asked.who)
    if (asked?.alive) return asked
    talk.asked = null
  }
  const last = talk.lines.at(-1)?.who
  const weights = living.map((f) => {
    if (f.id === last) return 0
    let w = 0.4 + f.def.traits.talkativeness * 1.2
    if (talk.unanswered.has(f.id)) w += 3
    if ((talk.checks.get(f.id) ?? []).some((c) => c.how !== 'match')) w += 2.5
    else if ((talk.checks.get(f.id)?.length ?? 0) > 0) w += 1
    if (f.memory.some((m) => (m.kind === 'kill' || m.kind === 'vented') && confidence(m, game.time) > 0.6)) w += 2
    // Nobody hogs the floor.
    w /= 1 + (talk.spoke.get(f.id) ?? 0) * 0.5
    return w
  })
  const total = weights.reduce((a, b) => a + b, 0)
  let roll = game.rng.next() * total
  for (let i = 0; i < living.length; i++) {
    roll -= weights[i]
    if (roll < 0) return living[i]
  }
  return living.find((f) => f.id !== last) ?? living[0]
}

/** The discussion: the reporter, then where everyone was, then the open floor, then a last call. */
async function discuss(game: Game, talk: Talk, pace: Pace) {
  const m = game.meeting!
  const caller = fruitById(game, m.caller)!
  // 1. The reporter speaks first.
  if (caller.alive) await turn(game, talk, caller, 'report', pace)
  // 2. Where was everyone? Most talkative first, with some randomness.
  const order = game.fruits
    .filter((f) => f.alive && f !== caller)
    .map((f) => ({ f, key: f.def.traits.talkativeness + game.rng.next() * 0.6 }))
    .sort((a, b) => b.key - a.key)
    .map((x) => x.f)
  for (const f of order) {
    if (game.phase !== 'meeting') return
    if (talk.asked) await turn(game, talk, pickSpeaker(game, talk), 'open', pace)
    await turn(game, talk, f, 'roundup', pace)
  }
  // 3. The open floor.
  for (let i = 0; i < game.rules.discussionTurns; i++) await turn(game, talk, pickSpeaker(game, talk), 'open', pace)
  // Anyone still asked something answers before the last call.
  if (talk.asked) await turn(game, talk, pickSpeaker(game, talk), 'open', pace)
  // 4. Last call: anyone still accused gets one final defence (and a named witness its say).
  for (const id of [...talk.unanswered]) {
    const f = fruitById(game, id)
    if (f?.alive) await turn(game, talk, f, 'lastCall', pace)
    if (talk.asked?.confirm) await turn(game, talk, pickSpeaker(game, talk), 'open', pace)
  }
}

/** Voting. Everyone votes in turn and the votes are revealed one at a time. */
export async function runVote(game: Game, pace: Pace, lines: MeetingView['lines']): Promise<SimFruit | null> {
  const t = round(game.time)
  const voters = game.fruits.filter((f) => f.alive)
  const tally = new Map<string, number>()
  for (const f of voters) {
    const brain = game.brains.get(f.id)!
    let ballot: Ballot
    game.onThinking?.(f.id, true)
    try {
      ballot = repairBallot(game, f, await brain.vote(viewFor(game, f), meetingView(game, 'vote', lines)))
    } catch {
      ballot = { target: 'skip', reason: '' }
    }
    game.onThinking?.(f.id, false)
    tally.set(ballot.target, (tally.get(ballot.target) ?? 0) + 1)
    game.public.push({ t, kind: 'vote', voter: f.id, target: ballot.target })
    logEvent(game, { t, kind: 'vote', voter: f.id, target: ballot.target, reason: ballot.reason })
    await pace(0.9)
  }
  const skips = tally.get('skip') ?? 0
  const ranked = [...tally.entries()].filter(([id]) => id !== 'skip').sort((a, b) => b[1] - a[1])
  const [top, second] = ranked
  // Ejected only with the most votes, more than skip, and no tie.
  if (!top || top[1] <= skips || (second && second[1] === top[1])) {
    const tie = !!top && !!second && second[1] === top[1]
    game.stats.skips++
    game.public.push({ t, kind: 'noEject', tie })
    logEvent(game, { t, kind: 'noEject', tie, skips })
    return null
  }
  return game.fruits.find((f) => f.id === top[0])!
}

/** The ejected fruit's last words, then into the Juicer. Grief, guilt or glee follow. */
export async function eject(game: Game, pace: Pace, out: SimFruit, byBentMemory: boolean) {
  const t = round(game.time)
  const votes = game.public.filter((e) => e.kind === 'vote' && e.t === t && e.target === out.id).length
  const lastWords = lastWordsFor(out.role, out.def.traits, out.rng)
  out.alive = false
  out.diedAt = game.time
  game.publicDead.add(out.id)
  game.public.push({ t, kind: 'eject', who: out.id, role: game.rules.confirmEjects ? out.role : undefined })
  game.stats.ejections.push({ who: out.id, role: out.role, byBentMemory })
  logEvent(game, { t, kind: 'eject', who: out.id, role: out.role, votes, lastWords })
  if (game.rules.confirmEjects) {
    const voters = game.public.filter((e) => e.kind === 'vote' && e.t === t && e.target === out.id).map((e) => (e.kind === 'vote' ? e.voter : ''))
    for (const f of game.fruits) {
      if (!f.alive) continue
      if (out.role === 'crew') {
        feel(f.mind, 'grief', 0.2)
        if (voters.includes(f.id) && f.role === 'crew') feel(f.mind, 'guilt', 0.5)
        if (f.role === 'rotten') feel(f.mind, 'smug', 0.4)
      } else if (f.role === 'crew') feel(f.mind, 'smug', voters.includes(f.id) ? 0.4 : 0.15)
    }
  }
  // Last words, then the walk to the Juicer.
  await pace(9)
}

/** Did anyone who voted `out` off hold a bent memory against it? */
function votedOnBentMemory(game: Game, out: SimFruit): boolean {
  const t = round(game.time)
  const voters = game.public.filter((e) => e.kind === 'vote' && e.t === t && e.target === out.id).map((e) => (e.kind === 'vote' ? e.voter : ''))
  return voters.some((id) =>
    fruitById(game, id)?.memory.some((m) => m.recalled && recall(m).who === out.id && m.kind !== 'seen' && m.kind !== 'passed'),
  )
}

/** Back to roaming: cooldowns reset, lights back on, everyone decides afresh. */
export function endMeeting(game: Game) {
  game.meeting = null
  game.lightsOut = false
  game.meltdown = null
  game.locked = null
  game.buttonReadyAt = game.time + BUTTON_COOLDOWN
  for (const f of game.fruits) {
    f.decideAt = game.time
    f.mind.beliefsAt = -Infinity
    if (f.role === 'rotten') f.killReadyAt = game.time + game.rules.killCooldown
  }
  if (!checkWin(game)) game.phase = 'roam'
}

export async function runMeeting(game: Game, pace: Pace = noPace) {
  const m = game.meeting!
  game.stats.meetings++
  gather(game)
  const t = round(game.time)
  game.public.push({ t, kind: 'meeting', reason: m.reason, caller: m.caller, victim: m.body?.id, room: m.body?.area })
  logEvent(game, { t, kind: 'meeting', reason: m.reason, caller: m.caller, victim: m.body?.id, room: m.body?.area })
  // Fresh beliefs for everyone at the table.
  for (const f of game.fruits) if (f.alive) f.mind.beliefs = game.brains.get(f.id)!.beliefs(viewFor(game, f))
  await pace(3)
  const talk: Talk = { lines: [], checks: new Map(), unanswered: new Set(), bentAgainst: new Set(), spoke: new Map(), asked: null }
  await discuss(game, talk, pace)
  await pace(1)
  const out = await runVote(game, pace, talk.lines)
  if (out) await eject(game, pace, out, talk.bentAgainst.has(out.id) || votedOnBentMemory(game, out))
  endMeeting(game)
}
