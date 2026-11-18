import { clock, describeClaim } from '../describe'
import { area, placeName } from '../map'
import type { Memory } from '../view'
import type { FruitView } from '../view'
import { alibiFor, isCareless } from '../rotten'
import type { Rng } from '../rng'
import type { Role, Traits } from '../types'
import { fill } from './dialog'
import type { Ballot, Claim, MeetingLine, MeetingView } from './types'

/**
 * What to say in a meeting, for the non-LLM brains. The move is chosen from the fruit's memory,
 * its pending reactions and its beliefs; the words come from small pools with slots.
 * The LLM brain uses the same choices as its fallback.
 */

// ---------- Line pools ----------

const FOUND = ['I found {victim} in {room}.', '{victim} is dead. In {room}. I just found them.', 'Body! {victim}, in {room}.']
const FOUND_NEAR = ['{name} was right there.', 'And {name} was hanging about nearby.', 'Guess who I saw near the body? {name}.']
const BUTTON_HARD = ['I pressed it because I saw {claim}!', 'Everyone listen. I {claim}!']
const BUTTON_SUSPECT = ["I don't trust {name}. That's why we're here.", "I called this about {name}. Something's off."]
const BUTTON_NOTHING = ['Just checking in. Where has everyone been?', 'I got nervous. Where is everyone?']
const ALIBI = ['I was in {room}{with}.', '{room}{with}, doing my tasks.', 'Me? {room}{with}.']
const OBSERVE = [' Also, I {claim}.', ' And I {claim}.', ' Oh, and I {claim}.']
const OBSERVE_HEDGE = [' I think I {claim}?', ' Maybe I {claim}? Not sure.']
const DEFEND = ["It wasn't me! I was in {room}{with}.", 'I was in {room}{with}. Ask anyone.', 'Check your facts. {room}{with}.']
const COUNTER = [' If anything, look at {name}.', ' Why is {name} so keen to blame me?']
const CONTRADICT = ['No, {name} was in {room} around {time}. I saw it.', "That's not true. I saw {name} in {room} at {time}."]
const HEDGE = ['I could have sworn you were in {room}, {name}?', "Wait, {name}, weren't you in {room}?"]
const CORROBORATE = ['That checks out. I saw {name} in {room} too.', "{name}'s right, I saw them in {room}.", 'I saw that too.']
const HARD = ['I saw {name} {deed}!', 'I watched {name} {deed}. I am sure.']
const ACCUSE = ['I think it was {name}. {why}', "It's {name}. {why}", 'My money is on {name}. {why}']
const WHY: Record<string, string[]> = {
  nearBody: ['I saw them near the body.', 'They were right by the body.'],
  fakeTask: ['They were faking a task.', 'They stood at a station doing nothing.'],
  caught: ['Their story keeps changing.', 'They lied about where they were.'],
  heard: ['Everyone has been saying it.', 'I keep hearing things.'],
  tail: ['They have been following me around.'],
  none: ['Call it a hunch.', 'Something about them.'],
}
const BANDWAGON = ["Everyone's saying {name}, so {name}.", 'I agree. {name}.', "Yeah, it's {name}."]
const VOUCH = ['I watched {name} do a task. {name} is clean.', '{name} is crew. I saw the scanner light up.']
const SKIP = ["We don't know enough. Skip.", "Let's not guess. Skip.", 'I say we skip this one.']
const PASS = ['Hmm.', '…', "I don't know.", 'Let me think.']
const QUESTION = ['{name}, where were you?', 'What about you, {name}? Where were you?']

const PLEA = ['I was crew! You got it wrong!', 'No! Please! I did my tasks!', 'You will regret this. It was not me.', 'Remember me when they get you next.']
const CURSE = ['Fools. All of you.', 'I hope the Rotten get you first.', 'Unbelievable. UNBELIEVABLE.']
const CONFESS = ['Heh. Took you long enough.', 'Fine. It was me. It was always me.', 'You were never going to catch my partner.', 'Worth it.']

