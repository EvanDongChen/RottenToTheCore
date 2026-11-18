import { fruitById, nameOf, taskBar } from '../sim/engine'
import type { Game } from '../sim/engine'
import type { SimEvent } from '../sim/log'
import { placeName, vent } from '../sim/map'
import { findPath } from '../sim/nav'
import type { Role, Vec2 } from '../sim/types'
import { carry } from './clock'
import { checkReplay } from './replay'
import { alarm, babble, cheer, clang, gasp, horn, powerDown, slice, startParty, sulk, taskBeep, thud, voteTick } from './sfx'
import { currentGame, uiFruits, useSim } from './store'
import type { FeedEntry, Shot, SimState } from './store'

/**
 * Turns the sim's events into what the viewer sees and hears: speech bubbles, reactions, comic
 * bursts, cards and the log. Timers are in real milliseconds, shortened when the game is sped up.
 */

let key = 1
const MAX_FEED = 400
/** While rebuilding the screen from a game's history: no sounds, cards, bubbles or timers. */
let quiet = false

/** Play a sound unless rebuilding. */
function sfx(play: () => void) {
  if (!quiet) play()
}

/** Real milliseconds for something that should last `ms` at 1x, shortened at higher speeds. */
function scaled(ms: number) {
  return ms / Math.sqrt(useSim.getState().speed)
}

/** Run `fn` after `simSeconds` of game time (real time divided by the speed), while this game lasts. */
function laterSim(game: Game, simSeconds: number, fn: () => void) {
  if (quiet) return
  setTimeout(() => {
    if (game === currentGame()) fn()
  }, (simSeconds * 1000) / useSim.getState().speed)
}

function later(game: Game, ms: number, fn: () => void) {
  if (quiet) return
  setTimeout(() => {
    if (game === currentGame()) fn()
  }, scaled(ms))
}

function feed(entry: Omit<FeedEntry, 'key'>) {
  useSim.setState((s) => ({ feed: [...s.feed, { ...entry, key: key++ }].slice(-MAX_FEED) }))
}

function card(title: string, sub: string, dark = false) {
  if (quiet) return
  useSim.setState({ card: { key: key++, title, sub, dark } })
}

function burst(text: string, x: number, z: number) {
  if (quiet) return
  const b = { key: key++, text, at: [x, 2.4, z] as [number, number, number] }
  useSim.setState((s) => ({ bursts: [...s.bursts, b] }))
  setTimeout(() => useSim.setState((s) => ({ bursts: s.bursts.filter((o) => o.key !== b.key) })), 1400)
}

function react(game: Game, id: string, how: SimState['reactions'][string], ms = 1600) {
  if (quiet) return
  useSim.setState((s) => ({ reactions: { ...s.reactions, [id]: how } }))
  later(game, ms, () => useSim.setState((s) => ({ reactions: { ...s.reactions, [id]: s.reactions[id] === how ? undefined : s.reactions[id] } })))
}

/** Show a speech bubble, babble it, and clear it after a while. */
export function say(game: Game, id: string, text: string, to?: string) {
  if (quiet) return
  const f = fruitById(game, id)
  if (!f) return
  const ms = 1400 + text.length * 45
  useSim.setState((s) => ({ speech: { ...s.speech, [id]: text }, lookAt: to ? { ...s.lookAt, [id]: to } : s.lookAt }))
  babble(f.def, key++, text, scaled(ms))
  later(game, ms, () =>
    useSim.setState((s) => ({
      speech: { ...s.speech, [id]: s.speech[id] === text ? undefined : s.speech[id] },
      lookAt: to && s.lookAt[id] === to ? { ...s.lookAt, [id]: undefined } : s.lookAt,
    })),
  )
}

/** Copy the fruits' state (alive, mood, beliefs) and the task bar into the store. */
export function syncFruits(game: Game) {
  if (game !== currentGame()) return
  // The ejected fruit stays upright on screen until it reaches the Juicer.
  const { ejecting, votes } = useSim.getState()
  const fruits = uiFruits(game).map((f) => (f.id === ejecting ? { ...f, alive: true } : f))
  // Vote crosses stay up for the ejection, then clear once roaming starts again.
  const clearVotes = game.phase === 'roam' && !ejecting && Object.keys(votes).length > 0
  useSim.setState({ fruits, taskBar: taskBar(game), phase: game.phase, lightsOut: game.lightsOut, meltdownAt: game.meltdown?.until ?? null, lockedRoom: game.locked?.room ?? null, ...(clearVotes ? { votes: {} } : {}) })
}

