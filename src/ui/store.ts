import { create } from 'zustand'
import type { Vector3 } from 'three'
import { memoryCache, newUsage } from '../sim/brains/llm'
import type { LlmOptions } from '../sim/brains/llm'
import type { BrainKind } from '../sim/brains/types'
import { createGame, defaultRoster, taskBar } from '../sim/engine'
import type { ReplaySetup } from '../sim/log'
import type { Game } from '../sim/engine'
import { makeRng } from '../sim/rng'
import { makeFruit } from '../sim/roster'
import { DEFAULT_RULES, MAX_FRUITS, MIN_FRUITS } from '../sim/rules'
import type { FruitDef, FruitKind, Mood, Perk, Phase, Reaction, Role, Rules, Traits, Winner } from '../sim/types'

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
  /** A crew fruit's special ability (stretch rules), if any. */
  perk: Perk | null
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

/**
 * Seed, brains and rules can come from the URL, so a game without the LLM can be shared and
 * played again exactly: ?seed=42&crew=bayesian&rotten=heuristic&rules=killCooldown:30,rotten:2
 */
function fromUrl(): { seed: number | null; patch: Partial<Settings> } {
  try {
    const q = new URLSearchParams(location.search)
    const seed = Number(q.get('seed'))
    const patch: Partial<Settings> = {}
    const brain = (v: string | null) => (v === 'heuristic' || v === 'bayesian' || v === 'llm' ? v : undefined)
    if (brain(q.get('crew'))) patch.crewBrain = brain(q.get('crew'))
    if (brain(q.get('rotten'))) patch.rottenBrain = brain(q.get('rotten'))
    const rules = q.get('rules')
    if (rules) {
      const r: Partial<Rules> = {}
      for (const pair of rules.split(',')) {
        const [k, v] = pair.split(':')
        if (k in DEFAULT_RULES) (r as Record<string, unknown>)[k] = v === 'true' ? true : v === 'false' ? false : Number(v)
      }
      patch.rules = { ...DEFAULT_RULES, ...r }
    }
    return { seed: Number.isFinite(seed) && seed > 0 ? seed : null, patch }
  } catch {
    return { seed: null, patch: {} }
  }
}

/** A link that plays this game again: seed, brains and any rules that differ from the defaults. */
export function shareLink(setup: ReplaySetup): string {
  const changed = Object.entries(setup.rules).filter(([k, v]) => DEFAULT_RULES[k as keyof Rules] !== v)
  const q = new URLSearchParams({ seed: String(setup.seed), crew: setup.brains.crew, rotten: setup.brains.rotten })
  if (changed.length) q.set('rules', changed.map(([k, v]) => `${k}:${v}`).join(','))
  return `${location.origin}${location.pathname}?${q}`
}

const url = fromUrl()
const initialSettings = { ...loadSettings(), ...url.patch }
const initialSeed = url.seed ?? randomSeed()

/** The running game. Kept outside React state: the clock advances it in place. */
let game: Game = createGame({ seed: initialSeed, rules: { ...initialSettings.rules, killCooldown: 1e9, emergencyMeetings: 0 } })

export function currentGame() {
  return game
}

export function uiFruits(g: Game): UiFruit[] {
  return g.fruits.map((f) => {
    const beliefs = f.mind.beliefs
    const suspect = Object.keys(beliefs)
      .filter((id) => beliefs[id] > 0.4)
      .sort((a, b) => beliefs[b] - beliefs[a])[0]
    return { id: f.id, name: f.def.name, kind: f.def.kind, traits: f.def.traits, role: f.role, perk: f.perk, alive: f.alive, mood: { ...f.mind.mood }, thought: f.mind.thought, suspect, beliefs: { ...beliefs } }
  })
}

/** What the director camera is drawn to right now. */
export interface Shot {
  kind: 'kill' | 'body' | 'vent'
  at: [number, number]
  /** performance.now() when it started. */
  since: number
  key: number
}

/** A replay being watched: the same game played again from its setup. */
export interface ReplayMark {
  t: number
  kind: 'kill' | 'meeting' | 'eject'
  label: string
}

export interface Replay {
  /** Where it came from: this game, or a log file. */
  from: 'game' | 'file'
  /** How long the game lasts, in sim seconds, as far as is known. */
  length: number
  /** The hash of the loaded log, to check the replay against. */
  expectHash?: string
  /** Set once the replay reaches the end: whether it matched the log exactly. */
  verified?: boolean
  /** Moments to jump to on the timeline: kills, meetings and ejections. */
  marks: ReplayMark[]
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
  /** The roster was changed by hand, so the seed alone no longer reproduces the game. */
  rosterEdited: boolean
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
  /** The fruit the camera is following, if any (picked by clicking it; Esc stops). */
  follow: string | null
  /** Soft glow round screens, lights and buttons. */
  glow: boolean
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
  /** Paper ballots in the air or on the table, one per vote, in the order cast (real times). */
  ballots: { voter: string; target: string; at: number }[]
  /** Votes that have landed, per target (or 'skip'): the tally shown over each fruit. */
  tally: Record<string, number>
  lightsOut: boolean
  /** Slow motion until this real time (performance.now()). */
  slowUntil: number
  /** Fruits climbing through a vent: when they started (real ms) and how long the climb-in lasts. */
  venting: Record<string, { at: number; inMs: number } | undefined>
  /** The ejected fruit going into the Juicer, and when it jumped in (real ms). */
  juicing: { id: string; at: number } | null
  /** When the emergency button was last pressed (real ms), for the press animation. */
  buttonAt: number
  /** When the Juicer's press last came down (real ms). */
  /** The blender running: when it started and how long it spins, in real milliseconds. */
  blending: { at: number; ms: number; color: string } | null
  /** Sim time a meltdown goes off, if one is going. */
  meltdownAt: number | null
  /** A room locked by sabotage. */
  lockedRoom: string | null
  paused: boolean
  speed: number
  revealRoles: boolean
  showThoughts: boolean
  director: boolean
  cones: boolean
  arrows: boolean
  /** A problem with the LLM brain, shown once. */
  problem: string | null
  shot: Shot | null
  replay: Replay | null
  /** Which tab of the log is open. */
  logTab: 'all' | FeedEntry['tab']
  /** The end-of-game recap is open. */
  recapOpen: boolean
  sceneReady: boolean
  settings: Settings