/** The ejected fruit's last words: a plea, a curse, or a caught Rotten's smug confession. */
export function lastWordsFor(role: Role, traits: Traits, rng: Rng): string {
  if (role === 'rotten') return rng.pick(CONFESS)
  return rng.pick(traits.aggression > 0.6 ? CURSE : PLEA)
}

// ---------- Helpers ----------

function nameFn(view: FruitView) {
  return (id: string) => (id === view.id ? view.name : (view.others.find((o) => o.id === id)?.name ?? id))
}

const living = (view: FruitView, meeting: MeetingView) => view.others.filter((o) => meeting.living.includes(o.id))

/** When the last meeting before this one ended, or the start. */
function lastMeetingAt(view: FruitView): number {
  const meetings = view.public.filter((e) => e.kind === 'meeting')
  return meetings.length > 1 ? meetings[meetings.length - 2].t : 0
}

/** The stretch of time a fruit is asked about: the run-up to this meeting. */
function window(view: FruitView): [number, number] {
  return [Math.max(lastMeetingAt(view), view.time - 45), view.time]
}

/** Where the fruit spent most of the run-up to this meeting, and who it saw there. */
export function mainStop(view: FruitView): { room: string; from: number; to: number; with: string[] } | null {
  const [w0, w1] = window(view)
  let best: { room: string; from: number; to: number; with: string[] } | null = null
  let bestTime = 0
  for (const t of view.trail) {
    const from = Math.max(t.from, w0)
    const to = Math.min(t.to, w1)
    // The seat at the table, taken when the meeting was called, doesn't count.
    if (to - from <= 0.5 || (t.from >= view.time - 0.01 && t.area === 'cafeteria')) continue
    if (to - from > bestTime) {
      bestTime = to - from
      best = { room: t.area, from: Math.round(from), to: Math.round(to), with: [] }
    }
  }
  if (!best) return null
  best.with = [...new Set(view.memory.filter((m) => m.kind === 'seen' && m.room === best!.room && m.from <= best!.to && m.to >= best!.from && m.now > 0.5).map((m) => m.who))].slice(0, 2)
  return best
}

/** The alibi this fruit gives for the run-up: the truth for crew, a story for the Rotten. */
export function alibi(view: FruitView, rng: Rng): Extract<Claim, { kind: 'where' }> | null {
  const stop = mainStop(view)
  if (!stop) return null
  if (view.role === 'rotten') {
    const story = alibiFor(view, stop.room, stop.from, stop.to, rng)
    return story.kind === 'where' ? { ...story, with: story.room === stop.room ? stop.with : [] } : null
  }
  return { kind: 'where', room: stop.room, from: stop.from, to: stop.to, with: stop.with }
}

const EVIDENCE: Record<string, number> = { kill: 10, vented: 9, nearBody: 5, fakeTask: 4, atTask: 1 }

/** The strongest thing this fruit saw itself, worth telling the meeting. */
export function strongestSighting(view: FruitView, meeting: MeetingView, min = 0.4): Memory | null {
  let best: Memory | null = null
  let bestScore = 0
  for (const m of view.memory) {
    if (m.kind === 'heard' || m.now < min || !(m.kind in EVIDENCE) || !meeting.living.includes(m.who)) continue
    if (m.kind === 'atTask' && !m.sawEffect) continue
    const score = EVIDENCE[m.kind] * m.now
    if (score > bestScore) {
      bestScore = score
      best = m
    }
  }
  return best
}

export function claimOf(m: Memory): Claim {
  return { kind: 'saw', what: m.kind === 'heard' ? (m.told as 'seen') : m.kind, who: m.who, room: m.room, at: Math.round((m.from + m.to) / 2), victim: m.victim }
}

function withText(view: FruitView, ids: string[] | undefined) {
  const n = nameFn(view)
  return ids?.length ? ` with ${ids.map(n).join(' and ')}` : ''
}

