import { createGame } from '../sim/engine'
import type { Game } from '../sim/engine'
import { fastForward } from '../sim/game'
import { hashLog } from '../sim/log'
import type { ReplaySetup, SimEvent } from '../sim/log'
import { rebuild } from './events'
import { currentGame, useSim } from './store'
import type { Replay, ReplayMark } from './store'

/**
 * Replays. A game without the LLM is fully decided by its setup (seed, roster, rules, brains),
 * so a replay plays the same game again rather than streaming positions back. Seeking jumps by
 * re-simulating headless up to the chosen moment, then picks up live from there. A loaded log is
 * checked against the replay: when it ends, the two event logs must hash the same.
 */

/** How long a game lasts, from its log: the last thing that happened. */
function lengthOf(log: readonly SimEvent[]): number {
  return log.reduce((m, e) => Math.max(m, e.t), 0)
}

/** The moments worth jumping to: every kill, meeting and ejection, named for the timeline. */
export function marksOf(log: readonly SimEvent[]): ReplayMark[] {
  const names = new Map<string, string>()
  const start = log[0]
  if (start?.kind === 'start') for (const f of start.roster) names.set(f.id, f.name)
  const n = (id: string) => names.get(id) ?? id
  const marks: ReplayMark[] = []
  for (const e of log) {
    if (e.kind === 'kill') marks.push({ t: e.t, kind: 'kill', label: `${n(e.killer)} kills ${n(e.victim)}` })
    else if (e.kind === 'meeting') marks.push({ t: e.t, kind: 'meeting', label: e.reason === 'body' ? `${n(e.caller)} reports ${e.victim ? n(e.victim) : 'a body'}` : `${n(e.caller)} calls a meeting` })
    else if (e.kind === 'eject') marks.push({ t: e.t, kind: 'eject', label: `${n(e.who)} goes in the Juicer` })
  }
  return marks
}

/** Replay the game on screen from the start: the same setup, played again. */
export function replayThisGame() {
  const game = currentGame()
  start(game.setup, { from: 'game', length: lengthOf(game.log), marks: marksOf(game.log) })
}

/** Load a JSON-lines event log (from `npm run sim -- --log file`) and replay it. */
export function replayFromText(text: string): string | null {
  const log = text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as SimEvent)
  const startEvent = log[0]
  if (!startEvent || startEvent.kind !== 'start' || !startEvent.setup) return 'That file is not a Rotten to the Core event log.'
  start(startEvent.setup, { from: 'file', length: lengthOf(log), expectHash: hashLog(log), marks: marksOf(log) })
  return null
}

function start(setup: ReplaySetup, replay: Replay) {
  const game = createGame(setup)
  useSim.getState().adoptGame(game, { replay, paused: false, revealRoles: true, selected: null, follow: null })
}

let seeking = 0

/** Jump the replay to sim time `t`: play the game again headless up to there, then go on live. */
export async function seek(t: number) {
  const { replay } = useSim.getState()
  if (!replay) return
  const ticket = ++seeking
  const game: Game = createGame(currentGame().setup)
  await fastForward(game, t)
  // A later seek started while this one was running: let that one win.
  if (ticket !== seeking) return
  useSim.getState().adoptGame(game, { replay: { ...replay, verified: undefined }, selected: useSim.getState().selected })
  rebuild(game)
}

/** Called when a replayed game ends: does it match the log it came from? */
export function checkReplay(game: Game) {
  const { replay } = useSim.getState()
  if (!replay?.expectHash || game !== currentGame()) return
  useSim.setState({ replay: { ...replay, verified: hashLog(game.log) === replay.expectHash } })
}
