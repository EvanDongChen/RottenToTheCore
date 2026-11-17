import type { RoamAction } from './brains/types'
import { DECIDE_EVERY, FIX_TIME, REPORT_REACH, SABOTAGE_COOLDOWN, STATION_REACH, TICK, VENT_REACH, WALK_SPEED } from './constants'
import { fruitById, logEvent } from './engine'
import type { Body, Game, SimFruit } from './engine'
import { round } from './log'
import { areaAt, BUTTON, BUTTON_REACH, dist, FUSE_BOX, isRoom, OBSTACLE_MARGIN, OBSTACLES, randomSpot, station, STATIONS, vent, VENTS } from './map'
import { feel } from './mind'
import { findPath } from './nav'
import { clearLine, sees, visionRadius } from './perception'
import type { Vec2 } from './types'
import { viewFor } from './view'
import { addSighting, maintainMemory } from './witness'

/** Brains' beliefs are copied to the mind for the screen at most this often. */
const BELIEFS_EVERY = 3
/** A chasing or following fruit re-plans its path this often, in ticks. */
const CHASE_REPLAN = 5
const FOLLOW_GAP = 2.5

// ---------- Walking ----------

/** Move a fruit along its path by one tick's worth of walking. */
export function walk(game: Game, f: SimFruit) {
  const [startX, startZ] = f.pos
  let left = WALK_SPEED * TICK
  while (left > 0 && f.path.length) {
    const [tx, tz] = f.path[0]
    const dx = tx - f.pos[0]
    const dz = tz - f.pos[1]
    // Math.sqrt rather than Math.hypot: hypot's rounding is not pinned down by the spec.
    const d = Math.sqrt(dx * dx + dz * dz)
    if (d <= left) {
      f.pos = [tx, tz]
      f.path.shift()
      left -= d
    } else {
      f.pos = avoidObstacles(f.pos, [f.pos[0] + (dx / d) * left, f.pos[1] + (dz / d) * left], f.lane)
      left = 0
    }
  }
  f.vel = [(f.pos[0] - startX) / TICK, (f.pos[1] - startZ) / TICK]
  void game
}

/**
 * A step that would end inside an obstacle slides round its edge instead, always the same way
 * for the same fruit, so a fruit walking straight at the table goes round it rather than stopping.
 */
export function avoidObstacles(from: Vec2, to: Vec2, lane: number): Vec2 {
  for (const o of OBSTACLES) {
    const keep = o.radius + OBSTACLE_MARGIN
    if (dist(to, o.at) >= keep) continue
    const rx = from[0] - o.at[0]
    const rz = from[1] - o.at[1]
    const r = Math.sqrt(rx * rx + rz * rz) || 1
    const step = dist(from, to)
    // Tangent direction, picked by which side the step was heading, or the lane when dead on.
    const side = Math.sign(rx * (to[1] - from[1]) - rz * (to[0] - from[0])) || (lane >= 0 ? 1 : -1)
    const tx = (-rz / r) * side
    const tz = (rx / r) * side
    // Stepping along the tangent from outside the rim always ends further out, so no
    // correction is needed; only a fruit that somehow started inside is pushed back out.
    const nx = from[0] + tx * step - o.at[0]
    const nz = from[1] + tz * step - o.at[1]
    const n = Math.sqrt(nx * nx + nz * nz) || 1
    if (n >= keep) return [o.at[0] + nx, o.at[1] + nz]
    return [o.at[0] + (nx / n) * keep, o.at[1] + (nz / n) * keep]
  }
  return to
}

/** Plan a path to `goal`, unless already heading there. */
function walkTo(f: SimFruit, goal: Vec2) {
  if (f.goal && dist(goal, f.goal) < 0.3 && (f.path.length || dist(f.pos, goal) < 0.3)) return
  f.path = findPath(f.pos, goal, f.lane)
  f.goal = goal
}

export function stop(f: SimFruit) {
  f.path = []
  f.goal = null
}