/** Fruits accused in this meeting, and by how many different fruits. */
export function pile(meeting: MeetingView): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const { who, line } of meeting.lines) {
    if (!line.target || !['accuse', 'hardClaim', 'bandwagon', 'contradict'].includes(line.move)) continue
    if (!out.has(line.target)) out.set(line.target, new Set())
    out.get(line.target)!.add(who)
  }
  return out
}

/** This fruit has been accused and has not answered since. */
function onTheSpot(view: FruitView, meeting: MeetingView): string | null {
  let accuser: string | null = null
  for (const { who, line } of meeting.lines) {
    if (line.target === view.id && ['accuse', 'hardClaim', 'bandwagon', 'contradict', 'question'].includes(line.move)) accuser = who
    if (who === view.id && (line.move === 'defend' || line.move === 'alibi')) accuser = null
  }
  return accuser
}

/** Why this fruit suspects `who`, from its own memory. */
function reasonAgainst(view: FruitView, who: string): keyof typeof WHY {
  if ((view.caught[who] ?? 0) >= 1) return 'caught'
  const m = view.memory.filter((x) => x.who === who && x.now > 0.3)
  if (m.some((x) => x.kind === 'nearBody')) return 'nearBody'
  if (m.some((x) => x.kind === 'fakeTask')) return 'fakeTask'
  if (view.tailedBy.includes(who)) return 'tail'
  if (m.some((x) => x.kind === 'heard' && x.told !== 'alibi' && x.told !== 'vouch')) return 'heard'
  return 'none'
}

function deed(c: Claim, n: (id: string) => string): string {
  if (c.kind !== 'saw') return ''
  return c.what === 'kill' ? `kill ${c.victim ? n(c.victim) : 'someone'} in ${placeName(c.room)}` : `use a vent in ${placeName(c.room)}`
}

// ---------- Crew ----------

export interface SpeakStyle {
  /** How sure it must be before it accuses. */
  accuseAbove: number
}

