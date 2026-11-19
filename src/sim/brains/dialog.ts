// Stock lines for the non-LLM brains. Slots: {name}, {room}, {time}, {task}, {n}, {b}.

import { clock, describeClaim } from '../describe'
import { placeName } from '../map'
import { presetOf } from '../quirks'
import type { Rng } from '../rng'
import type { FruitView } from '../view'
import type { ChatContext, ChatLine } from './types'

/** One line of history per fruit, in its own words, brought up in small talk. */
export const BACKSTORIES = [
  'I fell off the tree early. Nobody caught me.',
  'I used to be in a pie. I got out.',
  'I grew up at the bottom of the fruit bowl.',
  'I was the last one picked. Every single time.',
  'I once rolled all the way down the hill and never told anyone why.',
  'I was nearly a smoothie. You do not forget that.',
  'I spent a summer in a lunchbox. I saw things.',
  'I was raised by a family of onions. I do not cry easily.',
  'I won the county fair. Third place, but still.',
  'I ran away from the orchard and never looked back.',
  'I have a twin. We do not speak.',
  'I survived the back of the fridge.',
  'I used to be a decoration. They thought I was wax.',
  'A bird carried me here. I never asked where from.',
  'I was in the bargain bin once. It changes you.',
  'I learned everything I know from a jar of jam.',
]

/** Fill the slots in a line. */
export function fill(line: string, slots: Record<string, string | number>): string {
  return line.replace(/\{(\w+)\}/g, (_, k) => String(slots[k] ?? ''))
}

export const GREET = ['Hey.', 'Oh, hi.', 'Busy busy.', 'Morning!', 'Watch your step.', '*nods*', 'Lovely day for chores.']
export const HEADING = ['Off to {room}!', 'Heading to {room}.', '{room}, here I come.', 'Got something in {room}.', "Can't stop, {room} awaits."]
export const SMALL_TALK = ['Did I ever tell you? {b}', 'This place reminds me of something. {b}', 'You know, {b}', 'Fun fact about me: {b}']
export const PROGRESS = ["{n} more and I'm done.", 'Only {n} to go.', '{n} left. Then a nap.', 'Nearly there. {n} more.']
export const PROGRESS_DONE = ['All my tasks are done!', 'Finished everything. Feels good.', 'Done and dusted.']
export const WHERE = ['I came from {room}. {extra}', 'I was just in {room}. {extra}', 'Just got back from {room}. {extra}']
export const WHERE_EXTRA_SAW = ['{name} was there.', 'Saw {name} on the way.', '{name} was hanging about.']
export const WHERE_EXTRA_NONE = ['Quiet in there.', 'Nobody about.', 'Empty, mostly.']
export const PACT = ['If anyone asks, we were together in {room}.', "We've been in {room} together this whole time, right?", 'You and me, {room}. Remember that.']
export const RUMOUR_OPEN_SURE = ['Listen.', "You didn't hear it from me, but", 'Swear on my stem:']
export const RUMOUR_OPEN_THINK = ['Maybe nothing, but I think', 'Could be wrong, but I think', 'Not sure, but I think']
export const RETELL = ['{source} told me {told}.', 'Word is, {told}.', 'Heard from {source}: {told}.']
export const ACCUSE_LOW = ["Keep an eye on {name}. Something's off.", "I don't trust {name}. Just saying.", '{name} gives me the creeps.', 'Watch {name}.']
export const FEAR_DARK = ["I can't see a thing!", 'Who turned the lights off?!', 'Stay close. Please.', 'Eep. The dark.']
export const ALONE_FEAR = ["I don't like being alone in here.", 'Is someone there?', 'Hello...?']

/** A quirk's little tic now and then, for flavour. */
function tic(view: FruitView, rng: Rng): string {
  if (!rng.chance(0.25)) return ''
  const preset = view.traits.quirks.map(presetOf).find(Boolean)
  return preset ? ` ${rng.pick(preset.tics)}` : ''
}

