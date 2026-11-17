import { create } from 'zustand'
import type { Vector3 } from 'three'
import { createGame } from '../sim/engine'
import type { Game } from '../sim/engine'
import type { FruitKind, Mood, Phase, Reaction, Role, Traits } from '../sim/types'

/**
 * The bridge between the sim and the screen. The sim never touches React: after each frame's
 * ticks, the clock (clock.ts) copies a small snapshot in here, and the 3D components read it.
 * Anything that changes every frame (positions) lives in plain Maps, outside React state.
 */

/** What the screen needs to draw one fruit. */
export interface UiFruit {
  id: string
  name: string
  kind: FruitKind
  traits: Traits
  role: Role
  alive: boolean
  mood: Mood
  /** What it is privately thinking right now. */
  thought: string
  /** Who it trusts least right now, for the sideways glance. */
  suspect?: string
}

export interface Settings {
  muted: boolean
}

const SETTINGS_KEY = 'rottentothecore.settings'
export const SPEEDS = [1, 2, 4, 8]

function loadSettings(): Settings {
  const defaults: Settings = { muted: false }
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') }
  } catch {
    return defaults
  }
}

function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Storage can be unavailable (private windows); the settings just won't persist.
  }
}

export function emptyMood(): Mood {
  return { fear: 0, anger: 0, grief: 0, guilt: 0, smug: 0 }
}

/** The running game. Kept outside React state: the clock advances it in place. */
let game: Game = createGame({ seed: randomSeed() })

export function currentGame() {
  return game
}

function randomSeed() {
  // The one place Math.random is fine: picking a seed, outside the sim.
  return Math.floor(Math.random() * 1e9)
}

function uiFruits(g: Game): UiFruit[] {
  return g.fruits.map((f) => ({
    id: f.id,
    name: f.def.name,
    kind: f.def.kind,
    traits: f.def.traits,
    role: f.role,
    alive: f.alive,
    mood: emptyMood(),
    thought: '',
  }))
}

export interface SimState {
  seed: number
  fruits: UiFruit[]
  phase: Phase
  /** Sim seconds, refreshed a few times a second for the clock on screen. */
  time: number
  /** Who each fruit turns to face while standing: its conversation partner. */
  lookAt: Record<string, string | undefined>
  speech: Record<string, string | undefined>
  thinking: Record<string, boolean | undefined>
  /** A kill in progress: the Rotten carries a knife, and lunges when `striking`. */
  attack: { attackerId: string; victimId: string; striking: boolean } | null
  /** Fruits that died by the knife and fall apart in slices. */
  chopped: Record<string, boolean | undefined>
  /** The winners' dance party: when it started (for keeping time) and who is dancing. */
  party: { at: number; dancers: string[] } | null
  /** Juice left on the floor where a fruit was chopped. */
  splats: { x: number; z: number; kind: FruitKind; size: number; seed: number }[]
  /** Comic sound words ("CHOP!") bursting over the lab right now. */
  bursts: { key: number; text: string; at: [number, number, number] }[]
  /** Body language each fruit is showing right now. */
  reactions: Record<string, Reaction | undefined>
  /** Who everyone turns to look at when they have no partner. */
  focusId: string | null
  /** Ballots cast so far in a meeting: voter id to target id. */
  votes: Record<string, string>
  /** The lights are sabotaged: the lab goes dim. */
  lightsOut: boolean
  paused: boolean
  speed: number
  revealRoles: boolean
  showThoughts: boolean
  settings: Settings

  newGame(seed?: number): void
  setSettings(patch: Partial<Settings>): void
}

function freshState(g: Game) {
  return {
    seed: g.seed,
    fruits: uiFruits(g),
    phase: g.phase,
    time: g.time,
    lookAt: {},
    speech: {},
    thinking: {},
    attack: null,
    chopped: {},
    party: null,
    splats: [],
    bursts: [],
    reactions: {},
    focusId: null,
    votes: {},
    lightsOut: false,
  }
}

export const useSim = create<SimState>((set, get) => ({
  ...freshState(game),
  paused: false,
  speed: 1,
  revealRoles: false,
  showThoughts: false,
  settings: loadSettings(),

  newGame: (seed = randomSeed()) => {
    game = createGame({ seed })
    simTargets.clear()
    set(freshState(game))
  },
  setSettings: (patch) => {
    const settings = { ...get().settings, ...patch }
    saveSettings(settings)
    set({ settings })
  },
}))

/**
 * Where the sim says each fruit is right now, smoothed between ticks, and how fast it is moving
 * in world units per real second. Written by the clock every frame; each Fruit steers toward it.
 */
export const simTargets = new Map<string, { x: number; z: number; vx: number; vz: number }>()

/** Live world positions of the 3D bodies, written by each Fruit every frame. */
export const fruitPositions = new Map<string, Vector3>()

/** How fast each 3D body is moving along the ground. Lets fruits notice someone hurrying past. */
export const fruitSpeeds = new Map<string, number>()

/** Where each ghost is floating, so the living can turn to face one. */
export const ghostPositions = new Map<string, Vector3>()

// Dev builds expose the store on the window, so the game can be poked at from the console.
if (import.meta.env.DEV) Object.assign(window, { __sim: { useSim, currentGame, simTargets, fruitPositions } })