export function crewSpeak(view: FruitView, meeting: MeetingView, beliefs: Record<string, number>, rng: Rng, style: SpeakStyle = { accuseAbove: 0.55 }): MeetingLine {
  const n = nameFn(view)
  const t = view.traits
  const others = living(view, meeting)
  const top = others.map((o) => o.id).sort((a, b) => (beliefs[b] ?? 0) - (beliefs[a] ?? 0))[0]
  const hard = view.memory.find((m) => (m.kind === 'kill' || m.kind === 'vented') && m.now > 0.5 && meeting.living.includes(m.who))

  // The reporter opens.
  if (meeting.step === 'report') {
    if (meeting.body) {
      const say = fill(rng.pick(FOUND), { victim: n(meeting.body.victim), room: placeName(meeting.body.room) })
      if (hard) return { move: 'hardClaim', target: hard.who, claim: claimOf(hard), say: `${say} ${fill(rng.pick(HARD), { name: n(hard.who), deed: deed(claimOf(hard), n) })}` }
      const near = view.memory.filter((m) => m.kind === 'nearBody' && m.victim === meeting.body!.victim && m.now > 0.6 && meeting.living.includes(m.who)).sort((a, b) => b.now - a.now)[0]
      if (near) return { move: 'accuse', target: near.who, claim: claimOf(near), say: `${say} ${fill(rng.pick(FOUND_NEAR), { name: n(near.who) })}` }
      return { move: 'report', say }
    }
    if (hard) return { move: 'hardClaim', target: hard.who, claim: claimOf(hard), say: fill(rng.pick(BUTTON_HARD), { claim: describeClaim(claimOf(hard), n) }) }
    if (top && (beliefs[top] ?? 0) > style.accuseAbove * 0.8) return { move: 'accuse', target: top, say: fill(rng.pick(BUTTON_SUSPECT), { name: n(top) }) }
    return { move: 'report', say: rng.pick(BUTTON_NOTHING) }
  }

  // Asked a question, or accused: answer with where it was.
  const accuser = meeting.askedBy ?? onTheSpot(view, meeting)
  if (accuser && meeting.step !== 'roundup') {
    const where = alibi(view, rng)
    const counter = (beliefs[accuser] ?? 0) > 0.3 && t.aggression > 0.5 ? fill(rng.pick(COUNTER), { name: n(accuser) }) : ''
    if (where) return { move: 'defend', target: view.id, claim: where, say: fill(rng.pick(DEFEND), { room: placeName(where.room), with: withText(view, where.with) }) + counter }
    return { move: 'defend', target: view.id, say: `It wasn't me!${counter}` }
  }

  // Where was everyone? One location claim and the strongest observation.
  if (meeting.step === 'roundup') {
    if (hard) return { move: 'hardClaim', target: hard.who, claim: claimOf(hard), say: fill(rng.pick(HARD), { name: n(hard.who), deed: deed(claimOf(hard), n) }) }
    const where = alibi(view, rng)
    const seen = strongestSighting(view, meeting, 0.4)
    const extra = seen ? fill(rng.pick(seen.now > 0.7 ? OBSERVE : OBSERVE_HEDGE), { claim: describeClaim(claimOf(seen), n) }) : ''
    if (where) return { move: 'alibi', claim: where, say: fill(rng.pick(ALIBI), { room: placeName(where.room), with: withText(view, where.with) }) + extra }
    return { move: 'alibi', say: `I was about.${extra}` }
  }

  // The open floor, and the last call.
  // Something said earlier doesn't match what I remember: say so.
  const conflict = meeting.checks.filter((c) => c.how === 'conflict' && meeting.living.includes(c.speaker)).sort((a, b) => b.confidence - a.confidence)[0]
  if (conflict && conflict.mine.kind === 'saw') {
    return { move: 'contradict', target: conflict.speaker, claim: conflict.mine, say: fill(rng.pick(CONTRADICT), { name: n(conflict.speaker), room: placeName(conflict.mine.room), time: clock(conflict.mine.at) }) }
  }
  const hedge = meeting.checks.find((c) => c.how === 'hedge' && meeting.living.includes(c.speaker))
  if (hedge && hedge.mine.kind === 'saw' && rng.chance(0.6)) {
    return { move: 'question', target: hedge.speaker, claim: hedge.mine, say: fill(rng.pick(HEDGE), { name: n(hedge.speaker), room: placeName(hedge.mine.room) }) }
  }
  if (hard) return { move: 'hardClaim', target: hard.who, claim: claimOf(hard), say: fill(rng.pick(HARD), { name: n(hard.who), deed: deed(claimOf(hard), n) }) }

  // Someone I know is clean is under fire: stand up for them.
  const piled = pile(meeting)
  const cleanAccused = view.cleared.find((id) => piled.has(id) && meeting.living.includes(id))
  if (cleanAccused) return { move: 'vouch', target: cleanAccused, say: fill(rng.pick(VOUCH), { name: n(cleanAccused) }) }

  const match = meeting.checks.find((c) => c.how === 'match' && meeting.living.includes(c.speaker) && (beliefs[c.speaker] ?? 0) < 0.6)
  if (match && rng.chance(0.5)) return { move: 'corroborate', target: match.speaker, claim: match.mine, say: fill(rng.pick(CORROBORATE), { name: n(match.speaker), room: placeName(match.mine.room) }) }

  if (top && (beliefs[top] ?? 0) > style.accuseAbove - t.suspicion * 0.1) {
    const already = piled.get(top)
    if (already && already.size >= 2 && !already.has(view.id)) return { move: 'bandwagon', target: top, say: fill(rng.pick(BANDWAGON), { name: n(top) }) }
    return { move: 'accuse', target: top, say: fill(rng.pick(ACCUSE), { name: n(top), why: rng.pick(WHY[reasonAgainst(view, top)]) }) }
  }
  // The gullible join a growing crowd.
  const crowd = [...piled.entries()].filter(([id, s]) => id !== view.id && meeting.living.includes(id) && s.size >= 2).sort((a, b) => b[1].size - a[1].size)[0]
  if (crowd && (t.temper === 'gullible' || (beliefs[crowd[0]] ?? 0) > 0.3) && !crowd[1].has(view.id)) return { move: 'bandwagon', target: crowd[0], say: fill(rng.pick(BANDWAGON), { name: n(crowd[0]) }) }

  // Someone gave no alibi: ask them.
  const spoken = new Set(meeting.lines.filter((l) => l.line.claim?.kind === 'where').map((l) => l.who))
  const quiet = others.find((o) => !spoken.has(o.id))
  if (quiet && rng.chance(0.4)) return { move: 'question', target: quiet.id, say: fill(rng.pick(QUESTION), { name: n(quiet.id) }) }
  return t.talkativeness > 0.4 ? { move: 'skip', say: rng.pick(SKIP) } : { move: 'pass', say: rng.pick(PASS) }
}