export function attach(game: Game) {
  game.onEvent = (e) => {
    if (game === currentGame()) handle(game, e)
  }
  // An LLM fruit's own words for a roaming line: swap them into the bubble.
  game.onRetext = (who, text) => {
    if (game === currentGame()) say(game, who, text)
  }
  game.onThinking = (who, on) => {
    if (game === currentGame()) useSim.setState((s) => ({ thinking: { ...s.thinking, [who]: on || undefined } }))
  }
}

function handle(game: Game, e: SimEvent) {
  const n = (id: string) => nameOf(game, id)
  switch (e.kind) {
    case 'kill': {
      const victim = fruitById(game, e.victim)!
      useSim.setState((s) => ({
        attack: { attackerId: e.killer, victimId: e.victim, striking: true },
        chopped: { ...s.chopped, [e.victim]: true },
        splats: [...s.splats, { id: e.victim, x: e.at[0], z: e.at[1], kind: victim.def.kind, size: 1.4, seed: key++ % 7 }],
      }))
      sfx(slice)
      burst('CHOP!', e.at[0], e.at[1])
      shot('kill', e.at)
      later(game, 900, () => useSim.setState({ attack: null }))
      feed({ t: e.t, tab: 'system', text: `${n(e.killer)} sliced ${n(e.victim)} in ${placeName(e.room)}${e.witnesses.length ? `, seen by ${e.witnesses.map(n).join(' and ')}` : ', unseen'}.` })
      syncFruits(game)
      break
    }
    case 'found':
      card('BODY REPORTED', `${n(e.who)} found ${n(e.body)}`)
      sfx(horn)
      sfx(gasp)
      react(game, e.who, 'gasp')
      feed({ t: e.t, tab: 'meeting', text: `${n(e.who)} reported ${n(e.body)}'s body.` })
      break
    case 'meeting': {
      if (e.reason === 'emergency') {
        card('EMERGENCY MEETING', `${n(e.caller)} pressed the button`)
        sfx(thud)
        sfx(alarm)
        feed({ t: e.t, tab: 'meeting', text: `${n(e.caller)} called an emergency meeting.` })
      }
      const dead = Object.fromEntries(game.fruits.filter((f) => !f.alive).map((f) => [f.id, true]))
      useSim.setState({ votes: {}, speech: {}, lookAt: {}, cleared: dead, splats: [], speaker: null, lightsOut: false, attack: null })
      syncFruits(game)
      break
    }
    case 'witness':
      if (e.saw === 'body') {
        const body = game.bodies.find((b) => b.id === e.about)
        if (body) shot('body', body.pos)
      }
      if (e.bent) {
        feed({ t: e.t, tab: 'sighting', text: `${n(e.who)}'s memory of ${n(e.about)} (${e.saw}) has bent.` })
        break
      }
      if (e.saw === 'body') {
        react(game, e.who, 'gasp')
        feed({ t: e.t, tab: 'sighting', text: `${n(e.who)} found ${n(e.about)}'s body.` })
      } else {
        react(game, e.who, 'shake', 2200)
        feed({ t: e.t, tab: 'sighting', text: `${n(e.who)} saw ${n(e.about)} ${e.saw === 'kill' ? 'kill' : 'use a vent'}!` })
      }
      break
    case 'vent': {
      const now = performance.now()
      useSim.setState((s) => ({ vents: { ...s.vents, [e.from]: now, [e.to]: now } }))
      sfx(clang)
      const v = vent(e.to)
      burst('CLANK!', v.at[0], v.at[1])
      shot('vent', v.at)
      feed({ t: e.t, tab: 'sighting', text: `${n(e.who)} vented from ${placeName(vent(e.from).room)} to ${placeName(v.room)}${e.seenBy.length ? `, seen by ${e.seenBy.map(n).join(' and ')}` : ''}.` })
      break
    }
    case 'sabotage':
      if (e.what === 'lights') {
        useSim.setState({ lightsOut: true })
        card('LIGHTS OUT', `${n(e.who)} cut the power`, true)
        sfx(powerDown)
        feed({ t: e.t, tab: 'system', text: `${n(e.who)} turned the lights off.` })
      } else if (e.what === 'meltdown') {
        useSim.setState({ meltdownAt: game.meltdown?.until ?? null })
        card('MELTDOWN', 'Hold both panels in the Ripening Chamber!', true)
        sfx(alarm)
        feed({ t: e.t, tab: 'system', text: `${n(e.who)} started a meltdown in the Ripening Chamber.` })
      } else {
        useSim.setState({ lockedRoom: e.room ?? null })
        sfx(clang)
        feed({ t: e.t, tab: 'system', text: `${n(e.who)} locked the doors of ${placeName(e.room ?? '')}.` })
      }
      break
    case 'fixed':
      if (e.what === 'lights') {
        useSim.setState({ lightsOut: false })
        feed({ t: e.t, tab: 'system', text: `${n(e.who)} fixed the lights.` })
      } else if (e.what === 'meltdown') {
        useSim.setState({ meltdownAt: null })
        card('MELTDOWN STOPPED', 'Just in time')
        sfx(cheer)
        feed({ t: e.t, tab: 'system', text: `${n(e.who)} and another fruit stopped the meltdown.` })
      } else {
        useSim.setState({ lockedRoom: null })
        feed({ t: e.t, tab: 'system', text: 'The doors opened again.' })
      }
      break
    case 'chat':
      say(game, e.who, e.say, e.to)
      feed({ t: e.t, tab: 'chat', text: `${n(e.who)} → ${n(e.to)}: ${e.say}` })
      break
    case 'encounter':
      if (e.what === 'sideEye' || e.what === 'hurry') react(game, e.a, e.what === 'hurry' ? 'shake' : 'puzzle', 1200)
      break
    case 'say':
      say(game, e.who, e.line.say)
      useSim.setState({ speaker: e.who, focusId: e.who })
      if (e.line.target && (e.line.move === 'accuse' || e.line.move === 'hardClaim' || e.line.move === 'contradict')) react(game, e.line.target, 'shake', 1800)
      feed({ t: e.t, tab: 'meeting', text: `${n(e.who)}: ${e.line.say}` })
      break
    case 'react':
      react(game, e.who, e.how === 'corroborate' ? 'blush' : 'puzzle', 1200)
      break
    case 'whisper':
      feed({ t: e.t, tab: 'chat', text: `(whisper) ${n(e.who)} → ${n(e.to)}: ${e.say}` })
      say(game, e.who, `🤫 ${e.say}`, e.to)
      break
    case 'vote':
      useSim.setState((s) => ({ votes: { ...s.votes, [e.voter]: e.target } }))
      sfx(voteTick)
      feed({ t: e.t, tab: 'meeting', text: `${n(e.voter)} votes ${e.target === 'skip' ? 'to skip' : `for ${n(e.target)}`}${e.reason ? `: "${e.reason}"` : ''}` })
      break
    case 'eject': {
      if (e.lastWords) say(game, e.who, e.lastWords)
      laterSim(game, 2.4, () => ejectOnScreen(game, e.who, e.role, e.votes))
      const confirm = game.rules.confirmEjects
      feed({ t: e.t, tab: 'meeting', text: `${n(e.who)} was ejected${confirm ? ` and was ${e.role === 'rotten' ? '' : 'not '}Rotten` : ''}.${e.lastWords ? ` Last words: "${e.lastWords}"` : ''}` })
      break
    }
    case 'noEject':
      card('NOBODY WAS EJECTED', e.tie ? 'A tie' : 'Skipped')
      sfx(sulk)
      feed({ t: e.t, tab: 'meeting', text: e.tie ? 'The vote was tied. Nobody was ejected.' : 'Nobody was ejected.' })
      break
    case 'task':
      sfx(taskBeep)
      if (game.tick % 2 === 0) syncFruits(game)
      break
    case 'over': {
      if (!quiet) checkReplay(game)
      if (!quiet) setTimeout(() => game === currentGame() && useSim.setState({ recapOpen: true }), 4500)
      const crewWon = e.winner === 'crew'
      const dancers = game.fruits.filter((f) => f.alive && (e.winner === 'draw' ? true : (f.role === 'crew') === crewWon)).map((f) => f.id)
      card(e.winner === 'draw' ? 'TIME UP' : crewWon ? 'CREW WIN' : 'THE ROTTEN WIN', HOW[e.how] ?? e.how, !crewWon)
      useSim.setState({ winner: e.winner, how: e.how, party: { at: performance.now(), dancers }, speaker: null })
      sfx(startParty)
      sfx(cheer)
      syncFruits(game)
      feed({ t: e.t, tab: 'system', text: `Game over: ${e.winner === 'draw' ? 'a draw' : `${e.winner} win`} by ${e.how}.` })
      break
    }
  }
}