/** Where a fruit stands to work at a station: shifted a little by its lane, so two can share. */
export function stationSpot(id: string, lane: number): Vec2 {
  const at = station(id).at
  return [at[0] + lane * 0.7, at[1]]
}

/** The spot at the table's edge nearest the fruit, to press the button from. */
function buttonSpot(f: SimFruit): Vec2 {
  const dx = f.pos[0] - BUTTON[0]
  const dz = f.pos[1] - BUTTON[1]
  const d = Math.sqrt(dx * dx + dz * dz) || 1
  const r = BUTTON_REACH - 0.2
  return [BUTTON[0] + (dx / d) * r, BUTTON[1] + (dz / d) * r]
}

// ---------- Deciding ----------

/** A crew ghost just keeps doing its tasks. */
function ghostAction(f: SimFruit): RoamAction {
  const next = f.tasks.find((t) => !t.done)
  return next ? { kind: 'goTask', station: next.station } : { kind: 'idle' }
}

/** Ask the fruit's brain what to do next, and start doing it. */
export function decide(game: Game, f: SimFruit) {
  f.decideAt = game.time + DECIDE_EVERY
  if (game.time < f.busyUntil) return
  if (!f.alive) {
    setAction(game, f, ghostAction(f))
    return
  }
  maintainMemory(game, f)
  const brain = game.brains.get(f.id)!
  const view = viewFor(game, f)
  if (game.time - (f.mind.beliefsAt ?? -Infinity) >= BELIEFS_EVERY) {
    f.mind.beliefs = brain.beliefs(view)
    f.mind.beliefsAt = game.time
  }
  setAction(game, f, repair(game, f, brain.roam(view)))
}

const same = (a: RoamAction, b: RoamAction) => JSON.stringify(a) === JSON.stringify(b)

/** Turn whatever the brain asked for into something legal. Never throws. */
export function repair(game: Game, f: SimFruit, a: RoamAction | undefined): RoamAction {
  const fallback = (): RoamAction => {
    const next = f.role === 'crew' ? f.tasks.find((t) => !t.done) : undefined
    return next ? { kind: 'goTask', station: next.station } : { kind: 'wander', room: areaAt(f.pos) }
  }
  if (!a || typeof a !== 'object') return fallback()
  const rotten = f.role === 'rotten' && f.alive
  const target = 'who' in a ? fruitById(game, a.who) : undefined
  switch (a.kind) {
    case 'goTask':
      if (f.role === 'rotten') return STATIONS.some((s) => s.id === a.station) ? { kind: 'fakeTask', station: a.station } : fallback()
      return f.tasks.some((t) => t.station === a.station && !t.done) ? a : fallback()
    case 'fakeTask':
      if (!rotten) return fallback()
      return STATIONS.some((s) => s.id === a.station) ? a : fallback()
    case 'wander':
      return isRoom(a.room) || a.room === areaAt(f.pos) ? a : fallback()
    case 'follow':
      return target && target !== f && target.alive ? a : fallback()
    case 'report':
      return game.bodies.some((b) => b.id === a.body) ? a : fallback()
    case 'emergency':
      return f.emergencies > 0 ? a : fallback()
    case 'fixSabotage':
      return game.lightsOut ? a : fallback()
    case 'idle':
      return a
    case 'kill':
      return rotten && target && target.alive && target.role === 'crew' ? a : fallback()
    case 'vent':
      return rotten && VENTS.some((v) => v.id === a.to) ? a : fallback()
    case 'sabotage':
      return rotten && a.what === 'lights' ? a : fallback()
    default:
      return fallback()
  }
}

/** Start doing an action. Keeps the current path if nothing really changed. */
export function setAction(game: Game, f: SimFruit, a: RoamAction) {
  if (same(a, f.action) && a.kind !== 'idle') return
  f.action = a
  f.fixSince = null
  switch (a.kind) {
    case 'goTask':
    case 'fakeTask':
      walkTo(f, stationSpot(a.station, f.lane))
      break
    case 'wander':
      walkTo(f, randomSpot(f.rng, a.room))
      break
    case 'report': {
      const body = game.bodies.find((b) => b.id === a.body)
      if (body) walkTo(f, body.pos)
      break
    }
    case 'emergency':
      walkTo(f, buttonSpot(f))
      break
    case 'fixSabotage':
      walkTo(f, FUSE_BOX)
      break
    case 'vent': {
      const entry = VENTS.find((v) => v.to === a.to)!
      walkTo(f, entry.at)
      break
    }
    case 'idle':
      stop(f)
      break
    // follow and kill re-plan as they go, in resolveActions.
  }
}

