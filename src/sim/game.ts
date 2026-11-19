import { createGame, step } from './engine'
import type { Game, GameSetup } from './engine'
import { runMeeting } from './meeting'
import type { Pace } from './meeting'

/** Play a whole game to the end, as fast as possible (headless), or paced (`pace`). */
export async function playGame(setup: GameSetup | Game, pace?: Pace): Promise<Game> {
  const game = 'fruits' in setup ? setup : createGame(setup)
  while (game.phase !== 'over') {
    if (game.phase === 'meeting') await runMeeting(game, pace)
    else step(game)
  }
  return game
}

/** Play a game forward (meetings instantly) until sim time `t`, or the end. For replays and seeking. */
export async function fastForward(game: Game, t: number): Promise<Game> {
  while (game.phase !== 'over' && game.time < t - 1e-9) {
    if (game.phase === 'meeting') await runMeeting(game)
    else step(game)
  }
  // Land on a roaming tick, not in the middle of a meeting that was just called.
  if (game.phase === 'meeting') await runMeeting(game)
  return game
}
