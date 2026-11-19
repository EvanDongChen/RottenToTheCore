import { fruitPositions, useSim } from './store'
import type { FruitDef, FruitKind } from '../sim/types'

// Tiny synthesised sound effects; no audio files.
let ctx: AudioContext | null = null

/** Must be called from a user gesture (the Start button) before any sound plays. */
export function unlockAudio() {
  try {
    ctx ??= new AudioContext()
    void ctx.resume()
  } catch {
    ctx = null
  }
}

function tone(freq: number, start: number, duration: number, type: OscillatorType, gain: number, endFreq = freq) {
  if (!ctx || useSim.getState().settings.muted) return
  const osc = ctx.createOscillator()
  const amp = ctx.createGain()
  const t = ctx.currentTime + start
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + duration)
  amp.gain.setValueAtTime(gain, t)
  amp.gain.exponentialRampToValueAtTime(0.0001, t + duration)
  osc.connect(amp).connect(ctx.destination)
  osc.start(t)
  osc.stop(t + duration + 0.02)
}

/** How high each kind of fruit speaks, in steps up the scale below: big fruits low, small ones high. */
const KIND_STEP: Record<FruitKind, number> = {
  watermelon: 0,
  pear: 1,
  orange: 2,
  banana: 3,
  kiwi: 3,
  apple: 4,
  plum: 5,
  peach: 6,
  lemon: 7,
  lime: 8,
  strawberry: 9,
  blueberry: 10,
  cherry: 11,
}

/** Every voice uses the same five-note scale, so fruits talking over each other stay in tune. */
const SCALE = [0, 2, 4, 7, 9]

/** The pitch, in hertz, of a step on that scale. */
function note(step: number) {
  const degree = ((step % SCALE.length) + SCALE.length) % SCALE.length
  return 196 * 2 ** ((12 * Math.floor(step / SCALE.length) + SCALE[degree]) / 12)
}

/** Where the viewer is listening from: the camera, kept up to date by the stage. */
export const ears = { position: { x: 0, y: 12, z: 21 }, right: { x: 1, y: 0, z: 0 } }

/** One fruit's speech in progress, with its own volume and left-right position. */
interface Voice {
  id: string
  out: GainNode
  pan: StereoPannerNode
}
const voices = new Set<Voice>()
let mixTimer: number | undefined

/**
 * Several conversations run at once. The one nearest the camera is heard clearly, the next
 * nearest is a murmur, and the rest are silent. Each voice also sits to the left or right
 * according to where its fruit is on screen. `fresh` is a voice that has not started yet,
 * which is set straight to its level rather than faded there.
 */
function mix(fresh?: Voice) {
  if (!ctx) return
  const now = ctx.currentTime
  const ranked = [...voices]
    .map((voice) => {
      const at = fruitPositions.get(voice.id)
      return { voice, at, far: at ? Math.hypot(at.x - ears.position.x, at.y - ears.position.y, at.z - ears.position.z) : Infinity }
    })
    .sort((x, y) => x.far - y.far)
  ranked.forEach(({ voice, at }, i) => {
    const level = i === 0 ? 1 : i === 1 ? 0.14 : 0
    // How far to the viewer's left or right the speaker is, from -1 to 1.
    const dx = at ? at.x - ears.position.x : 0
    const dy = at ? at.y - ears.position.y : 0
    const dz = at ? at.z - ears.position.z : 0
    const across = (dx * ears.right.x + dy * ears.right.y + dz * ears.right.z) / (Math.hypot(dx, dy, dz) || 1)
    const side = Math.max(-0.8, Math.min(0.8, across * 2))
    if (voice === fresh) {
      voice.out.gain.setValueAtTime(level, now)
      voice.pan.pan.setValueAtTime(side, now)
    } else {
      voice.out.gain.setTargetAtTime(level, now, 0.12)
      voice.pan.pan.setTargetAtTime(side, now, 0.12)
    }
  })
}

/** One soft blip of speech: a rounded tone that starts a touch sharp, settles, and dies away. */
function blip(out: AudioNode, pitch: number, start: number, length: number, gain: number) {
  if (!ctx) return
  const t = ctx.currentTime + start
  const osc = ctx.createOscillator()
  const amp = ctx.createGain()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(pitch * 1.04, t)
  osc.frequency.exponentialRampToValueAtTime(pitch, t + 0.03)
  amp.gain.setValueAtTime(0.0001, t)
  amp.gain.linearRampToValueAtTime(gain, t + 0.006)
  amp.gain.exponentialRampToValueAtTime(0.0001, t + length)
  osc.connect(amp).connect(out)
  osc.start(t)
  osc.stop(t + length + 0.02)
}

/**
 * Speech as a string of soft musical blips that follows the rhythm of the line: one blip
 * for each vowel and for the start of each word, with pauses at spaces and punctuation, and
 * a rise at the end of a question. Each letter always lands on the same note for a given
 * fruit. The kind of fruit sets how high it speaks, talkative fruits gabble faster, and
 * aggressive ones jump further between notes. `variant` detunes the voice very slightly
 * so two fruits of the same kind still differ.
 */
