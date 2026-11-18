import { create } from 'zustand'
import type { Vector3 } from 'three'
import { memoryCache, newUsage } from '../sim/brains/llm'
import type { LlmOptions } from '../sim/brains/llm'
import type { BrainKind } from '../sim/brains/types'
import { createGame, taskBar } from '../sim/engine'
import type { Game } from '../sim/engine'
import { makeRng } from '../sim/rng'
import { makeFruit, makeRoster } from '../sim/roster'
import { DEFAULT_RULES, MAX_FRUITS, MIN_FRUITS } from '../sim/rules'
import type { FruitDef, FruitKind, Mood, Phase, Reaction, Role, Rules, Traits, Winner } from '../sim/types'

/**
 * The bridge between the sim and the screen. The sim never touches React: after each frame's
 * ticks, the clock (clock.ts) and the event handler (events.ts) copy a small snapshot in here,
 * and the components read it. Anything that changes every frame (positions) lives in plain
 * Maps, outside React state.
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
  thought: string
  /** Who it trusts least right now, for the sideways glance. */
  suspect?: string
  beliefs: Record<string, number>
}

/** One line in the log panel. */
export interface FeedEntry {
  key: number
  t: number
  tab: 'chat' | 'meeting' | 'sighting' | 'system'
  text: string
}

export type EjectStyle = 'juicer' | 'compost'

export interface Settings {
  muted: boolean
  crewBrain: BrainKind
  rottenBrain: BrainKind
  apiKey: string
  model: string
  rules: Rules
  ejectStyle: EjectStyle
}

const SETTINGS_KEY = 'rottentothecore.settings'
export const SPEEDS = [1, 2, 4, 8]

