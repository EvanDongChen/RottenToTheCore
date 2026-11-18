import { clock, describeClaim } from '../describe'
import { area, placeName, samePlace } from '../map'
import type { Memory } from '../view'
import type { FruitView } from '../view'
import { alibiFor, isCareless } from '../rotten'
import type { Rng } from '../rng'
import type { Role, Traits } from '../types'
import { fill } from './dialog'
import { mustVote, storyBreaks } from './reasoning'
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
const QUESTION_AT = ['{name}, where were you at {time}?', 'Quick one, {name}: where were you around {time}?', '{name}. {time}. Where were you?']
const ANSWER_AT = ['At {time}? {room}{with}.', 'Around {time} I was in {room}{with}.', '{time}... {room}{with}, I think.']
const WITNESS = [' Ask {witness}.', ' {witness} saw me.', ' {witness} can tell you.']
const BACKED = [' {witness} already backed me up.', ' You heard {witness}.']
const CONFIRM = ["That's right. {name} was in {room} with me.", 'I can back that up. {name} was in {room}.', 'True. I saw {name} in {room}.']
const DENY = ["I never saw {name} in {room}. I saw them in {other}.", "Don't drag me into it. {name} was in {other}, not {room}."]
const DENY_BLANK = ["I was in {room} then, and I didn't see {name} at all.", "{room}? I was there. No {name}."]
const NO_MEMORY = ["I don't remember seeing {name}, sorry.", "Honestly? I can't say I saw {name}.", 'I was not paying attention, sorry.']
const LIE_DENY = ["I never saw {name} in {room}.", "{name} wasn't with me. Nice try."]
const STORY = ["Hold on, {name}. {when} you said you were in {room} then. Now it's {now}?", "{name}, that's not what you said {when2}. You said {room}.", "Wait. {name} said {room} before. Which is it?"]

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

/** Where the fruit was at moment `at`, from its own trail, and who it saw there then. */
export function stopAt(view: FruitView, at: number): { room: string; from: number; to: number; with: string[] } | null {
  const stop = view.trail.find((t) => t.from <= at + 0.5 && t.to >= at - 0.5 && t.to - t.from > 0.5)
  if (!stop) return null
  const from = Math.round(stop.from)
  const to = Math.round(stop.to)
  const seen = view.memory.filter((m) => (m.kind === 'seen' || m.kind === 'atTask') && m.room === stop.area && m.from <= to && m.to >= from && m.now > 0.5).map((m) => m.who)
  return { room: stop.area, from, to, with: [...new Set(seen)].slice(0, 2) }
}

/** The alibi this fruit gives for one moment it was asked about: the truth for crew, a story for the Rotten. */
export function alibiAt(view: FruitView, at: number, rng: Rng, smart = false): Extract<Claim, { kind: 'where' }> | null {
  const stop = stopAt(view, at)
  if (!stop) return null
  if (view.role === 'rotten') {
    const story = alibiFor(view, stop.room, stop.from, stop.to, rng, smart)
    return story.kind === 'where' ? { ...story, with: story.room === stop.room ? stop.with : [] } : null
  }
  return { kind: 'where', ...stop }
}

/**
 * Who to name as a witness for an alibi: someone it was with who is still alive. Crew name the
 * one they trust most; a Rotten names its partner if it was there (who will back it up), or else
 * anyone (who may well back it up too, if they really did see it).
 */
function pickWitness(view: FruitView, meeting: MeetingView, claim: Extract<Claim, { kind: 'where' }>, beliefs: Record<string, number>, smart = false): string | undefined {
  const pool = (claim.with ?? []).filter((id) => id !== view.id && meeting.living.includes(id))
  if (!pool.length) return undefined
  // A thinking Rotten never leans on its partner: two fruits covering for each other get noticed.
  if (view.role === 'rotten' && smart) return pool.find((id) => !view.partners.includes(id))
  if (view.role === 'rotten') return pool.find((id) => view.partners.includes(id)) ?? pool[0]
  return [...pool].sort((a, b) => (beliefs[a] ?? 0.5) - (beliefs[b] ?? 0.5))[0]
}

/**
 * Named as a witness: does this fruit back up `who`'s story? Crew say what they remember: they
 * saw it there (confirm), saw it elsewhere (deny), were there and saw nobody, or can't say. A
 * Rotten backs its partner, and sometimes denies a true story to drop a crew fruit in it.
 */