// ---------- Resolving ----------

/** Work, kills, reports, vents and sabotage, for everyone, once per tick. */
export function resolveActions(game: Game) {
  for (const f of game.fruits) {
    if (game.phase !== 'roam') return
    if (game.time < f.busyUntil) continue
    const a = f.action
    // Standing at a station: working (crew) or pretending (Rotten).
    const atStation = (a.kind === 'goTask' || a.kind === 'fakeTask') && !f.path.length && dist(f.pos, stationSpot(a.station, f.lane)) < STATION_REACH
    if (atStation) {
      if (f.working !== a.station) {
        f.working = a.station
        f.workSince = game.time
      }
      if (a.kind === 'goTask') work(game, f, a.station)
    } else f.working = null
    if (!f.alive) continue

    switch (a.kind) {
      case 'follow': {
        const t = fruitById(game, a.who)!
        if (!t.alive) {
          f.decideAt = game.time
          break
        }
        if (game.tick % CHASE_REPLAN === 0 && sees(game, f.id, t.id)) {
          if (dist(f.pos, t.pos) > FOLLOW_GAP) walkTo(f, t.pos)
          else stop(f)
        }
        break
      }
      case 'kill': {
        const t = fruitById(game, a.who)!
        if (!t.alive) {
          f.decideAt = game.time
          break
        }
        if (dist(f.pos, t.pos) <= game.rules.killRange && game.time >= f.killReadyAt) kill(game, f, t)
        else if (game.tick % CHASE_REPLAN === 0) {
          if (sees(game, f.id, t.id)) walkTo(f, t.pos)
          else f.decideAt = game.time
        }
        break
      }
      case 'report': {
        const body = game.bodies.find((b) => b.id === a.body)
        if (body && dist(f.pos, body.pos) <= REPORT_REACH && game.vision.bodies.get(f.id)?.includes(body.id)) callMeeting(game, 'body', f, body)
        else if (!body) f.decideAt = game.time
        break
      }
      case 'emergency':
        if (dist(f.pos, BUTTON) <= BUTTON_REACH + 0.3) {
          if (f.emergencies > 0 && game.time >= game.buttonReadyAt) callMeeting(game, 'emergency', f)
          else if (f.emergencies <= 0) f.decideAt = game.time
        }
        break
      case 'fixSabotage':
        if (!game.lightsOut) f.decideAt = game.time
        else if (dist(f.pos, FUSE_BOX) < 0.8) {
          f.fixSince ??= game.time
          if (game.time - f.fixSince >= FIX_TIME) {
            game.lightsOut = false
            game.sabotageReadyAt = game.time + SABOTAGE_COOLDOWN
            logEvent(game, { t: round(game.time), kind: 'fixed', who: f.id, what: 'lights' })
            f.decideAt = game.time
          }
        }
        break
      case 'vent': {
        const entry = VENTS.find((v) => v.to === a.to)!
        if (dist(f.pos, entry.at) <= VENT_REACH) useVent(game, f, entry.id, a.to)
        break
      }
      case 'sabotage':
        if (!game.lightsOut && game.time >= game.sabotageReadyAt) {
          game.lightsOut = true
          game.stats.sabotages++
          logEvent(game, { t: round(game.time), kind: 'sabotage', who: f.id, what: 'lights' })
          for (const o of game.fruits) if (o.alive && o.role === 'crew') feel(o.mind, 'fear', 0.15 + (1 - o.def.traits.aggression) * 0.15)
        }
        f.action = { kind: 'idle' }
        f.decideAt = game.time
        break
    }
  }
}