/** One stock line for a roaming chat, worded from what the engine decided to say. */
export function stockChat(view: FruitView, chat: ChatContext, rng: Rng): ChatLine {
  const nameOf = (id: string) => view.others.find((o) => o.id === id)?.name ?? (id === view.id ? view.name : id)
  let say: string
  switch (chat.topic) {
    case 'greet':
      say = rng.pick(GREET)
      break
    case 'heading':
      say = fill(rng.pick(HEADING), { room: placeName(chat.room ?? view.area) })
      break
    case 'smallTalk':
      say = fill(rng.pick(SMALL_TALK), { b: view.traits.backstory })
      break
    case 'progress':
      say = chat.left ? fill(rng.pick(PROGRESS), { n: chat.left }) : rng.pick(PROGRESS_DONE)
      break
    case 'where': {
      const c = chat.claim
      const extra = c?.kind === 'where' && c.with?.length ? fill(rng.pick(WHERE_EXTRA_SAW), { name: nameOf(c.with[0]) }) : rng.pick(WHERE_EXTRA_NONE)
      say = fill(rng.pick(WHERE), { room: c?.kind === 'where' ? placeName(c.room) : 'around', extra })
      break
    }
    case 'pact':
      say = fill(rng.pick(PACT), { room: placeName(chat.room ?? view.area) })
      break
    case 'rumour': {
      const c = chat.claim
      const sure = (chat.confidence ?? 1) > 0.7
      say = c ? `${rng.pick(sure ? RUMOUR_OPEN_SURE : RUMOUR_OPEN_THINK)} I ${describeClaim(c, nameOf)}${sure ? '.' : '?'}` : rng.pick(GREET)
      break
    }
    case 'accuse':
      say = fill(rng.pick(ACCUSE_LOW), { name: nameOf(chat.about ?? '') })
      break
    case 'fear':
      say = rng.pick(view.lightsOut ? FEAR_DARK : ALONE_FEAR)
      break
  }
  const saw = chat.claim?.kind === 'saw' ? chat.claim : undefined
  return {
    say: say + tic(view, rng),
    claim: chat.claim,
    accuses: chat.topic === 'accuse' ? chat.about : saw && saw.what !== 'atTask' && saw.what !== 'seen' ? saw.who : undefined,
    vouches: saw?.what === 'atTask' ? saw.who : undefined,
  }
}

/** A retold rumour, in words. */
export function retellLine(source: string, told: string, rng: Rng): string {
  return fill(rng.pick(RETELL), { source, told })
}

/** The fruit's private thought, for the thought bubble and the side panel. */
export function thoughtFor(view: FruitView, beliefs: Record<string, number>, rng: Rng): string {
  const nameOf = (id: string) => view.others.find((o) => o.id === id)?.name ?? id
  const living = view.others.filter((o) => o.alive)
  if (view.role === 'rotten') {
    if (view.killReadyIn === 0) {
      const alone = view.visible.filter((v) => !view.partners.includes(v.id))
      if (alone.length === 1) return `${nameOf(alone[0].id)} is all alone. Perfect.`
      return rng.pick(['The knife is ready. I just need a quiet corner.', 'Too many eyes. Patience.', 'Who is heading somewhere quiet?'])
    }
    const threat = view.memory.find((m) => m.kind === 'heard' && m.told === 'accuse' && m.who === view.id)
    if (threat?.source) return `${nameOf(threat.source)} is onto me. Something must be done.`
    return rng.pick(['Look busy. Smile.', 'Nobody suspects a thing.', 'Act natural. Fake a task.', `${clock(view.time)}. Still nobody knows.`])
  }
  const top = Object.entries(beliefs)
    .filter(([id]) => living.some((o) => o.id === id))
    .sort((a, b) => b[1] - a[1])[0]
  if (top && top[1] > 0.5) return `I'm ${Math.round(top[1] * 100)}% sure it's ${nameOf(top[0])}.`
  if (view.mood.fear > 0.5) return rng.pick(["I don't want to be alone.", 'Stay near the others. Stay near the others.', 'Every shadow looks like a knife.'])
  if (view.mood.grief > 0.5 && view.goal.kind === 'protect') return `They got ${nameOf(view.goal.target)}. Someone will pay.`
  const left = view.tasks.filter((t) => !t.done).length
  if (left) return rng.pick([`${left} tasks to go.`, 'Head down, get the chores done.', `Next stop: my next task. ${left} left.`])
  if (top && top[1] > 0.3) return `Something's off about ${nameOf(top[0])}.`
  return rng.pick(['All done. Now to keep my eyes open.', 'Tasks done. Who is acting strange?'])
}
