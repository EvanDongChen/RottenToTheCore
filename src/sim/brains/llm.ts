import { clock, describeClaim, describeSighting } from '../describe'
import { AREAS, placeName } from '../map'
import { sureness } from '../memory'
import { TEMPERS } from '../mind'
import { quirkText } from '../quirks'
import { hashString } from '../rng'
import type { Rng } from '../rng'
import type { FruitView } from '../view'
import { BayesianBrain } from './bayesian'
import type { Ballot, BrainKind, ChatContext, ChatLine, Claim, MeetingLine, MeetingView, Move } from './types'

/**
 * The LLM brain (Gemini). Roaming stays rule-based and synchronous, from the Bayesian brain.
 * Gemini is asked only at decision points: each meeting turn, each vote, and (in the browser)
 * the wording of roaming chats. The Bayesian numbers go into the prompt as a hint. Anything
 * missing or illegal in a reply falls back to the Bayesian brain's choice; it never throws.
 *
 * Plumbing from One Bad Apple's geminiBrain: JSON schema, timeout, retries, free-model fallback,
 * and pacing under a requests-per-minute limit. Replies are cached by a hash of the prompt, so a
 * replay never calls the API again.
 */

const API = 'https://generativelanguage.googleapis.com/v1beta'
const REQUEST_TIMEOUT_MS = 30000
const MAX_ATTEMPTS = 2
/** At most this many roaming chats are being worded at once; the rest keep their stock lines. */
const MAX_CHATS = 3

export const FREE_MODELS = [
  'gemini-flash-lite-latest',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemma-4-26b-a4b-it',
]

/**
 * Dollars per million tokens, input and output, for cost tracking. Approximate list prices at the
 * time of writing; check current pricing before quoting the numbers anywhere.
 */
export const PRICES: Record<string, { input: number; output: number }> = {
  'gemini-flash-lite-latest': { input: 0.1, output: 0.4 },
  'gemini-3.1-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-3.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemma-4-26b-a4b-it': { input: 0, output: 0 },
}

/** Running totals for one game, shared by every LLM brain in it. */
export interface LlmUsage {
  calls: number
  inputTokens: number
  outputTokens: number
  dollars: number
  latencyMs: number
  repaired: number
  claims: number
  hallucinated: number
  cached: number
}

export function newUsage(): LlmUsage {
  return { calls: 0, inputTokens: 0, outputTokens: 0, dollars: 0, latencyMs: 0, repaired: 0, claims: 0, hallucinated: 0, cached: 0 }
}

/** A reply cache: in memory, in local storage or in a file. Keyed by a hash of the whole prompt. */
export interface ReplyCache {
  get(key: string): string | undefined
  set(key: string, value: string): void
}

export function memoryCache(): ReplyCache {
  const m = new Map<string, string>()
  return { get: (k) => m.get(k), set: (k, v) => void m.set(k, v) }
}

export interface LlmOptions {
  apiKey: string
  model?: string
  /** Carry on with the next free model when one is busy or used up. */
  switchModels?: boolean
  requestsPerMinute?: number
  /** After this many calls in a game, fall back to the Bayesian brain. */
  maxCalls?: number
  cache?: ReplyCache
  /** Shared by every LLM brain in one game. */
  usage?: LlmUsage
  /** Word roaming chats with the LLM too (the browser does; headless runs don't, nobody would see them). */
  chats?: boolean
  onProblem?: (message: string) => void
  /** For tests: a stand-in for fetch. */
  fetch?: typeof fetch
}

type Json = Record<string, unknown>

/** One client per game, shared by its LLM brains: pacing, the model in use, and the chat limit. */
class Client {
  private lastCallAt = 0
  private model: string
  private spares: string[]
  private reported = new Set<string>()
  chatsRunning = 0
  readonly usage: LlmUsage
  readonly opts: LlmOptions

  constructor(opts: LlmOptions) {
    this.opts = opts
    this.usage = opts.usage ?? newUsage()
    this.model = opts.model ?? FREE_MODELS[0]
    this.spares = opts.switchModels === false ? [] : FREE_MODELS.filter((m) => m !== this.model)
  }

  private problem(message: string) {
    if (this.reported.has(message)) return
    this.reported.add(message)
    this.opts.onProblem?.(message)
  }

  private switchModel(why: string): boolean {
    const next = this.spares.shift()
    if (!next) return false
    this.problem(`${this.model} ${why}. Switching to ${next}.`)
    this.model = next
    return true
  }