export function babble(fruit: Pick<FruitDef, 'id' | 'kind' | 'traits'>, variant: number, text: string, durationMs: number) {
  if (!ctx || useSim.getState().settings.muted) return
  const voice: Voice = { id: fruit.id, out: ctx.createGain(), pan: ctx.createStereoPanner() }
  voice.out.connect(voice.pan).connect(ctx.destination)
  voices.add(voice)
  mix(voice)
  // Keep re-ranking while anyone is talking, since the camera and the fruits both move.
  mixTimer ??= window.setInterval(() => mix(), 150)
  window.setTimeout(() => {
    voices.delete(voice)
    voice.pan.disconnect()
    mix()
    if (!voices.size && mixTimer !== undefined) {
      window.clearInterval(mixTimer)
      mixTimer = undefined
    }
  }, durationMs + 300)

  const letters = text.toLowerCase().slice(0, 90)
  const detune = 2 ** ((((variant % 3) - 1) * 0.1) / 12)
  const leap = 0.6 + fruit.traits.aggression
  // Finish a little before the bubble closes, however fast the game is running.
  const gap = Math.min(0.072 - fruit.traits.talkativeness * 0.022, ((durationMs / 1000) * 0.8) / Math.max(1, letters.length))
  const question = text.trim().endsWith('?')
  let wordStart = true
  for (let i = 0; i < letters.length; i++) {
    const letter = letters[i]
    if (letter < 'a' || letter > 'z') {
      wordStart = true
      continue
    }
    const isVowel = 'aeiou'.includes(letter)
    if (isVowel || wordStart) {
      const offset = Math.round((((letter.charCodeAt(0) * 3) % 5) - 2) * leap)
      const lift = question && i > letters.length - 7 ? 2 : 0
      blip(voice.out, note(KIND_STEP[fruit.kind] + offset + lift) * detune, i * gap, gap * 2.4, isVowel ? 0.2 : 0.13)
    }
    wordStart = false
  }
}

/** A vent hatch clanking open. */
export function clang() {
  tone(1250, 0, 0.3, 'square', 0.07, 1150)
  tone(1870, 0, 0.35, 'triangle', 0.09, 1800)
  tone(2600, 0.01, 0.2, 'sine', 0.05)
}

/** A sharp intake of breath from the whole village. */
export function gasp() {
  tone(280, 0, 0.22, 'triangle', 0.12, 720)
  tone(360, 0.04, 0.2, 'triangle', 0.08, 900)
}

export function cheer() {
  ;[523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.07, 0.16, 'triangle', 0.09))
}

/** A sad trombone, more or less. */
export function sulk() {
  tone(233, 0, 0.3, 'sawtooth', 0.045, 220)
  tone(196, 0.3, 0.6, 'sawtooth', 0.045, 150)
}

/** A quick blade swish. */
export function slice() {
  tone(1800, 0, 0.16, 'sawtooth', 0.07, 300)
  tone(900, 0.03, 0.12, 'triangle', 0.05, 200)
}

export function thud() {
  tone(140, 0, 0.35, 'sine', 0.4, 35)
}

/** A little two-note beep when a task is done. */
export function taskBeep() {
  tone(988, 0, 0.07, 'square', 0.025)
  tone(1319, 0.07, 0.1, 'square', 0.025)
}

/** The emergency alarm: a rising siren, twice. */
export function alarm() {
  for (let i = 0; i < 2; i++) tone(520, i * 0.45, 0.4, 'sawtooth', 0.06, 980)
}

/** A body is reported: a low horn blast. */
export function horn() {
  tone(110, 0, 0.7, 'sawtooth', 0.08, 98)
  tone(165, 0, 0.7, 'square', 0.035, 147)
}

/** The lights going out: a power-down whine. */
export function powerDown() {
  tone(700, 0, 0.6, 'sine', 0.08, 60)
}

/** Length of one beat of the party music, in milliseconds. The dancers hop in time with it. */
export const PARTY_BEAT_MS = 500
const PARTY_TUNE = [262, 330, 392, 523, 392, 330, 294, 392]
let partyTimer: number | undefined

/** Start the looping victory tune: a kick on every beat, a bouncy lead and an off-beat hat. */
export function startParty() {
  stopParty()
  let step = 0
  const bar = () => {
    tone(150, 0, 0.18, 'sine', 0.3, 45)
    tone(PARTY_TUNE[step % PARTY_TUNE.length], 0, 0.16, 'square', 0.045)
    tone(PARTY_TUNE[(step + 2) % PARTY_TUNE.length] * 2, 0.25, 0.1, 'triangle', 0.05)
    tone(6000, 0.25, 0.03, 'square', 0.015)
    step++
  }
  bar()
  partyTimer = window.setInterval(bar, PARTY_BEAT_MS)
}

export function stopParty() {
  if (partyTimer !== undefined) window.clearInterval(partyTimer)
  partyTimer = undefined
}

export function voteTick() {
  tone(880, 0, 0.08, 'triangle', 0.08)
}

/** The blender: a motor winding up to a scream, with a grinding buzz on top. */
export function whirr(seconds: number) {
  tone(90, 0, seconds, 'sawtooth', 0.05, 420)
  tone(180, 0, seconds, 'square', 0.02, 900)
}