export function witnessLine(view: FruitView, meeting: MeetingView, rng: Rng): MeetingLine | null {
  const ask = meeting.confirm
  if (!ask) return null
  const n = nameFn(view)
  const { who, claim } = ask
  const room = placeName(claim.room)
  const mine = view.memory.filter((m) => (m.kind === 'seen' || m.kind === 'atTask' || m.kind === 'passed') && m.who === who && m.from <= claim.to && m.to >= claim.from && m.now > 0.45)
  const there = mine.find((m) => samePlace(m.room, claim.room))
  const elsewhere = mine.find((m) => !samePlace(m.room, claim.room))
  const me = stopAt(view, Math.round((claim.from + claim.to) / 2))
  // Backing it up is an alibi of its own: it was there too, for as long as it saw the other.
  const confirm = (seen = there): MeetingLine => {
    const from = Math.round(Math.max(claim.from, seen?.from ?? me?.from ?? claim.from))
    const to = Math.round(Math.min(claim.to, seen?.to ?? me?.to ?? claim.to))
    return { move: 'corroborate', target: who, claim: { kind: 'where', room: claim.room, from: Math.min(from, to), to: Math.max(from, to), with: [who] }, say: fill(rng.pick(CONFIRM), { name: n(who), room }) }
  }
  if (view.role === 'rotten') {
    if (view.partners.includes(who)) {
      // Covering for a partner is only safe if it really was about there itself.
      if (me && samePlace(me.room, claim.room)) return confirm()
      return { move: 'pass', target: undefined, say: fill(rng.pick(NO_MEMORY), { name: n(who) }) }
    }
    if (rng.chance(view.traits.aggression * 0.5)) return { move: 'contradict', target: who, say: fill(rng.pick(LIE_DENY), { name: n(who), room }) }
  }
  if (there) return confirm()
  if (elsewhere) {
    const other = placeName(elsewhere.room)
    return { move: 'contradict', target: who, claim: { kind: 'saw', what: 'seen', who, room: elsewhere.room, at: Math.round((elsewhere.from + elsewhere.to) / 2) }, say: fill(rng.pick(DENY), { name: n(who), room, other }) }
  }
  if (me && samePlace(me.room, claim.room)) return { move: 'pass', say: fill(rng.pick(DENY_BLANK), { name: n(who), room }) }
  return { move: 'pass', say: fill(rng.pick(NO_MEMORY), { name: n(who) }) }
}

/**
 * A story that changed: someone told two different stories about the same stretch of time, and
 * this meeting is when it came out. Calls it out, unless someone already has.
 */
function storyCallout(view: FruitView, meeting: MeetingView, rng: Rng): MeetingLine | null {
  const started = [...view.public].reverse().find((e) => e.kind === 'meeting')?.t ?? 0
  const n = nameFn(view)
  for (const [who, breaks] of storyBreaks(view)) {
    if (who === view.id || !meeting.living.includes(who) || view.partners.includes(who)) continue
    const fresh = breaks.find((b) => b.after.t >= started)
    if (!fresh) continue
    if (meeting.lines.some((l) => l.line.move === 'contradict' && l.line.target === who)) continue
    const before = fresh.before.t < started
    return {
      move: 'contradict',
      target: who,
      say: fill(rng.pick(STORY), {
        name: n(who),
        room: placeName(fresh.before.claim.room),
        now: placeName(fresh.after.claim.room),
        when: before ? 'Last meeting' : 'A minute ago',
        when2: before ? 'last time' : 'a minute ago',
      }),
    }
  }
  return null
}

