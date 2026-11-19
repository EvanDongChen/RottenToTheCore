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

/**
 * Fruits being moved by the screen alone, not by the sim: carried to the Juicer, waddling in to
 * a meeting, or held at a vent while they climb in. The sim has already put them where they end up.
 */
interface Override {
  path: Vec2[]
  pos: Vec2
  /** World units per sim second, so it keeps pace at any game speed. */
  speed: number
  /** Held in place until this real time (performance.now()), even with nowhere left to walk. */
  holdUntil?: number
  done?: () => void
}
const overrides = new Map<string, Override>()
/** How fast carried fruits move, in world units per sim second. */
const CARRY_SPEED = 3.4

/** Walk these fruits along `paths` on screen only; `done` runs when the first one arrives. */
export function carry(paths: Record<string, Vec2[]>, from: Record<string, Vec2>, done?: () => void, speed = CARRY_SPEED) {
  let first = true
  for (const id in paths) {
    overrides.set(id, {
      path: [...paths[id]],
      pos: from[id],
      speed,
      done: first ? done : undefined,
    })
    first = false
  }
}

/** Keep a fruit on screen at `at` for `ms` real milliseconds (it is climbing into a vent), then let the sim have it. */
export function hold(id: string, at: Vec2, ms: number, done?: () => void) {
  overrides.set(id, { path: [], pos: at, speed: 0, holdUntil: performance.now() + ms, done })
}

/** Is the screen moving this fruit right now, rather than the sim? */
export function overridden(id: string) {
  return overrides.has(id)
}

/** How long, in real ms, a meeting will wait past its time for an ejection to finish on screen. */
const ANIMATION_GRACE_MS = 9000

/** Slow motion: real time runs at this share until `slowUntil`. */
const SLOW = 0.25

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
  useSim.setState({ slowUntil: 0 })
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
        // An ejection on screen holds the meeting until the fruit is in the Juicer (a few seconds at most).
        const { ejecting, juicing } = useSim.getState()
        const animating = (ejecting || juicing) && left > -ANIMATION_GRACE_MS * speed
        if ((left <= 0 && !animating) || game !== currentGame()) resolve()
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
  // A dramatic moment (a witnessed kill) runs in slow motion for a beat.
  if (performance.now() < useSim.getState().slowUntil) delta *= SLOW
  const game = currentGame()
  const { paused, speed, time, screen } = useSim.getState()
  // Behind the title and setup screens a harmless demo game plays, so the lab is never still.
  const running = true
  void screen

  if (running && game.phase === 'meeting' && !meeting) {
    syncFruits(game)
    const done = runMeeting(game, browserPace(game)).finally(() => {
      if (meeting === done) meeting = null
      // A carry still going when the meeting ends finishes at once.
      for (const o of overrides.values()) o.done?.()
      for (const [id, o] of overrides) if (!o.holdUntil) overrides.delete(id)
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

  // Fruits moved by the screen follow their own path.
  const now = performance.now()
  for (const [id, o] of overrides) {
    const v = o.speed * speed * (paused ? 0 : 1)
    let left = v * Math.min(delta, MAX_FRAME)
    let vx = 0
    let vz = 0
    while (left > 0 && o.path.length) {
      const [tx, tz] = o.path[0]
      const dx = tx - o.pos[0]
      const dz = tz - o.pos[1]
      const d = Math.hypot(dx, dz)
      vx = (dx / (d || 1)) * v
      vz = (dz / (d || 1)) * v
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
    if (o.path.length || (o.holdUntil && now < o.holdUntil)) continue
    o.done?.()
    o.done = undefined
    // Held fruits are handed back at once; carried ones linger until the meeting ends.
    if (o.holdUntil || game.phase === 'roam') overrides.delete(id)
  }

  if (Math.abs(game.time - time) >= SYNC_EVERY || useSim.getState().phase !== game.phase) {
    useSim.setState({ time: game.time })
    syncFruits(game)
  }
}