export function crewVote(view: FruitView, meeting: MeetingView, beliefs: Record<string, number>, rng: Rng, threshold: number, tally: Record<string, number>): Ballot {
  const n = nameFn(view)
  const candidates = meeting.living.filter((id) => id !== view.id)
  const top = candidates.sort((a, b) => (beliefs[b] ?? 0) - (beliefs[a] ?? 0))[0]
  if (top && (beliefs[top] ?? 0) > threshold) return { target: top, reason: `I'm ${Math.round(beliefs[top] * 100)}% sure about ${n(top)}.` }
  // The gullible go with the crowd once it is big enough.
  const [crowd, count] = Object.entries(tally).filter(([id]) => id !== view.id).sort((a, b) => b[1] - a[1])[0] ?? []
  const big = (count ?? 0) >= Math.ceil(meeting.living.length / 3)
  if (crowd && big && (view.traits.temper === 'gullible' || (beliefs[crowd] ?? 0) > threshold * 0.6) && rng.chance(0.8)) return { target: crowd, reason: 'Everyone else seems sure.' }
  return { target: 'skip', reason: 'Not sure enough to vote anyone out.' }
}

// ---------- Rotten ----------

/** Who to point the finger at: whoever is accusing it, or whoever the room already doubts. */
function frameTarget(view: FruitView, meeting: MeetingView, rng: Rng): string | null {
  const crew = living(view, meeting).filter((o) => !view.partners.includes(o.id))
  if (!crew.length) return null
  const accuser = [...meeting.lines].reverse().find((l) => l.line.target === view.id && ['accuse', 'hardClaim', 'contradict'].includes(l.line.move) && crew.some((o) => o.id === l.who))
  if (accuser) return accuser.who
  const piled = [...pile(meeting).entries()].filter(([id]) => crew.some((o) => o.id === id)).sort((a, b) => b[1].size - a[1].size)[0]
  if (piled) return piled[0]
  return rng.pick(crew).id
}