function loadSettings(): Settings {
  const devKey: string = import.meta.env.DEV ? (import.meta.env.VITE_GEMINI_API_KEY ?? '') : ''
  const defaults: Settings = { muted: false, crewBrain: 'bayesian', rottenBrain: 'heuristic', apiKey: devKey, model: 'gemini-flash-lite-latest', rules: DEFAULT_RULES, ejectStyle: 'juicer' }
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null')
    if (!saved) return defaults
    return { ...defaults, ...saved, apiKey: saved.apiKey || devKey, rules: { ...DEFAULT_RULES, ...saved.rules } }
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

export function randomSeed() {
  // The one place Math.random is fine: picking a seed, outside the sim.
  return Math.floor(Math.random() * 1e9)
}

/** Seed, rules and roster can come from the URL, so a game can be shared and replayed exactly. */
function urlSeed(): number | null {
  try {
    const s = Number(new URLSearchParams(location.search).get('seed'))
    return Number.isFinite(s) && s > 0 ? s : null
  } catch {
    return null
  }
}

const initialSettings = loadSettings()
const initialSeed = urlSeed() ?? randomSeed()

/** The running game. Kept outside React state: the clock advances it in place. */
let game: Game = createGame({ seed: initialSeed, rules: initialSettings.rules })

export function currentGame() {
  return game
}

export function uiFruits(g: Game): UiFruit[] {
  return g.fruits.map((f) => {
    const beliefs = f.mind.beliefs
    const suspect = Object.keys(beliefs)
      .filter((id) => beliefs[id] > 0.4)
      .sort((a, b) => beliefs[b] - beliefs[a])[0]
    return { id: f.id, name: f.def.name, kind: f.def.kind, traits: f.def.traits, role: f.role, alive: f.alive, mood: { ...f.mind.mood }, thought: f.mind.thought, suspect, beliefs: { ...beliefs } }
  })
}

export interface Card {
  key: number
  title: string
  sub: string
  dark?: boolean
}

export interface SimState {
  screen: 'title' | 'setup' | 'game'
  seed: number
  /** The roster being edited on the setup screen. */
  roster: FruitDef[]
  fruits: UiFruit[]
  phase: Phase
  /** Sim seconds, refreshed a few times a second for the clock on screen. */
  time: number
  taskBar: { done: number; total: number }
  winner: Winner | 'draw' | null
  how: string | null
  /** The title card sweeping across: BODY REPORTED, EMERGENCY MEETING, ejections. */
  card: Card | null
  feed: FeedEntry[]
  /** The fruit whose mind is open in the side panel. */
  selected: string | null
  /** Who is speaking in the meeting right now. */
  speaker: string | null
  /** Who each fruit turns to face while standing: its conversation partner. */
  lookAt: Record<string, string | undefined>
  speech: Record<string, string | undefined>
  thinking: Record<string, boolean | undefined>
  /** A kill in progress: the Rotten carries a knife, and lunges when `striking`. */
  attack: { attackerId: string; victimId: string; striking: boolean } | null
  /** Fruits that died by the knife and fall apart in slices. */
  chopped: Record<string, boolean | undefined>
  /** Dead fruits whose bodies have been cleared away (after a meeting). */
  cleared: Record<string, boolean | undefined>
  /** The fruit being carried off to the Juicer, if any. */
  ejecting: string | null
  /** How many fruits have gone into the Juicer: the glass fills a little more each time. */
  juice: number
  /** The winners' dance party: when it started (for keeping time) and who is dancing. */
  party: { at: number; dancers: string[] } | null
  /** Juice left on the floor where a fruit was chopped. */
  splats: { id: string; x: number; z: number; kind: FruitKind; size: number; seed: number }[]
  /** Comic sound words ("CHOP!") bursting over the lab right now. */
  bursts: { key: number; text: string; at: [number, number, number] }[]
  /** Vents popping open right now, by vent id. */
  vents: Record<string, number | undefined>
  /** Body language each fruit is showing right now. */
  reactions: Record<string, Reaction | undefined>
  /** Who everyone turns to look at when they have no partner. */
  focusId: string | null
  /** Ballots cast so far in a meeting: voter id to target id (or 'skip'). */
  votes: Record<string, string>
  lightsOut: boolean
  paused: boolean
  speed: number
  revealRoles: boolean
  showThoughts: boolean
  director: boolean
  cones: boolean
  arrows: boolean
  /** A problem with the LLM brain, shown once. */
  problem: string | null
  sceneReady: boolean
  settings: Settings

  newGame(seed?: number): void
  startGame(): void
  toSetup(): void
  setSettings(patch: Partial<Settings>): void
  setRules(patch: Partial<Rules>): void
  updateFruit(id: string, patch: Partial<Omit<FruitDef, 'traits'>> & { traits?: Partial<Traits> }): void
  addFruit(): void
  removeFruit(id: string): void
  randomizeRoster(): void
  select(id: string | null): void
}

/** Everything about one game on screen, reset whenever a new one starts. */
function freshState(g: Game) {
  return {
    seed: g.seed,
    fruits: uiFruits(g),
    phase: g.phase,
    time: g.time,
    taskBar: taskBar(g),
    winner: null,
    how: null,
    card: null,
    feed: [],
    speaker: null,
    lookAt: {},
    speech: {},
    thinking: {},
    attack: null,
    chopped: {},
    cleared: {},
    ejecting: null,
    juice: 0,
    party: null,
    splats: [],
    bursts: [],
    vents: {},
    reactions: {},
    focusId: null,
    votes: {},
    lightsOut: false,
  }
}

/** LLM replies are kept for the whole session, so watching the same seed again is free. */
const llmCache = memoryCache()

/** LLM settings for a new game, if either side uses the LLM brain and there is a key. */
function llmOptions(s: Settings): LlmOptions | undefined {
  if ((s.crewBrain !== 'llm' && s.rottenBrain !== 'llm') || !s.apiKey) return undefined
  return {
    apiKey: s.apiKey,
    model: s.model,
    chats: true,
    cache: llmCache,
    usage: newUsage(),
    requestsPerMinute: 30,
    maxCalls: 300,
    onProblem: (problem) => useSim.setState({ problem }),
  }
}

/** Builds a game from the current settings and roster. */
const gameFactory = (seed: number, s: Settings, roster?: FruitDef[]) =>
  createGame({ seed, roster, rules: { ...s.rules, fruits: roster?.length ?? s.rules.fruits }, brains: { crew: s.crewBrain, rotten: s.rottenBrain }, llm: llmOptions(s) })

/** Listeners told whenever a new game object replaces the old one. */
const swapListeners = new Set<(g: Game) => void>()
export function onGameSwap(fn: (g: Game) => void) {
  swapListeners.add(fn)
  return () => swapListeners.delete(fn)
}

export const useSim = create<SimState>((set, get) => {
  const replace = (g: Game, extra: Partial<SimState> = {}) => {
    game = g
    simTargets.clear()
    set({ ...freshState(g), ...extra })
    swapListeners.forEach((fn) => fn(g))
  }
  const rosterFrom = (seed: number, count: number) => makeRoster(makeRng(seed).fork('setup'), count)
  return {
    ...freshState(game),
    // The title and setup screens arrive with milestone 10; until then the game starts at once.
    screen: 'game',
    roster: game.fruits.map((f) => f.def),
    selected: null,
    paused: false,
    speed: 1,
    revealRoles: false,
    showThoughts: false,
    director: true,
    cones: false,
    arrows: false,
    problem: null,
    sceneReady: false,
    settings: initialSettings,

    newGame: (seed = randomSeed()) => {
      const s = get().settings
      replace(gameFactory(seed, s, get().screen === 'game' ? get().roster : undefined), { selected: null })
      if (get().screen !== 'game') set({ roster: game.fruits.map((f) => f.def) })
    },
    startGame: () => {
      const s = get().settings
      replace(gameFactory(get().seed, s, get().roster), { screen: 'game', selected: null, revealRoles: false, paused: false })
    },
    toSetup: () => {
      const s = get().settings
      replace(gameFactory(get().seed, s, get().roster), { screen: 'setup', selected: null })
    },
    setSettings: (patch) => {
      const settings = { ...get().settings, ...patch }
      saveSettings(settings)
      set({ settings })
    },
    setRules: (patch) => {
      const rules = { ...get().settings.rules, ...patch }
      get().setSettings({ rules })
      if (patch.fruits && patch.fruits !== get().roster.length) {
        let roster = get().roster.slice(0, patch.fruits)
        const rng = makeRng(randomSeed())
        while (roster.length < patch.fruits) roster = [...roster, makeFruit(rng, roster)]
        set({ roster })
      }
    },
    updateFruit: (id, patch) =>
      set((s) => ({ roster: s.roster.map((f) => (f.id === id ? { ...f, ...patch, traits: { ...f.traits, ...patch.traits } } : f)) })),
    addFruit: () => {
      const roster = get().roster
      if (roster.length >= MAX_FRUITS) return
      set({ roster: [...roster, makeFruit(makeRng(randomSeed()), roster)] })
      get().setSettings({ rules: { ...get().settings.rules, fruits: roster.length + 1 } })
    },
    removeFruit: (id) => {
      const roster = get().roster
      if (roster.length <= MIN_FRUITS) return
      set({ roster: roster.filter((f) => f.id !== id) })
      get().setSettings({ rules: { ...get().settings.rules, fruits: roster.length - 1 } })
    },
    randomizeRoster: () => set({ roster: rosterFrom(randomSeed(), get().roster.length) }),
    select: (id) => set({ selected: id }),
  }
})

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
