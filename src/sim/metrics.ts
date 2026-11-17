import type { BrainKind } from './brains/types'
import type { Game } from './engine'

/** One finished game, boiled down for the benchmarks. */
export interface GameResult {
  seed: number
  crew: BrainKind
  rotten: BrainKind
  winner: 'crew' | 'rotten' | 'draw'
  how: string
  /** Sim minutes. */
  length: number
  meetings: number
  kills: number
  witnessedKills: number
  correctEjections: number
  wrongfulEjections: number
  /** Wrongful ejections where at least one voter acted on a bent memory. */
  wrongfulFromBent: number
  skips: number
  bentMemories: number
  contradictions: number
  chats: number
  rumours: number
  vents: number
  sabotages: number
  llm?: LlmUsage
}

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

export function resultOf(game: Game, crew: BrainKind, rotten: BrainKind, llm?: LlmUsage): GameResult {
  const s = game.stats
  return {
    seed: game.seed,
    crew,
    rotten,
    winner: game.winner ?? 'draw',
    how: game.how ?? 'unfinished',
    length: Math.round((game.time / 60) * 100) / 100,
    meetings: s.meetings,
    kills: s.kills,
    witnessedKills: s.witnessedKills,
    correctEjections: s.ejections.filter((e) => e.role === 'rotten').length,
    wrongfulEjections: s.ejections.filter((e) => e.role === 'crew').length,
    wrongfulFromBent: s.ejections.filter((e) => e.role === 'crew' && e.byBentMemory).length,
    skips: s.skips,
    bentMemories: s.bentMemories,
    contradictions: s.contradictions,
    chats: s.chats,
    rumours: s.rumours,
    vents: s.vents,
    sabotages: s.sabotages,
    llm,
  }
}

export interface Summary {
  crew: BrainKind
  rotten: BrainKind
  games: number
  crewWinRate: number
  rottenWinRate: number
  drawRate: number
  /** Share of games ending each way. */
  endings: Record<string, number>
  correctEjections: number
  wrongfulEjections: number
  skips: number
  /** Share of ejections that removed a Rotten. */
  ejectionAccuracy: number
  avgLength: number
  meetingsPerGame: number
  killsPerGame: number
  witnessedKillRate: number
  bentMemoriesPerGame: number
  wrongfulFromBentRate: number
  contradictionsPerGame: number
  chatsPerGame: number
  rumoursPerGame: number
  llm?: {
    callsPerGame: number
    tokensPerGame: number
    dollarsPerGame: number
    avgLatencyMs: number
    repairedPerGame: number
    hallucinationRate: number
  }
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const r3 = (n: number) => Math.round(n * 1000) / 1000

export function summarize(results: GameResult[]): Summary {
  const n = results.length || 1
  const count = (f: (r: GameResult) => boolean) => results.filter(f).length
  const sum = (f: (r: GameResult) => number) => results.reduce((a, r) => a + f(r), 0)
  const endings: Record<string, number> = {}
  for (const r of results) endings[`${r.winner}:${r.how}`] = (endings[`${r.winner}:${r.how}`] ?? 0) + 1 / n
  for (const k in endings) endings[k] = r3(endings[k])
  const correct = sum((r) => r.correctEjections)
  const wrong = sum((r) => r.wrongfulEjections)
  const llmGames = results.filter((r) => r.llm)
  return {
    crew: results[0]?.crew ?? 'heuristic',
    rotten: results[0]?.rotten ?? 'heuristic',
    games: results.length,
    crewWinRate: r3(count((r) => r.winner === 'crew') / n),
    rottenWinRate: r3(count((r) => r.winner === 'rotten') / n),
    drawRate: r3(count((r) => r.winner === 'draw') / n),
    endings,
    correctEjections: correct,
    wrongfulEjections: wrong,
    skips: sum((r) => r.skips),
    ejectionAccuracy: r3(correct / Math.max(1, correct + wrong)),
    avgLength: r3(mean(results.map((r) => r.length))),
    meetingsPerGame: r3(sum((r) => r.meetings) / n),
    killsPerGame: r3(sum((r) => r.kills) / n),
    witnessedKillRate: r3(sum((r) => r.witnessedKills) / Math.max(1, sum((r) => r.kills))),
    bentMemoriesPerGame: r3(sum((r) => r.bentMemories) / n),
    wrongfulFromBentRate: r3(sum((r) => r.wrongfulFromBent) / Math.max(1, wrong)),
    contradictionsPerGame: r3(sum((r) => r.contradictions) / n),
    chatsPerGame: r3(sum((r) => r.chats) / n),
    rumoursPerGame: r3(sum((r) => r.rumours) / n),
    llm: llmGames.length
      ? {
          callsPerGame: r3(mean(llmGames.map((r) => r.llm!.calls))),
          tokensPerGame: Math.round(mean(llmGames.map((r) => r.llm!.inputTokens + r.llm!.outputTokens))),
          dollarsPerGame: Math.round(mean(llmGames.map((r) => r.llm!.dollars)) * 10000) / 10000,
          avgLatencyMs: Math.round(mean(llmGames.map((r) => r.llm!.latencyMs / Math.max(1, r.llm!.calls - r.llm!.cached)))),
          repairedPerGame: r3(mean(llmGames.map((r) => r.llm!.repaired))),
          hallucinationRate: r3(sum((r) => r.llm?.hallucinated ?? 0) / Math.max(1, sum((r) => r.llm?.claims ?? 0))),
        }
      : undefined,
  }
}