  newGame(seed?: number): void
  /** Pick a new seed on the setup screen, with that seed's own roster. */
  reseed(seed?: number): void
  startGame(): void
  toSetup(): void
  setSettings(patch: Partial<Settings>): void
  setRules(patch: Partial<Rules>): void
  updateFruit(id: string, patch: Partial<Omit<FruitDef, 'traits'>> & { traits?: Partial<Traits> }): void
  addFruit(): void
  removeFruit(id: string): void
  randomizeRoster(): void
  select(id: string | null): void
  /** Show a game made elsewhere (a replay that was fast-forwarded), keeping the screen as it is. */
  adoptGame(g: Game, extra?: Partial<SimState>): void
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
    shot: null,
    recapOpen: false,
    party: null,
    splats: [],
    bursts: [],
    vents: {},
    reactions: {},
    focusId: null,
    votes: {},
    ballots: [],
    tally: {},
    lightsOut: false,
    slowUntil: 0,
    venting: {},
    juicing: null,
    buttonAt: 0,
    blending: null,
    meltdownAt: null,
    lockedRoom: null,
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

/** Behind the title and setup screens, the fruits go about their chores and nobody dies. */
const DEMO_RULES: Partial<Rules> = { killCooldown: 1e9, emergencyMeetings: 0 }
const demoGame = (seed: number, s: Settings, roster?: FruitDef[]) =>
  createGame({ seed, roster, rules: { ...s.rules, ...DEMO_RULES, fruits: roster?.length ?? s.rules.fruits }, brains: { crew: 'heuristic', rotten: 'heuristic' } })

/** The roster to pass when starting: only an edited one; otherwise the seed draws its own. */
const rosterFor = (st: { roster: FruitDef[]; rosterEdited: boolean }) => (st.rosterEdited ? st.roster : undefined)

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
  return {
    ...freshState(game),
    screen: 'title',
    roster: game.fruits.map((f) => f.def),
    rosterEdited: false,
    selected: null,
    follow: null,
    glow: true,
    paused: false,
    speed: 1,
    revealRoles: false,
    showThoughts: false,
    director: false,
    cones: false,
    arrows: false,
    problem: null,
    shot: null,
    replay: null,
    logTab: 'all',
    recapOpen: false,
    sceneReady: false,
    settings: initialSettings,

    newGame: (seed = randomSeed()) => {
      const s = get().settings
      replace(gameFactory(seed, s, rosterFor(get())), { selected: null, follow: null, replay: null, recapOpen: false })
      set({ roster: game.fruits.map((f) => f.def) })
    },
    reseed: (seed = randomSeed()) => {
      const count = get().roster.length
      set({ seed, roster: defaultRoster(seed, count), rosterEdited: false })
      replace(demoGame(seed, get().settings, rosterFor(get())), { screen: get().screen })
    },
    startGame: () => {
      const s = get().settings
      replace(gameFactory(get().seed, s, rosterFor(get())), { screen: 'game', selected: null, follow: null, revealRoles: false, paused: false, replay: null, recapOpen: false })
    },
    toSetup: () => {
      const s = get().settings
      // Coming from the title screen, keep the seed (it may have come from a shared link).
      const seed = get().screen === 'title' ? get().seed : randomSeed()
      if (!get().rosterEdited) set({ roster: defaultRoster(seed, get().roster.length) })
      replace(demoGame(seed, s, rosterFor(get())), { screen: 'setup', selected: null, follow: null, replay: null, recapOpen: false, paused: false })
      set({ roster: get().rosterEdited ? get().roster : game.fruits.map((f) => f.def) })
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
        if (!get().rosterEdited) set({ roster: defaultRoster(get().seed, patch.fruits) })
        else {
          let roster = get().roster.slice(0, patch.fruits)
          const rng = makeRng(randomSeed())
          while (roster.length < patch.fruits) roster = [...roster, makeFruit(rng, roster)]
          set({ roster })
        }
      }
    },
    updateFruit: (id, patch) =>
      set((s) => ({ rosterEdited: true, roster: s.roster.map((f) => (f.id === id ? { ...f, ...patch, traits: { ...f.traits, ...patch.traits } } : f)) })),
    addFruit: () => {
      const roster = get().roster
      if (roster.length >= MAX_FRUITS) return
      set({ rosterEdited: true, roster: [...roster, makeFruit(makeRng(randomSeed()), roster)] })
      get().setSettings({ rules: { ...get().settings.rules, fruits: roster.length + 1 } })
    },
    removeFruit: (id) => {
      const roster = get().roster
      if (roster.length <= MIN_FRUITS) return
      set({ rosterEdited: true, roster: roster.filter((f) => f.id !== id) })
      get().setSettings({ rules: { ...get().settings.rules, fruits: roster.length - 1 } })
    },
    randomizeRoster: () => get().reseed(),
    // Picking a fruit also has the camera follow it; dropping the pick stops following.
    select: (id) => set({ selected: id, follow: id }),
    adoptGame: (g, extra = {}) => replace(g, { screen: 'game', ...extra }),
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
