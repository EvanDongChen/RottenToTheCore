import { stop } from './actions'
import type { Ballot, MeetingView } from './brains/types'
import { BUTTON_COOLDOWN } from './constants'
import { checkWin, logEvent, seatPos } from './engine'
import type { Game, SimFruit } from './engine'
import { round } from './log'
import { areaAt } from './map'
import { clearChats } from './encounters'
import { viewFor } from './view'

/**
 * A meeting, run one step at a time. Roam time is paused throughout. `pace` is how the caller
 * lets time pass between steps: the browser waits so viewers can read, headless runs don't wait.
 */
export type Pace = (simSeconds: number) => Promise<void>

export const noPace: Pace = async () => {}

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
  for (const f of game.fruits) if (!f.alive && !game.publicDead.has(f.id)) {
    game.publicDead.add(f.id)
    game.public.push({ t: game.time, kind: 'dead', who: f.id })
  }
  game.bodies = []
  clearChats(game)
}

export function meetingView(game: Game, step: MeetingView['step'], lines: MeetingView['lines'] = [], askedBy?: string): MeetingView {
  const m = game.meeting!
  return {
    reason: m.reason,
    caller: m.caller,
    body: m.body ? { victim: m.body.id, room: m.body.area } : undefined,
    step,
    lines,
    askedBy,
    living: game.fruits.filter((f) => f.alive).map((f) => f.id),
  }
}

/** Make a ballot legal: a living fruit other than the voter, or skip. */
export function repairBallot(game: Game, voter: SimFruit, b: Ballot | undefined): Ballot {
  const target = b?.target
  const ok = target === 'skip' || game.fruits.some((f) => f.id === target && f.alive && f.id !== voter.id)
  return { target: ok ? target! : 'skip', reason: typeof b?.reason === 'string' ? b.reason.slice(0, 160) : '' }
}

/** Voting and ejection. Everyone votes in turn and the votes are revealed one at a time. */
export async function runVote(game: Game, pace: Pace, lines: MeetingView['lines']): Promise<SimFruit | null> {
  const t = round(game.time)
  const voters = game.fruits.filter((f) => f.alive)
  const tally = new Map<string, number>()
  for (const f of voters) {
    const brain = game.brains.get(f.id)!
    let ballot: Ballot
    try {
      ballot = repairBallot(game, f, await brain.vote(viewFor(game, f), meetingView(game, 'vote', lines)))
    } catch {
      ballot = { target: 'skip', reason: '' }
    }
    tally.set(ballot.target, (tally.get(ballot.target) ?? 0) + 1)
    game.public.push({ t, kind: 'vote', voter: f.id, target: ballot.target })
    logEvent(game, { t, kind: 'vote', voter: f.id, target: ballot.target, reason: ballot.reason })
    await pace(0.8)
  }
  const skips = tally.get('skip') ?? 0
  const ranked = [...tally.entries()].filter(([id]) => id !== 'skip').sort((a, b) => b[1] - a[1])
  const [top, second] = ranked
  // Ejected only with the most votes, more than skip, and no tie.
  if (!top || top[1] <= skips || (second && second[1] === top[1])) {
    game.stats.skips++
    game.public.push({ t, kind: 'noEject', tie: !!top && !!second && second[1] === top[1] })
    logEvent(game, { t, kind: 'noEject', tie: !!top && !!second && second[1] === top[1], skips })
    return null
  }
  return game.fruits.find((f) => f.id === top[0])!
}

/** The ejected fruit's last words, then into the Juicer. */
export async function eject(game: Game, pace: Pace, out: SimFruit, lastWords: string, byBentMemory: boolean) {
  const t = round(game.time)
  const votes = game.public.filter((e) => e.kind === 'vote' && e.t === t && e.target === out.id).length
  out.alive = false
  out.diedAt = game.time
  game.publicDead.add(out.id)
  game.public.push({ t, kind: 'eject', who: out.id, role: game.rules.confirmEjects ? out.role : undefined })
  game.stats.ejections.push({ who: out.id, role: out.role, byBentMemory })
  logEvent(game, { t, kind: 'eject', who: out.id, role: out.role, votes, lastWords })
  await pace(4)
}

/** Back to roaming: cooldowns reset, lights back on, everyone decides afresh. */
export function endMeeting(game: Game) {
  game.meeting = null
  game.lightsOut = false
  game.buttonReadyAt = game.time + BUTTON_COOLDOWN
  for (const f of game.fruits) {
    f.decideAt = game.time
    if (f.role === 'rotten') f.killReadyAt = game.time + game.rules.killCooldown
  }
  if (!checkWin(game)) game.phase = 'roam'
}

/** A bare meeting: gather, vote, eject. Talk arrives with milestone 6. */
export async function runMeeting(game: Game, pace: Pace = noPace) {
  const m = game.meeting!
  game.stats.meetings++
  gather(game)
  const t = round(game.time)
  game.public.push({ t, kind: 'meeting', reason: m.reason, caller: m.caller, victim: m.body?.id, room: m.body?.area })
  logEvent(game, { t, kind: 'meeting', reason: m.reason, caller: m.caller, victim: m.body?.id, room: m.body?.area })
  await pace(3)
  const out = await runVote(game, pace, [])
  if (out) await eject(game, pace, out, '', false)
  endMeeting(game)
}
