import type { Claim } from './brains/types'
import { placeName, station } from './map'
import type { Sighting } from './memory'

/**
 * Memories and claims in plain words. Used by the memory reel, the stock lines and the LLM
 * prompts, so all three describe the same thing the same way.
 */

/** Sim seconds as m:ss. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** "around 1:20", or "1:05 to 1:40" for a long stretch. */
export function when(from: number, to: number): string {
  return to - from < 8 ? `around ${clock((from + to) / 2)}` : `${clock(from)} to ${clock(to)}`
}

export function describeSighting(s: Sighting, nameOf: (id: string) => string): string {
  const who = nameOf(s.who)
  const where = placeName(s.room)
  const at = when(s.from, s.to)
  switch (s.kind) {
    case 'seen':
      return `saw ${who} in ${where}, ${at}`
    case 'passed':
      return `passed ${who} in ${where} heading for ${placeName(s.heading ?? s.room)}, ${at}`
    case 'atTask':
      return s.sawEffect
        ? `watched ${who} do "${station(s.station!).name}" in ${where}, and saw it work: ${who} is crew`
        : `saw ${who} at "${station(s.station!).name}" in ${where}, ${at}`
    case 'fakeTask':
      return `saw ${who} standing at "${station(s.station!).name}" in ${where} far too long, doing nothing, ${at}`
    case 'nearBody':
      return `saw ${who} near ${nameOf(s.victim!)}'s body in ${where}, ${at}`
    case 'vented':
      return `saw ${who} use a vent in ${where}, ${at}`
    case 'kill':
      return `saw ${who} kill ${nameOf(s.victim!)} in ${where}, ${at}`
    case 'heard':
      return `heard from ${nameOf(s.source!)} that ${toldText(s, who, where, at, nameOf)}`
  }
}

function toldText(s: Sighting, who: string, where: string, at: string, nameOf: (id: string) => string): string {
  switch (s.told) {
    case 'accuse':
      return `${who} is Rotten`
    case 'vouch':
      return `${who} is clean`
    case 'alibi':
      return `${who} was in ${where} ${at}${s.with?.length ? ` with ${s.with.map(nameOf).join(' and ')}` : ''}`
    case 'kill':
      return `${who} killed ${s.victim ? nameOf(s.victim) : 'someone'} in ${where}`
    case 'vented':
      return `${who} used a vent in ${where}`
    case 'nearBody':
      return `${who} was near a body in ${where}`
    case 'fakeTask':
      return `${who} was faking a task in ${where}`
    case 'atTask':
      return `${who} was doing tasks in ${where}`
    default:
      return `${who} was in ${where} ${at}`
  }
}

/** A claim as said out loud. */
export function describeClaim(c: Claim, nameOf: (id: string) => string): string {
  if (c.kind === 'where') return `was in ${placeName(c.room)} ${when(c.from, c.to)}${c.with?.length ? ` with ${c.with.map(nameOf).join(' and ')}` : ''}`
  const who = nameOf(c.who)
  const where = placeName(c.room)
  switch (c.what) {
    case 'kill':
      return `saw ${who} kill ${c.victim ? nameOf(c.victim) : 'someone'} in ${where}`
    case 'vented':
      return `saw ${who} vent in ${where}`
    case 'nearBody':
      return `saw ${who} near the body in ${where}`
    case 'fakeTask':
      return `saw ${who} faking a task in ${where}`
    case 'atTask':
      return `watched ${who} do a task in ${where}`
    default:
      return `saw ${who} in ${where} around ${clock(c.at)}`
  }
}

export const SIGHTING_ICON: Record<Sighting['kind'], string> = {
  seen: '👀',
  passed: '↔',
  atTask: '🔧',
  fakeTask: '🤨',
  nearBody: '⚠',
  vented: '🕳',
  kill: '🔪',
  heard: '💬',
}
