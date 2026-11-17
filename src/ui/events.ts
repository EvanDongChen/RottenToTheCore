import { fruitById, nameOf, taskBar } from '../sim/engine'
import type { Game } from '../sim/engine'
import type { SimEvent } from '../sim/log'
import { placeName, vent } from '../sim/map'
import { babble, cheer, clang, gasp, slice, startParty, sulk, thud, voteTick } from './sfx'
import { currentGame, uiFruits, useSim } from './store'
import type { FeedEntry, SimState } from './store'

/**
 * Turns the sim's events into what the viewer sees and hears: speech bubbles, reactions, comic
 * bursts, cards and the log. Timers are in real milliseconds, shortened when the game is sped up.
 */

let key = 1
const MAX_FEED = 400

/** Real milliseconds for something that should last `ms` at 1x, shortened at higher speeds. */
function scaled(ms: number) {
  return ms / Math.sqrt(useSim.getState().speed)
}

function later(game: Game, ms: number, fn: () => void) {
  setTimeout(() => {
    if (game === currentGame()) fn()
  }, scaled(ms))
}

function feed(entry: Omit<FeedEntry, 'key'>) {
  useSim.setState((s) => ({ feed: [...s.feed, { ...entry, key: key++ }].slice(-MAX_FEED) }))
}

function card(title: string, sub: string, dark = false) {
  useSim.setState({ card: { key: key++, title, sub, dark } })
}

function burst(text: string, x: number, z: number) {
  const b = { key: key++, text, at: [x, 2.4, z] as [number, number, number] }
  useSim.setState((s) => ({ bursts: [...s.bursts, b] }))
  setTimeout(() => useSim.setState((s) => ({ bursts: s.bursts.filter((o) => o.key !== b.key) })), 1400)
}

function react(game: Game, id: string, how: SimState['reactions'][string], ms = 1600) {
  useSim.setState((s) => ({ reactions: { ...s.reactions, [id]: how } }))
  later(game, ms, () => useSim.setState((s) => ({ reactions: { ...s.reactions, [id]: s.reactions[id] === how ? undefined : s.reactions[id] } })))
}

/** Show a speech bubble, babble it, and clear it after a while. */
export function say(game: Game, id: string, text: string, to?: string) {
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
  useSim.setState({ fruits: uiFruits(game), taskBar: taskBar(game), phase: game.phase, lightsOut: game.lightsOut })
}

export function attach(game: Game) {
  game.onEvent = (e) => {
    if (game === currentGame()) handle(game, e)
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
      slice()
      burst('CHOP!', e.at[0], e.at[1])
      later(game, 900, () => useSim.setState({ attack: null }))
      feed({ t: e.t, tab: 'system', text: `${n(e.killer)} sliced ${n(e.victim)} in ${placeName(e.room)}${e.witnesses.length ? `, seen by ${e.witnesses.map(n).join(' and ')}` : ', unseen'}.` })
      syncFruits(game)
      break
    }
    case 'found':
      card('BODY REPORTED', `${n(e.who)} found ${n(e.body)}`)
      gasp()
      react(game, e.who, 'gasp')
      feed({ t: e.t, tab: 'meeting', text: `${n(e.who)} reported ${n(e.body)}'s body.` })
      break
    case 'meeting': {
      if (e.reason === 'emergency') {
        card('EMERGENCY MEETING', `${n(e.caller)} pressed the button`)
        thud()
        feed({ t: e.t, tab: 'meeting', text: `${n(e.caller)} called an emergency meeting.` })
      }
      const dead = Object.fromEntries(game.fruits.filter((f) => !f.alive).map((f) => [f.id, true]))
      useSim.setState({ votes: {}, speech: {}, lookAt: {}, cleared: dead, splats: [], speaker: null, lightsOut: false, attack: null })
      syncFruits(game)
      break
    }
    case 'witness':
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
      clang()
      const v = vent(e.to)
      burst('CLANK!', v.at[0], v.at[1])
      feed({ t: e.t, tab: 'sighting', text: `${n(e.who)} vented from ${placeName(vent(e.from).room)} to ${placeName(v.room)}${e.seenBy.length ? `, seen by ${e.seenBy.map(n).join(' and ')}` : ''}.` })
      break
    }
    case 'sabotage':
      useSim.setState({ lightsOut: true })
      card('LIGHTS OUT', `${n(e.who)} cut the power`, true)
      feed({ t: e.t, tab: 'system', text: `${n(e.who)} turned the lights off.` })
      break
    case 'fixed':
      useSim.setState({ lightsOut: false })
      feed({ t: e.t, tab: 'system', text: `${n(e.who)} fixed the lights.` })
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
      voteTick()
      feed({ t: e.t, tab: 'meeting', text: `${n(e.voter)} votes ${e.target === 'skip' ? 'to skip' : `for ${n(e.target)}`}${e.reason ? `: "${e.reason}"` : ''}` })
      break
    case 'eject': {
      if (e.lastWords) say(game, e.who, e.lastWords)
      const confirm = game.rules.confirmEjects
      later(game, 2200, () => {
        useSim.setState({ ejecting: e.who, speaker: null })
        card(`${n(e.who).toUpperCase()} ${confirm ? (e.role === 'rotten' ? 'WAS ROTTEN' : 'WAS NOT ROTTEN') : 'WAS EJECTED'}`, `${e.votes} votes. Into the ${useSim.getState().settings.ejectStyle === 'compost' ? 'compost' : 'Juicer'} it goes.`, true)
        if (confirm && e.role === 'rotten') cheer()
        else gasp()
        for (const f of game.fruits) if (f.alive) react(game, f.id, confirm ? (e.role === 'rotten' ? 'cheer' : 'gasp') : 'puzzle', 2000)
        syncFruits(game)
      })
      feed({ t: e.t, tab: 'meeting', text: `${n(e.who)} was ejected${confirm ? ` and was ${e.role === 'rotten' ? '' : 'not '}Rotten` : ''}.${e.lastWords ? ` Last words: "${e.lastWords}"` : ''}` })
      break
    }
    case 'noEject':
      card('NOBODY WAS EJECTED', e.tie ? 'A tie' : 'Skipped')
      sulk()
      feed({ t: e.t, tab: 'meeting', text: e.tie ? 'The vote was tied. Nobody was ejected.' : 'Nobody was ejected.' })
      break
    case 'task':
      if (game.tick % 2 === 0) syncFruits(game)
      break
    case 'over': {
      const crewWon = e.winner === 'crew'
      const dancers = game.fruits.filter((f) => f.alive && (e.winner === 'draw' ? true : (f.role === 'crew') === crewWon)).map((f) => f.id)
      card(e.winner === 'draw' ? 'TIME UP' : crewWon ? 'CREW WIN' : 'THE ROTTEN WIN', HOW[e.how] ?? e.how, !crewWon)
      useSim.setState({ winner: e.winner, how: e.how, party: { at: performance.now(), dancers }, speaker: null })
      startParty()
      cheer()
      syncFruits(game)
      feed({ t: e.t, tab: 'system', text: `Game over: ${e.winner === 'draw' ? 'a draw' : `${e.winner} win`} by ${e.how}.` })
      break
    }
  }
}

const HOW: Record<string, string> = {
  tasks: 'Every task is done',
  ejection: 'Every Rotten was ejected',
  kills: 'Too few crew left standing',
  meltdown: 'The Ripening Chamber melted down',
  timeout: 'Nobody won in time',
}
