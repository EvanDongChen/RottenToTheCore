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