/** Point the director camera at something that just happened. */
function shot(kind: Shot['kind'], at: Vec2) {
  if (quiet) return
  useSim.setState({ shot: { kind, at: [at[0], at[1]], since: performance.now(), key: key++ } })
}

/**
 * Rebuild the screen from a game's whole history, quietly: the log panel, bodies still on the
 * floor, who has been cleared away and how full the Juicer's glass is. Used after seeking a replay.
 */
export function rebuild(game: Game) {
  quiet = true
  try {
    useSim.setState({ feed: [] })
    for (const e of game.log) handle(game, e)
  } finally {
    quiet = false
  }
  const onFloor = new Set(game.bodies.map((b) => b.id))
  useSim.setState({
    chopped: Object.fromEntries(game.bodies.map((b) => [b.id, true])),
    cleared: Object.fromEntries(game.fruits.filter((f) => !f.alive && !onFloor.has(f.id)).map((f) => [f.id, true])),
    splats: game.bodies.map((b, i) => ({ id: b.id, x: b.pos[0], z: b.pos[1], kind: game.fruits.find((f) => f.id === b.id)!.def.kind, size: 1.4, seed: i })),
    juice: game.stats.ejections.length,
    votes: {},
    speech: {},
    reactions: {},
    card: null,
    attack: null,
    party: null,
    ejecting: null,
    lightsOut: game.lightsOut,
  })
  syncFruits(game)
}