  /** Ask for JSON. Returns null on any failure, after retries and model switches. */
  async ask(system: string, prompt: string, schema: unknown): Promise<Json | null> {
    const key = `llm:${hashString(system)}:${hashString(prompt)}:${hashString(JSON.stringify(schema))}`
    const hit = this.opts.cache?.get(key)
    if (hit) {
      this.usage.cached++
      this.usage.calls++
      try {
        return JSON.parse(hit)
      } catch {
        // A broken cache entry: ask again.
      }
    }
    if (this.usage.calls - this.usage.cached >= (this.opts.maxCalls ?? 400)) {
      this.problem(`Hit the cap of ${this.opts.maxCalls ?? 400} LLM calls in this game. Using the Bayesian brain from here.`)
      return null
    }
    const rpm = this.opts.requestsPerMinute ?? 0
    if (rpm > 0) {
      const gap = 60000 / rpm - (Date.now() - this.lastCallAt)
      if (gap > 0) await new Promise((r) => setTimeout(r, gap))
    }
    const doFetch = this.opts.fetch ?? fetch
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      this.lastCallAt = Date.now()
      const started = Date.now()
      this.usage.calls++
      try {
        const res = await doFetch(`${API}/models/${this.model}:generateContent`, {
          method: 'POST',
          headers: { 'x-goog-api-key': this.opts.apiKey, 'content-type': 'application/json' },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.9 },
          }),
        })
        this.usage.latencyMs += Date.now() - started
        if ((res.status === 429 || res.status === 404) && this.switchModel(res.status === 429 ? 'is out of requests' : 'is not available')) {
          attempt = 0
          continue
        }
        const json = (await res.json()) as Json
        if (!res.ok) {
          if (attempt === MAX_ATTEMPTS) this.problem(`Gemini error: ${(json?.error as Json)?.message ?? `HTTP ${res.status}`}`)
          continue
        }
        const meta = (json.usageMetadata ?? {}) as { promptTokenCount?: number; candidatesTokenCount?: number }
        const input = meta.promptTokenCount ?? Math.round((system.length + prompt.length) / 4)
        const output = meta.candidatesTokenCount ?? 60
        this.usage.inputTokens += input
        this.usage.outputTokens += output
        const price = PRICES[this.model] ?? { input: 0.1, output: 0.4 }
        this.usage.dollars += (input * price.input + output * price.output) / 1e6
        const parts = (((json.candidates as Json[] | undefined)?.[0]?.content as Json | undefined)?.parts ?? []) as { text?: string }[]
        const text = parts.find((p) => p.text)?.text
        const parsed = text ? JSON.parse(text) : null
        if (parsed && typeof parsed === 'object') {
          this.opts.cache?.set(key, JSON.stringify(parsed))
          return parsed
        }
      } catch (err) {
        this.usage.latencyMs += Date.now() - started
        if (attempt === MAX_ATTEMPTS && !this.switchModel('is too slow right now')) {
          this.problem(`LLM request failed (${err instanceof Error ? err.message : String(err)}). Using the Bayesian brain for that turn.`)
        }
      }
    }
    return null
  }
}

/** One client per options object, so every LLM brain in a game shares one. */
const clients = new WeakMap<LlmOptions, Client>()
function clientFor(opts: LlmOptions): Client {
  let c = clients.get(opts)
  if (!c) clients.set(opts, (c = new Client(opts)))
  return c
}

// ---------- Prompts ----------

const ROLE_BRIEF = {
  crew: 'CREW. Wants to find the Rotten and vote them out. Does not know who they are.',
  rotten: 'ROTTEN, the impostor. Secretly slices crew when nobody is looking. In meetings it blends in, gives alibis that match what it said before, frames others and never admits what it is.',
}

const MOVES: Move[] = ['alibi', 'accuse', 'defend', 'vouch', 'question', 'corroborate', 'contradict', 'hardClaim', 'bandwagon', 'skip', 'pass', 'report']

/** A fruit's character sheet, written from its own point of view. */
export function persona(view: FruitView): string {
  const t = view.traits
  const level = (n: number) => `${Math.round(n * 10)}/10`
  return [
    `You are ${view.name}, a little fruit with stick legs in a lab.`,
    `Role: ${ROLE_BRIEF[view.role]}${view.partners.length ? ` Your fellow Rotten: ${view.partners.map((p) => nameIn(view, p)).join(', ')}.` : ''}`,
    `Personality: aggression ${level(t.aggression)}, honesty ${level(t.honesty)}, talkativeness ${level(t.talkativeness)}, suspicion ${level(t.suspicion)}, sharpness ${level(t.sharpness)}.`,
    t.quirks.length ? `Quirks: ${t.quirks.map(quirkText).join(' ')}` : '',
    t.backstory ? `Backstory, in your own words: "${t.backstory}"` : '',
    `Way of thinking: ${TEMPERS[t.temper].label.toLowerCase()}. ${TEMPERS[t.temper].text}`,
  ]
    .filter(Boolean)
    .join('\n')
}