/** The alibi this fruit gives for the run-up: the truth for crew, a story for the Rotten. */
export function alibi(view: FruitView, rng: Rng, smart = false): Extract<Claim, { kind: 'where' }> | null {
  const stop = mainStop(view)
  if (!stop) return null
  if (view.role === 'rotten') {
    const story = alibiFor(view, stop.room, stop.from, stop.to, rng, smart)
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
  /** Picks the most useful question to ask, if this brain thinks that way: who, and about when. */
  question?: (view: FruitView, meeting: MeetingView, beliefs: Record<string, number>) => { who: string; at: number } | null
}

export function crewSpeak(view: FruitView, meeting: MeetingView, beliefs: Record<string, number>, rng: Rng, style: SpeakStyle = { accuseAbove: 0.55 }): MeetingLine {
  const n = nameFn(view)
  const t = view.traits
  const others = living(view, meeting)
  const top = others.map((o) => o.id).sort((a, b) => (beliefs[b] ?? 0) - (beliefs[a] ?? 0))[0]
  const hard = view.memory.find((m) => (m.kind === 'kill' || m.kind === 'vented') && m.now > 0.5 && meeting.living.includes(m.who))

  // Named as a witness: back the story up, or not.
  const witness = witnessLine(view, meeting, rng)
  if (witness) return witness

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

  // Asked a question, or accused: answer with where it was, and name someone who can back it up.
  const accuser = meeting.askedBy ?? onTheSpot(view, meeting)
  if (accuser && meeting.step !== 'roundup') {
    const counter = (beliefs[accuser] ?? 0) > 0.3 && t.aggression > 0.5 ? fill(rng.pick(COUNTER), { name: n(accuser) }) : ''
    return defence(view, meeting, beliefs, rng, counter)
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
  // A story that changed in front of everyone: call it out.
  const story = storyCallout(view, meeting, rng)
  if (story) return story
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

  // Said its piece about the top suspect twice already: let others talk.
  const pressed = meeting.lines.filter((l) => l.who === view.id && l.line.target === top && ['accuse', 'bandwagon'].includes(l.line.move)).length
  if (top && pressed < 2 && (beliefs[top] ?? 0) > style.accuseAbove - t.suspicion * 0.1) {
    const already = piled.get(top)
    if (already && already.size >= 2 && !already.has(view.id)) return { move: 'bandwagon', target: top, say: fill(rng.pick(BANDWAGON), { name: n(top) }) }
    return { move: 'accuse', target: top, say: fill(rng.pick(ACCUSE), { name: n(top), why: rng.pick(WHY[reasonAgainst(view, top)]) }) }
  }
  // The gullible join a growing crowd.
  const crowd = [...piled.entries()].filter(([id, s]) => id !== view.id && meeting.living.includes(id) && s.size >= 2).sort((a, b) => b[1].size - a[1].size)[0]
  if (crowd && (t.temper === 'gullible' || (beliefs[crowd[0]] ?? 0) > 0.3) && !crowd[1].has(view.id)) return { move: 'bandwagon', target: crowd[0], say: fill(rng.pick(BANDWAGON), { name: n(crowd[0]) }) }

  // A pointed question about the moment that matters, if this brain picks its questions.
  const pointed = style.question?.(view, meeting, beliefs)
  if (pointed && rng.chance(0.7)) return { move: 'question', target: pointed.who, at: pointed.at, say: fill(rng.pick(QUESTION_AT), { name: n(pointed.who), time: clock(pointed.at) }) }
  // Someone gave no alibi: ask them.
  const spoken = new Set(meeting.lines.filter((l) => l.line.claim?.kind === 'where').map((l) => l.who))
  const quiet = others.find((o) => !spoken.has(o.id))
  if (quiet && rng.chance(0.4)) return { move: 'question', target: quiet.id, say: fill(rng.pick(QUESTION), { name: n(quiet.id) }) }
  return t.talkativeness > 0.4 ? { move: 'skip', say: rng.pick(SKIP) } : { move: 'pass', say: rng.pick(PASS) }
}

/** In the endgame, vote the top suspect if it is at least this likely and this far ahead of the next. */
export const ENDGAME = { floor: 0.2, lead: 1.25 }

/**
 * Answering a question or an accusation. Asked about a moment: where it was then. Otherwise:
 * where it spent the run-up. Either way it names a witness if it was with anyone.
 */
function defence(view: FruitView, meeting: MeetingView, beliefs: Record<string, number>, rng: Rng, counter: string, smart = false): MeetingLine {
  const n = nameFn(view)
  // Someone already backed it up this meeting: point at that rather than asking again.
  const backer = meeting.lines.find((l) => l.line.move === 'corroborate' && l.line.target === view.id && meeting.living.includes(l.who))?.who
  if (backer) {
    const where = meeting.askedAt !== undefined ? alibiAt(view, meeting.askedAt, rng, smart) : alibi(view, rng, smart)
    const room = where ? placeName(where.room) : ''
    return { move: 'defend', target: view.id, claim: where ?? undefined, say: `${where ? `${room}. ` : ''}${fill(rng.pick(BACKED), { witness: n(backer) }).trim()}${counter}` }
  }
  if (meeting.askedAt !== undefined) {
    const where = alibiAt(view, meeting.askedAt, rng, smart)
    if (where) {
      const witness = pickWitness(view, meeting, where, beliefs, smart)
      return { move: 'defend', target: view.id, claim: where, witness, say: fill(rng.pick(ANSWER_AT), { time: clock(meeting.askedAt), room: placeName(where.room), with: withText(view, where.with) }) + (witness ? fill(rng.pick(WITNESS), { witness: n(witness) }) : '') + counter }
    }
  }
  const where = alibi(view, rng, smart)
  if (!where) return { move: 'defend', target: view.id, say: `It wasn't me!${counter}` }
  const witness = pickWitness(view, meeting, where, beliefs, smart)
  return { move: 'defend', target: view.id, claim: where, witness, say: fill(rng.pick(DEFEND), { room: placeName(where.room), with: withText(view, where.with) }) + (witness ? fill(rng.pick(WITNESS), { witness: n(witness) }) : '') + counter }
}

/**
 * `endgame` is how likely the fruit is to see that the vote can't be wasted and act on it: a
 * thinking brain always does; a fruit of rules of thumb only if it's bold enough to vote on a guess.
 */
export function crewVote(view: FruitView, meeting: MeetingView, beliefs: Record<string, number>, rng: Rng, threshold: number, tally: Record<string, number>, endgame = 1): Ballot {
  const n = nameFn(view)
  const candidates = meeting.living.filter((id) => id !== view.id)
  const [top, second] = candidates.sort((a, b) => (beliefs[b] ?? 0) - (beliefs[a] ?? 0))
  if (top && (beliefs[top] ?? 0) > threshold) return { target: top, reason: `I'm ${Math.round(beliefs[top] * 100)}% sure about ${n(top)}.` }
  // The endgame: a skip, or the wrong fruit in the Juicer, and one more kill loses it. Go with the
  // best guess, as long as it stands out at all.
  if (top && mustVote(view, meeting.living.length) && rng.chance(endgame)) {
    const p = beliefs[top] ?? 0
    const q = second ? (beliefs[second] ?? 0) : 0
    if (p >= ENDGAME.floor && p >= q * ENDGAME.lead) return { target: top, reason: `We can't afford to skip. My best guess is ${n(top)}.` }
  }
  // The gullible go with the crowd once it is big enough.
  const [crowd, count] = Object.entries(tally).filter(([id]) => id !== view.id).sort((a, b) => b[1] - a[1])[0] ?? []
  const big = (count ?? 0) >= Math.ceil(meeting.living.length / 3)
  if (crowd && big && (view.traits.temper === 'gullible' || (beliefs[crowd] ?? 0) > threshold * 0.6) && rng.chance(0.8)) return { target: crowd, reason: 'Everyone else seems sure.' }
  return { target: 'skip', reason: 'Not sure enough to vote anyone out.' }
}

// ---------- Rotten ----------

export interface RottenSpeech {
  /** Thinks before it speaks: careful alibis, no covering for its partner, frames whoever the table already doubts. */
  smart?: boolean
  /** How the table feels about each crew fruit, for picking a scapegoat. */
  table?: Record<string, number>
}

/** Who to point the finger at: whoever is accusing it, or whoever the room already doubts. */
function frameTarget(view: FruitView, meeting: MeetingView, rng: Rng, table?: Record<string, number>): string | null {
  const crew = living(view, meeting).filter((o) => !view.partners.includes(o.id))
  if (!crew.length) return null
  const accuser = [...meeting.lines].reverse().find((l) => l.line.target === view.id && ['accuse', 'hardClaim', 'contradict'].includes(l.line.move) && crew.some((o) => o.id === l.who))
  if (accuser) return accuser.who
  const piled = [...pile(meeting).entries()].filter(([id]) => crew.some((o) => o.id === id)).sort((a, b) => b[1].size - a[1].size)[0]
  if (piled) return piled[0]
  // Nobody piled on yet: whoever the table has doubted before makes the easiest scapegoat.
  if (table) {
    const doubted = [...crew].sort((a, b) => (table[b.id] ?? 0) - (table[a.id] ?? 0))[0]
    if (doubted && (table[doubted.id] ?? 0) > 0) return doubted.id
  }
  return rng.pick(crew).id
}

export function rottenSpeak(view: FruitView, meeting: MeetingView, rng: Rng, opts: RottenSpeech = {}): MeetingLine {
  const n = nameFn(view)
  const t = view.traits
  const framer = t.style === 'framer'
  const smart = !!opts.smart
  const witness = witnessLine(view, meeting, rng)
  if (witness) return witness
  // Self-report: a confident, detailed story pinning it on someone else.
  if (meeting.step === 'report') {
    if (meeting.body) {
      const frame = frameTarget(view, meeting, rng, opts.table)
      const say = fill(rng.pick(FOUND), { victim: n(meeting.body.victim), room: placeName(meeting.body.room) })
      if (frame && rng.chance(framer ? 0.95 : 0.4 + t.aggression * 0.4)) {
        const claim: Claim = { kind: 'saw', what: 'nearBody', who: frame, room: meeting.body.room, at: Math.round(view.time - 3), victim: meeting.body.victim }
        return { move: 'accuse', target: frame, claim, say: `${say} ${fill(rng.pick(FOUND_NEAR), { name: n(frame) })}` }
      }
      return { move: 'report', say }
    }
    return { move: 'report', say: rng.pick(BUTTON_NOTHING) }
  }
  const accuser = meeting.askedBy ?? onTheSpot(view, meeting)
  if (accuser && meeting.step !== 'roundup') {
    const counter = rng.chance(0.3 + t.aggression * 0.5) ? fill(rng.pick(COUNTER), { name: n(accuser) }) : ''
    return defence(view, meeting, {}, rng, counter, smart)
  }
  if (meeting.step === 'roundup') {
    const where = alibi(view, rng, smart)
    if (where) return { move: 'alibi', claim: where, say: fill(rng.pick(ALIBI), { room: placeName(where.room), with: withText(view, where.with) }) }
    return { move: 'alibi', say: 'Doing my tasks, same as everyone.' }
  }
  const piled = pile(meeting)
  // A partner under fire: defend it, sometimes, which is risky.
  const partner = view.partners.find((p) => piled.has(p) && meeting.living.includes(p))
  if (partner && rng.chance(smart ? 0.03 : isCareless(view) ? 0.5 : 0.2)) return { move: 'vouch', target: partner, say: fill(rng.pick(VOUCH), { name: n(partner) }) }
  // Join a growing bandwagon against a crew fruit.
  const crowd = [...piled.entries()].filter(([id, s]) => !view.partners.includes(id) && id !== view.id && meeting.living.includes(id) && s.size >= 1 && !s.has(view.id)).sort((a, b) => b[1].size - a[1].size)[0]
  if (crowd && rng.chance(0.7)) return { move: 'bandwagon', target: crowd[0], say: fill(rng.pick(BANDWAGON), { name: n(crowd[0]) }) }
  // Frame someone, more often when bold, and all the time if that's its game.
  if (rng.chance(framer ? 0.85 : 0.25 + t.aggression * 0.45)) {
    const frame = frameTarget(view, meeting, rng, opts.table)
    if (frame) return { move: 'accuse', target: frame, say: fill(rng.pick(ACCUSE), { name: n(frame), why: rng.pick(rng.chance(0.5) ? WHY.fakeTask : WHY.none) }) }
  }
  return { move: 'skip', say: rng.pick(SKIP) }
}

/** A Rotten votes with a crowd against a crew fruit, never for its partner, or skips to stay quiet. */
export function rottenVote(view: FruitView, meeting: MeetingView, rng: Rng, tally: Record<string, number>, opts: RottenSpeech = {}): Ballot {
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
  // A lone vote stands out. A thinking Rotten only votes where others will follow.
  if (piled && (!opts.smart || piled[1].size >= 2) && rng.chance(0.7)) return { target: piled[0], reason: 'You all heard what was said.' }
  return { target: 'skip', reason: 'We do not know enough.' }
}

/** Is this area name a real room (not a hallway)? Rooms make better alibis. */
export function isRoomArea(id: string) {
  return !area(id).hallway
}