/** Where an ejected fruit is taken: the Juicer's mouth, or the compost bin in the Greenhouse. */
const JUICER_MOUTH: Vec2 = [0, -15.2]
const COMPOST: Vec2 = [-23, -17.5]

/** Two fruits carry the ejected one off; SPLORT, the glass fills, and the room reacts. */
function ejectOnScreen(game: Game, who: string, role: Role, votes: number) {
  const out = fruitById(game, who)
  if (!out) return
  const compost = useSim.getState().settings.ejectStyle === 'compost'
  const dest = compost ? COMPOST : JUICER_MOUTH
  const carriers = game.fruits
    .filter((f) => f.alive)
    .sort((a, b) => Math.hypot(a.pos[0] - out.pos[0], a.pos[1] - out.pos[1]) - Math.hypot(b.pos[0] - out.pos[0], b.pos[1] - out.pos[1]))
    .slice(0, 2)
  const paths: Record<string, Vec2[]> = { [who]: findPath(out.pos, dest, 0) }
  const from: Record<string, Vec2> = { [who]: out.pos }
  carriers.forEach((c, i) => {
    const side = i ? 1.1 : -1.1
    paths[c.id] = findPath(c.pos, [dest[0] + side, dest[1] + 1.4], i ? 1 : -1)
    from[c.id] = c.pos
  })
  useSim.setState({ ejecting: who, speaker: null, lookAt: Object.fromEntries(carriers.map((c) => [c.id, who])) })
  carry(paths, from, () => {
    if (game !== currentGame()) return
    burst(compost ? 'PLOP!' : 'SPLORT!', dest[0], dest[1])
    sfx(slice)
    const confirm = game.rules.confirmEjects
    card(`${nameOf(game, who).toUpperCase()} ${confirm ? (role === 'rotten' ? 'WAS ROTTEN' : 'WAS NOT ROTTEN') : 'WAS EJECTED'}`, `${votes} votes. Into the ${compost ? 'compost' : 'Juicer'}.`, true)
    if (confirm && role === 'rotten') sfx(cheer)
    else sfx(gasp)
    useSim.setState((st) => ({ ejecting: null, juice: st.juice + 1, cleared: { ...st.cleared, [who]: true }, lookAt: {} }))
    for (const f of game.fruits) if (f.alive) react(game, f.id, confirm ? (role === 'rotten' ? 'cheer' : 'gasp') : 'puzzle', 2000)
    syncFruits(game)
  })
}

const HOW: Record<string, string> = {
  tasks: 'Every task is done',
  ejection: 'Every Rotten was ejected',
  kills: 'Too few crew left standing',
  meltdown: 'The Ripening Chamber melted down',
  timeout: 'Nobody won in time',
}
