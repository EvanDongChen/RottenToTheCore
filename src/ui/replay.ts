import { createGame } from '../sim/engine'
import type { Game } from '../sim/engine'
import { fastForward } from '../sim/game'
import { hashLog } from '../sim/log'
import type { ReplaySetup, SimEvent } from '../sim/log'
import { rebuild } from './events'
import { currentGame, useSim } from './store'
import type { Replay } from './store'

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

/** Replay the game on screen from the start: the same setup, played again. */
export function replayThisGame() {
  const game = currentGame()
  start(game.setup, { from: 'game', length: lengthOf(game.log) })
}

/** Load a JSON-lines event log (from `npm run sim -- --log file`) and replay it. */
export function replayFromText(text: string): string | null {
  const log = text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as SimEvent)
  const startEvent = log[0]
  if (!startEvent || startEvent.kind !== 'start' || !startEvent.setup) return 'That file is not a Rotten to the Core event log.'
  start(startEvent.setup, { from: 'file', length: lengthOf(log), expectHash: hashLog(log) })
  return null
}

function start(setup: ReplaySetup, replay: Replay) {
  const game = createGame(setup)
  useSim.getState().adoptGame(game, { replay, paused: false, revealRoles: true, selected: null })
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