function nameIn(view: FruitView, id: string): string {
  return id === view.id ? view.name : (view.others.find((o) => o.id === id)?.name ?? id)
}

const SYSTEM = [
  'You voice one fruit in a game like Among Us, played by fruits in a lab. Crew do tasks; one or two Rotten secretly slice crew. Meetings are called when a body is found or the emergency button is pressed; then everyone talks and votes someone into the Juicer, or skips.',
  'Speak only from what your fruit knows: its own memories and what it heard. Memories fade: say "I saw" only when you are sure, "I think" when you are fairly sure, and keep quiet about vague ones unless asked.',
  'Stay in character. Anything said out loud is one or two short sentences, at most 25 words.',
  'Reply with JSON matching the schema and nothing else. Use fruit names exactly as written and place ids from the list.',
].join('\n')

/** Memories as plain sentences with confidence words. */
function memoryText(view: FruitView): string {
  const n = (id: string) => nameIn(view, id)
  const lines = [...view.memory]
    .filter((m) => m.now >= 0.3 && m.kind !== 'seen')
    .concat([...view.memory].filter((m) => m.kind === 'seen' && m.now >= 0.5).slice(-12))
    .sort((a, b) => a.to - b.to)
    .slice(-30)
    .map((m) => {
      const s = sureness(m.now)
      const sure = s === 'sure' ? "you're sure" : s === 'think' ? "you're fairly sure" : 'vaguely'
      return `- (${sure}) You ${describeSighting(m, n)}.`
    })
  return lines.length ? lines.join('\n') : '- Nothing worth mentioning.'
}

function trailText(view: FruitView): string {
  return view.trail
    .filter((t) => t.to - t.from > 2)
    .slice(-8)
    .map((t) => `${clock(t.from)}-${clock(t.to)} ${placeName(t.area)}`)
    .join('; ')
}

function situation(view: FruitView, beliefs: Record<string, number>): string {
  const living = view.others.filter((o) => o.alive)
  const hunch = Object.entries(beliefs)
    .filter(([id]) => living.some((o) => o.id === id))
    .sort((a, b) => b[1] - a[1])
    .map(([id, p]) => `${nameIn(view, id)} ${Math.round(p * 100)}%`)
    .join(', ')
  const said = view.ledger.slice(-6).map((c) => `- you said you ${describeClaim(c.claim, (id) => nameIn(view, id))}`)
  return [
    `Time ${clock(view.time)}. Living: ${[view.name, ...living.map((o) => o.name)].join(', ')}. Dead: ${view.others.filter((o) => !o.alive).map((o) => o.name).join(', ') || 'nobody'}.`,
    `Places (use these ids): ${AREAS.map((a) => `${a.id} = ${a.name}`).join('; ')}.`,
    `Where you have really been: ${trailText(view) || 'here and there'}.`,
    view.role === 'rotten' && view.kills.length ? `Your kills (secret): ${view.kills.map((k) => `${nameIn(view, k.victim)} in ${placeName(k.area)} at ${clock(k.time)}`).join('; ')}.` : '',
    `Your memories:\n${memoryText(view)}`,
    view.role === 'crew' ? `A careful reckoner's odds that each fruit is Rotten (a hint, not gospel): ${hunch || 'no idea yet'}.` : '',
    said.length ? `What you have claimed so far (keep your story straight):\n${said.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function meetingText(view: FruitView, meeting: MeetingView): string {
  const n = (id: string) => nameIn(view, id)
  const lines = meeting.lines.map(({ who, line }) => `${n(who)}: ${line.say}`)
  return [
    meeting.reason === 'body' && meeting.body ? `${n(meeting.caller)} reported ${n(meeting.body.victim)}'s body in ${placeName(meeting.body.room)}.` : `${n(meeting.caller)} pressed the emergency button.`,
    lines.length ? `Said so far:\n${lines.slice(-24).join('\n')}` : 'Nothing said yet.',
    meeting.checks.length
      ? `Your reactions so far: ${meeting.checks.map((c) => `${n(c.speaker)}'s claim ${c.how === 'match' ? 'matches what you saw' : c.how === 'conflict' ? 'clashes with what you clearly saw' : 'seems off from what you vaguely remember'}`).join('; ')}.`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

const STEP_TASK: Record<MeetingView['step'], string> = {
  report: 'You called this meeting. Open it: say what you found or why you pressed the button.',
  roundup: 'Round-up: say where you were in the run-up to this meeting (a "where" claim) and your strongest observation, if any.',
  open: 'Open floor: make one move. Accuse, defend yourself, vouch, ask someone a question, back up or contradict a claim, make a hard claim about something you saw, join a bandwagon, call to skip, or pass.',
  lastCall: 'Last call: you stand accused. Give your final defence.',
  vote: '',
}

const STR = { type: 'STRING' }
const NUM = { type: 'NUMBER' }
const LINE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    move: { type: 'STRING', enum: MOVES },
    target: STR,
    say: STR,
    claim: {
      type: 'OBJECT',
      properties: { kind: { type: 'STRING', enum: ['where', 'saw'] }, room: STR, what: { type: 'STRING', enum: ['seen', 'atTask', 'fakeTask', 'nearBody', 'vented', 'kill'] }, who: STR, victim: STR, from: NUM, to: NUM, at: NUM },
    },
  },
  required: ['move', 'say'],
}
const VOTE_SCHEMA = { type: 'OBJECT', properties: { target: STR, reason: STR }, required: ['target', 'reason'] }
const CHAT_SCHEMA = { type: 'OBJECT', properties: { say: STR }, required: ['say'] }

