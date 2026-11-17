import { step, TICK } from '../sim/engine'
import type { Vec2 } from '../sim/types'
import { currentGame, simTargets, useSim } from './store'

/** Never run more than this many ticks in one frame, so a long stall can't freeze the tab. */
const MAX_TICKS_PER_FRAME = 120
/** A frame longer than this (a background tab coming back) is treated as this long. */
const MAX_FRAME = 0.1
/** How often, in sim seconds, the clock on screen is refreshed. */
const CLOCK_EVERY = 0.5

let carried = 0
let lastGame = currentGame()
/** Each fruit's position before the most recent tick, for smoothing between ticks. */
const before = new Map<string, Vec2>()

/**
 * Called once per animation frame. Runs as many ticks as the speed setting asks for, then
 * publishes where each fruit is, blended between the last two ticks so motion stays smooth at 1x.
 */
export function advance(delta: number) {
  const game = currentGame()
  if (game !== lastGame) {
    lastGame = game
    carried = 0
    before.clear()
  }
  const { paused, speed, time } = useSim.getState()

  if (!paused) {
    carried += Math.min(delta, MAX_FRAME) * speed
    let ticks = 0
    while (carried >= TICK && ticks < MAX_TICKS_PER_FRAME) {
      for (const f of game.fruits) before.set(f.id, f.pos)
      step(game)
      carried -= TICK
      ticks++
    }
    if (ticks === MAX_TICKS_PER_FRAME) carried = 0
  }

  const blend = carried / TICK
  const pace = paused ? 0 : speed
  for (const f of game.fruits) {
    const [px, pz] = before.get(f.id) ?? f.pos
    simTargets.set(f.id, {
      x: px + (f.pos[0] - px) * blend,
      z: pz + (f.pos[1] - pz) * blend,
      vx: f.vel[0] * pace,
      vz: f.vel[1] * pace,
    })
  }

  if (Math.abs(game.time - time) >= CLOCK_EVERY || useSim.getState().phase !== game.phase) {
    useSim.setState({ time: game.time, phase: game.phase })
  }
}
