import type { FruitView, InSight } from '../view'
import { storyBreaks } from './reasoning'

/**
 * A Rotten that thinks about what the crew think. It can't see into their heads, but it knows
 * what they could have seen of it (who was about when it killed), what was said about it in
 * meetings, and how the votes went. From that it keeps a rough score of how much each crew fruit
 * suspects it, and how much the table suspects each crew fruit, and plays to keep its own low.
 */

const AGAINST = ['accuse', 'hardClaim', 'bandwagon', 'contradict', 'question']

/** How much each living crew fruit probably suspects this Rotten (0 none, higher worse). */
export function suspicionOfMe(view: FruitView): Record<string, number> {
  const out: Record<string, number> = {}
  const crew = view.others.filter((o) => o.alive && !view.partners.includes(o.id))
  for (const o of crew) out[o.id] = 0
  const bump = (id: string, n: number) => {
    if (id in out) out[id] += n
  }
  // Whoever was about when it killed may have seen it there, or seen it hurry off.
  for (const k of view.kills) {
    for (const m of view.memory) {
      if ((m.kind !== 'seen' && m.kind !== 'passed' && m.kind !== 'atTask') || !(m.who in out)) continue
      if (m.to < k.time - 10 || m.from > k.time + 10) continue
      bump(m.who, m.room === k.area ? 4 : 2)
    }
  }
  // What was said and done about it in meetings.
  for (const e of view.public) {
    if (e.kind === 'line' && e.target === view.id && AGAINST.includes(e.move)) {
      bump(e.who, 2)
      for (const id of Object.keys(out)) if (id !== e.who) bump(id, 0.4)
    }
    if (e.kind === 'vote' && e.target === view.id) bump(e.voter, 1.5)
  }
  // Its own story changing is something everyone heard.
  const broken = storyBreaks(view).get(view.id)?.length ?? 0
  for (const id of Object.keys(out)) bump(id, broken * 2)
  return out
}

/** How much the table suspects each living crew fruit: accusations and votes against it. A good scapegoat scores high. */
export function tableSuspicion(view: FruitView): Record<string, number> {
  const out: Record<string, number> = {}
  for (const o of view.others) if (o.alive && !view.partners.includes(o.id)) out[o.id] = 0
  for (const e of view.public) {
    if (e.kind === 'line' && e.target && e.target in out && AGAINST.includes(e.move) && e.who !== view.id) out[e.target] += 1
    if (e.kind === 'vote' && e.target in out && e.voter !== view.id) out[e.target] += 1.5
  }
  for (const [who, b] of storyBreaks(view)) if (who in out) out[who] += b.length * 2
  return out
}

/**
 * Who it would rather kill: whoever suspects it most (silence the witness), but not whoever the
 * table already suspects (a scapegoat alive is worth more than one dead).
 */
export function killBias(view: FruitView): (o: InSight) => number {
  const me = suspicionOfMe(view)
  const table = tableSuspicion(view)
  return (o) => Math.min(4, me[o.id] ?? 0) * 1.2 - Math.min(3, table[o.id] ?? 0) * 0.8
}
