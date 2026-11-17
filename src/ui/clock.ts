import { step, TICK } from '../sim/engine'
import type { Game } from '../sim/engine'
import { runMeeting } from '../sim/meeting'
import type { Vec2 } from '../sim/types'
import { attach, syncFruits } from './events'
import { currentGame, onGameSwap, simTargets, useSim } from './store'

/** Never run more than this many ticks in one frame, so a long stall can't freeze the tab. */
const MAX_TICKS_PER_FRAME = 120
/** A frame longer than this (a background tab coming back) is treated as this long. */
const MAX_FRAME = 0.1
/** How often, in sim seconds, the clock and fruit snapshot on screen are refreshed. */
const SYNC_EVERY = 0.5

/** Fruits being moved by the screen alone (carried to the Juicer), not by the sim. */
const overrides = new Map<string, { path: Vec2[]; pos: Vec2; done?: () => void }>()
/** How fast carried fruits move, in world units per sim second (so it keeps pace at any speed). */
const CARRY_SPEED = 3.4

/** Walk these fruits along `paths` on screen only; `done` runs when the first one arrives. */
export function carry(paths: Record<string, Vec2[]>, from: Record<string, Vec2>, done: () => void) {
  let first = true
  for (const id in paths) {
    overrides.set(id, {
      path: [...paths[id]],
      pos: from[id],
      done: first ? done : undefined,
    })
    first = false
  }
}

let carried = 0
/** Each fruit's position before the most recent tick, for smoothing between ticks. */
const before = new Map<string, Vec2>()
/** The meeting being played out, if any. */
let meeting: Promise<void> | null = null

function reset(game: Game) {
  carried = 0
  before.clear()
  meeting = null
  overrides.clear()
  attach(game)
}
reset(currentGame())
onGameSwap(reset)

/**
 * Lets sim time pass in a meeting, in real time: `simSeconds` at 1x, less when sped up, and not
 * at all while paused. Returns at once if the game has been replaced.
 */
function browserPace(game: Game) {
  return (simSeconds: number) =>
    new Promise<void>((resolve) => {
      let left = simSeconds * 1000
      let last = performance.now()
      const wait = () => {
        const now = performance.now()
        const { paused, speed } = useSim.getState()
        if (!paused) left -= (now - last) * speed
        last = now
        if (left <= 0 || game !== currentGame()) resolve()
        else setTimeout(wait, 30)
      }
      wait()
    })
}

/**
 * Called once per animation frame. Runs as many ticks as the speed setting asks for (or plays
 * out a meeting), then publishes where each fruit is, blended between the last two ticks so
 * motion stays smooth at 1x.
 */
export function advance(delta: number) {
  const game = currentGame()
  const { paused, speed, time, screen } = useSim.getState()
  // The title screen and setup show the fruits idling in the lab, without a game running.
  const running = screen === 'game'

  if (running && game.phase === 'meeting' && !meeting) {
    syncFruits(game)
    const done = runMeeting(game, browserPace(game)).finally(() => {
      if (meeting === done) meeting = null
      // A carry still going when the meeting ends finishes at once.
      for (const o of overrides.values()) o.done?.()
      overrides.clear()
      syncFruits(game)
    })
    meeting = done
  }

  if (running && !paused && game.phase === 'roam') {
    carried += Math.min(delta, MAX_FRAME) * speed
    let ticks = 0
    while (carried >= TICK && ticks < MAX_TICKS_PER_FRAME && game.phase === 'roam') {
      for (const f of game.fruits) before.set(f.id, f.pos)
      step(game)
      carried -= TICK
      ticks++
    }
    if (ticks === MAX_TICKS_PER_FRAME || game.phase !== 'roam') carried = 0
  }

  const blend = game.phase === 'roam' ? carried / TICK : 1
  const pace = paused || game.phase !== 'roam' || !running ? 0 : speed
  for (const f of game.fruits) {
    if (overrides.has(f.id)) continue
    const [px, pz] = before.get(f.id) ?? f.pos
    // A jump of more than a few units is a teleport (a vent, or seating for a meeting): no blending.
    const jump = Math.abs(f.pos[0] - px) + Math.abs(f.pos[1] - pz) > 3
    simTargets.set(f.id, {
      x: jump ? f.pos[0] : px + (f.pos[0] - px) * blend,
      z: jump ? f.pos[1] : pz + (f.pos[1] - pz) * blend,
      vx: f.vel[0] * pace,
      vz: f.vel[1] * pace,
    })
  }

  // Carried fruits follow their own path on screen.
  const carrySpeed = CARRY_SPEED * speed * (paused ? 0 : 1)
  for (const [id, o] of overrides) {
    let left = carrySpeed * Math.min(delta, MAX_FRAME)
    let vx = 0
    let vz = 0
    while (left > 0 && o.path.length) {
      const [tx, tz] = o.path[0]
      const dx = tx - o.pos[0]
      const dz = tz - o.pos[1]
      const d = Math.hypot(dx, dz)
      vx = (dx / (d || 1)) * carrySpeed
      vz = (dz / (d || 1)) * carrySpeed
      if (d <= left) {
        o.pos = [tx, tz]
        o.path.shift()
        left -= d
      } else {
        o.pos = [o.pos[0] + (dx / d) * left, o.pos[1] + (dz / d) * left]
        left = 0
      }
    }
    simTargets.set(id, { x: o.pos[0], z: o.pos[1], vx: o.path.length ? vx : 0, vz: o.path.length ? vz : 0 })
    if (!o.path.length) {
      o.done?.()
      o.done = undefined
      // Carriers linger until the meeting ends, then the sim takes them back.
      if (game.phase === 'roam') overrides.delete(id)
    }
  }

  if (Math.abs(game.time - time) >= SYNC_EVERY || useSim.getState().phase !== game.phase) {
    useSim.setState({ time: game.time })
    syncFruits(game)
  }
}