// ---------- The brain ----------

export class LlmBrain extends BayesianBrain {
  override readonly kind: BrainKind = 'llm'
  private client: Client

  constructor(id: string, rng: Rng, opts: LlmOptions) {
    super(id, rng)
    this.client = clientFor(opts)
  }

  get usage(): LlmUsage {
    return this.client.usage
  }

  /** A fruit's name or id from a reply, matched to a living fruit. */
  private resolve(view: FruitView, value: unknown, allowed: string[]): string | null {
    if (typeof value !== 'string') return null
    const key = value.trim().toLowerCase()
    const all = [{ id: view.id, name: view.name }, ...view.others]
    const hit = all.find((o) => o.name.toLowerCase() === key || o.id.toLowerCase() === key)
    return hit && allowed.includes(hit.id) ? hit.id : null
  }

  private place(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const key = value.trim().toLowerCase()
    return AREAS.find((a) => a.id === key || a.name.toLowerCase() === key)?.id ?? null
  }

  private claimFrom(view: FruitView, raw: unknown, living: string[]): Claim | undefined {
    if (!raw || typeof raw !== 'object') return undefined
    const c = raw as Json
    const room = this.place(c.room)
    if (!room) return undefined
    if (c.kind === 'where') {
      const from = Number(c.from)
      const to = Number(c.to)
      const span = Number.isFinite(from) && Number.isFinite(to) ? [from, to] : [view.time - 40, view.time]
      return { kind: 'where', room, from: Math.min(span[0], span[1]), to: Math.max(span[0], span[1]) }
    }
    const who = this.resolve(view, c.who, [...living, ...view.others.map((o) => o.id)])
    if (!who) return undefined
    const what = ['seen', 'atTask', 'fakeTask', 'nearBody', 'vented', 'kill'].includes(String(c.what)) ? (c.what as 'seen') : 'seen'
    const at = Number.isFinite(Number(c.at)) ? Number(c.at) : view.time - 20
    const victim = this.resolve(view, c.victim, view.others.map((o) => o.id)) ?? undefined
    return { kind: 'saw', what, who, room, at, victim }
  }

  /**
   * A claim to have seen something the fruit has no memory of. Crew only: the Rotten lie on
   * purpose, which is the game, not a hallucination.
   */
  private hallucinated(view: FruitView, claim: Claim | undefined): boolean {
    if (!claim || claim.kind !== 'saw' || view.role !== 'crew') return false
    this.client.usage.claims++
    const ok = view.memory.some((m) => m.who === claim.who && (m.kind === claim.what || (m.kind === 'heard' && m.told === claim.what) || (claim.what === 'seen' && m.kind !== 'heard')))
    if (!ok) this.client.usage.hallucinated++
    return !ok
  }