export function rottenSpeak(view: FruitView, meeting: MeetingView, rng: Rng): MeetingLine {
  const n = nameFn(view)
  const t = view.traits
  // Self-report: a confident, detailed story pinning it on someone else.
  if (meeting.step === 'report') {
    if (meeting.body) {
      const frame = frameTarget(view, meeting, rng)
      const say = fill(rng.pick(FOUND), { victim: n(meeting.body.victim), room: placeName(meeting.body.room) })
      if (frame && rng.chance(0.4 + t.aggression * 0.4)) {
        const claim: Claim = { kind: 'saw', what: 'nearBody', who: frame, room: meeting.body.room, at: Math.round(view.time - 3), victim: meeting.body.victim }
        return { move: 'accuse', target: frame, claim, say: `${say} ${fill(rng.pick(FOUND_NEAR), { name: n(frame) })}` }
      }
      return { move: 'report', say }
    }
    return { move: 'report', say: rng.pick(BUTTON_NOTHING) }
  }
  const accuser = meeting.askedBy ?? onTheSpot(view, meeting)
  if (accuser && meeting.step !== 'roundup') {
    const where = alibi(view, rng)
    const counter = rng.chance(0.3 + t.aggression * 0.5) ? fill(rng.pick(COUNTER), { name: n(accuser) }) : ''
    if (where) return { move: 'defend', target: view.id, claim: where, say: fill(rng.pick(DEFEND), { room: placeName(where.room), with: withText(view, where.with) }) + counter }
    return { move: 'defend', target: view.id, say: `It wasn't me!${counter}` }
  }
  if (meeting.step === 'roundup') {
    const where = alibi(view, rng)
    if (where) return { move: 'alibi', claim: where, say: fill(rng.pick(ALIBI), { room: placeName(where.room), with: withText(view, where.with) }) }
    return { move: 'alibi', say: 'Doing my tasks, same as everyone.' }
  }
  const piled = pile(meeting)
  // A partner under fire: defend it, sometimes, which is risky.
  const partner = view.partners.find((p) => piled.has(p) && meeting.living.includes(p))
  if (partner && rng.chance(isCareless(view) ? 0.5 : 0.2)) return { move: 'vouch', target: partner, say: fill(rng.pick(VOUCH), { name: n(partner) }) }
  // Join a growing bandwagon against a crew fruit.
  const crowd = [...piled.entries()].filter(([id, s]) => !view.partners.includes(id) && id !== view.id && meeting.living.includes(id) && s.size >= 1 && !s.has(view.id)).sort((a, b) => b[1].size - a[1].size)[0]
  if (crowd && rng.chance(0.7)) return { move: 'bandwagon', target: crowd[0], say: fill(rng.pick(BANDWAGON), { name: n(crowd[0]) }) }
  // Frame someone, more often when bold.
  if (rng.chance(0.25 + t.aggression * 0.45)) {
    const frame = frameTarget(view, meeting, rng)
    if (frame) return { move: 'accuse', target: frame, say: fill(rng.pick(ACCUSE), { name: n(frame), why: rng.pick(rng.chance(0.5) ? WHY.fakeTask : WHY.none) }) }
  }
  return { move: 'skip', say: rng.pick(SKIP) }
}

/** A Rotten votes with a crowd against a crew fruit, never for its partner, or skips to stay quiet. */
export function rottenVote(view: FruitView, meeting: MeetingView, rng: Rng, tally: Record<string, number>): Ballot {
  const crew = meeting.living.filter((id) => id !== view.id && !view.partners.includes(id))
  // The vote is going against it (or its partner): back the runner-up to force a tie.
  const ours = [view.id, ...view.partners]
  const leader = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]
  if (leader && ours.includes(leader[0])) {
    const runnerUp = Object.entries(tally)
      .filter(([id]) => crew.includes(id) && tally[id] === leader[1] - 1)
      .sort((a, b) => b[1] - a[1])[0]
    if (runnerUp) return { target: runnerUp[0], reason: 'No. It is them, not me.' }
  }
  const crowd = Object.entries(tally)
    .filter(([id]) => crew.includes(id))
    .sort((a, b) => b[1] - a[1])[0]
  if (crowd && crowd[1] >= 1) return { target: crowd[0], reason: 'Everyone else seems sure.' }
  const piled = [...pile(meeting).entries()].filter(([id]) => crew.includes(id)).sort((a, b) => b[1].size - a[1].size)[0]
  if (piled && rng.chance(0.7)) return { target: piled[0], reason: 'You all heard what was said.' }
  return { target: 'skip', reason: 'We do not know enough.' }
}

/** Is this area name a real room (not a hallway)? Rooms make better alibis. */
export function isRoomArea(id: string) {
  return !area(id).hallway
}