/** One tick of real work at a station. */
function work(game: Game, f: SimFruit, stationId: string) {
  const task = f.tasks.find((t) => t.station === stationId && !t.done)
  if (!task || f.role !== 'crew') return
  task.progress = Math.min(task.duration, task.progress + TICK)
  if (task.progress >= task.duration - 1e-9) {
    task.done = true
    f.working = null
    logEvent(game, { t: round(game.time), kind: 'task', who: f.id, station: stationId, ghost: !f.alive })
    f.decideAt = game.time
  }
}

/** Fruits that see this point right now (living, not `except`). */
function watchersOf(game: Game, p: Vec2, except: string[]): SimFruit[] {
  const area = areaAt(p)
  return game.fruits.filter((o) => o.alive && !except.includes(o.id) && dist(o.pos, p) <= visionRadius(game, o) && clearLine(o.pos, o.area, p, area))
}

function kill(game: Game, killer: SimFruit, victim: SimFruit) {
  // Anyone who could see both of them at that moment saw it happen.
  const witnesses = game.fruits.filter((o) => o.alive && o !== killer && o !== victim && sees(game, o.id, killer.id) && sees(game, o.id, victim.id))
  victim.alive = false
  victim.diedAt = game.time
  stop(victim)
  victim.busyUntil = 0
  victim.talkingTo = null
  victim.decideAt = game.time + 2
  const body: Body = { id: victim.id, pos: victim.pos, area: victim.area, time: game.time, killer: killer.id }
  game.bodies.push(body)
  killer.killReadyAt = game.time + game.rules.killCooldown
  killer.action = { kind: 'idle' }
  killer.decideAt = game.time
  game.stats.kills++
  if (witnesses.length) game.stats.witnessedKills++
  for (const w of witnesses) {
    addSighting(game, w, { kind: 'kill', who: killer.id, room: victim.area, victim: victim.id })
    w.seenBodies.push(victim.id)
    feel(w.mind, 'fear', 0.6)
    feel(w.mind, 'anger', 0.2 + w.def.traits.aggression * 0.3)
    w.decideAt = game.time
  }
  feel(killer.mind, 'smug', 0.3)
  logEvent(game, { t: round(game.time), kind: 'kill', killer: killer.id, victim: victim.id, at: [round(victim.pos[0]), round(victim.pos[1])], room: victim.area, witnesses: witnesses.map((w) => w.id) })
}

function useVent(game: Game, f: SimFruit, fromId: string, toId: string) {
  const exit = vent(toId)
  // Anyone watching the hatch as it goes in, or the other hatch as it pops out.
  const seenIn = game.fruits.filter((o) => o.alive && o !== f && sees(game, o.id, f.id))
  f.pos = exit.at
  f.area = areaAt(exit.at)
  f.trail.push({ area: f.area, from: game.time, to: game.time })
  stop(f)
  const seenOut = watchersOf(game, exit.at, [f.id, ...seenIn.map((o) => o.id)])
  const seenBy = [...seenIn, ...seenOut]
  for (const o of seenBy) {
    addSighting(game, o, { kind: 'vented', who: f.id, room: seenIn.includes(o) ? vent(fromId).room : exit.room })
    feel(o.mind, 'fear', 0.4)
    o.decideAt = game.time
  }
  game.stats.vents++
  logEvent(game, { t: round(game.time), kind: 'vent', who: f.id, from: fromId, to: toId, seenBy: seenBy.map((o) => o.id) })
  f.action = { kind: 'idle' }
  f.decideAt = game.time + 0.5
}

/** Someone reported a body or pressed the button: roam time stops and the meeting begins. */
export function callMeeting(game: Game, reason: 'body' | 'emergency', caller: SimFruit, body?: Body) {
  if (reason === 'emergency') caller.emergencies--
  game.phase = 'meeting'
  game.meeting = { reason, caller: caller.id, body, at: game.time }
  if (body) logEvent(game, { t: round(game.time), kind: 'found', who: caller.id, body: body.id })
}