  override async speak(view: FruitView, meeting: MeetingView): Promise<MeetingLine> {
    const fallback = await super.speak(view, meeting)
    // Backing up someone's story, or saying where it was at one moment, is a matter of memory:
    // the rule-based answer is exactly what it remembers, so use it as is.
    if (meeting.confirm || meeting.askedAt !== undefined) return fallback
    const prompt = [
      persona(view),
      situation(view, this.beliefs(view)),
      meetingText(view, meeting),
      meeting.askedBy ? `${nameIn(view, meeting.askedBy)} just asked you where you were. Answer it.` : '',
      `YOUR TURN. ${STEP_TASK[meeting.step]}`,
      `Moves: ${MOVES.join(', ')}. "target" is a fruit's name (for accuse, vouch, question, corroborate, contradict, hardClaim, bandwagon). "claim" is optional: {"kind":"where","room":place id,"from":seconds,"to":seconds} or {"kind":"saw","what":one of seen/atTask/fakeTask/nearBody/vented/kill,"who":name,"room":place id,"at":seconds,"victim":name}. "say" is the line out loud.`,
      `For comparison, a simple rule would say: ${JSON.stringify({ move: fallback.move, target: fallback.target ? nameIn(view, fallback.target) : undefined, say: fallback.say })}`,
    ]
      .filter(Boolean)
      .join('\n\n')
    const out = await this.client.ask(SYSTEM, prompt, LINE_SCHEMA)
    if (!out) return fallback
    let repaired = false
    const move = MOVES.includes(out.move as Move) ? (out.move as Move) : ((repaired = true), fallback.move)
    let target = out.target ? this.resolve(view, out.target, meeting.living.filter((id) => id !== view.id)) : null
    if (out.target && !target) repaired = true
    if (!target && ['accuse', 'vouch', 'question', 'corroborate', 'contradict', 'hardClaim', 'bandwagon'].includes(move)) target = fallback.target ?? null
    const claim = this.claimFrom(view, out.claim, meeting.living)
    if (out.claim && !claim) repaired = true
    const say = typeof out.say === 'string' && out.say.trim() ? out.say.trim().slice(0, 240) : ((repaired = true), fallback.say)
    if (repaired) this.client.usage.repaired++
    this.hallucinated(view, claim)
    // A defence keeps the witness the rule-based answer named, so the story can be checked.
    const witness = move === 'defend' && fallback.move === 'defend' ? fallback.witness : undefined
    return { move, target: target ?? undefined, claim, say, ...(witness ? { witness } : {}) }
  }

  override async vote(view: FruitView, meeting: MeetingView): Promise<Ballot> {
    const fallback = await super.vote(view, meeting)
    const prompt = [
      persona(view),
      situation(view, this.beliefs(view)),
      meetingText(view, meeting),
      `VOTE. Choose one living fruit other than yourself to put in the Juicer, or "skip". Give a one-line reason said out loud.`,
      `For comparison, a simple rule would vote: ${fallback.target === 'skip' ? 'skip' : nameIn(view, fallback.target)}.`,
    ].join('\n\n')
    const out = await this.client.ask(SYSTEM, prompt, VOTE_SCHEMA)
    if (!out) return fallback
    const skip = typeof out.target === 'string' && out.target.trim().toLowerCase() === 'skip'
    const target = skip ? 'skip' : this.resolve(view, out.target, meeting.living.filter((id) => id !== view.id))
    if (!target) {
      this.client.usage.repaired++
      return fallback
    }
    return { target, reason: typeof out.reason === 'string' ? out.reason.slice(0, 160) : fallback.reason }
  }

  /** Words for a roaming chat line. The engine has already decided what is shared. */
  override async chat(view: FruitView, chat: ChatContext): Promise<ChatLine[]> {
    const fallback = await super.chat(view, chat)
    if (!this.client.opts.chats || this.client.chatsRunning >= MAX_CHATS) return fallback
    this.client.chatsRunning++
    try {
      const prompt = [
        persona(view),
        `You are chatting with ${nameIn(view, chat.partner)} while roaming the lab (${chat.setting}).`,
        `Your recent memories of them:\n${view.memory.filter((m) => m.who === chat.partner).slice(-4).map((m) => `- You ${describeSighting(m, (id) => nameIn(view, id))}.`).join('\n') || '- none'}`,
        `What you want to get across, in your own voice: "${fallback[0].say}"`,
        'Reply with one short line (at most 20 words) that says the same thing.',
      ].join('\n\n')
      const out = await this.client.ask(SYSTEM, prompt, CHAT_SCHEMA)
      const say = typeof out?.say === 'string' ? out.say.trim().slice(0, 160) : ''
      return say ? [{ ...fallback[0], say }] : fallback
    } finally {
      this.client.chatsRunning--
    }
  }
}
