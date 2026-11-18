import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { newUsage } from '../sim/brains/llm'
import type { LlmBrain, LlmOptions, ReplyCache } from '../sim/brains/llm'
import type { Game } from '../sim/engine'
import type { LlmUsage } from '../sim/metrics'

/** Replies are cached on disk by prompt hash, so a rerun of the same seeds costs nothing. */
const CACHE_FILE = 'results/llm-cache.json'

function fileCache(): ReplyCache & { save(): void } {
  const data: Record<string, string> = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, 'utf8')) : {}
  let dirty = false
  return {
    get: (k) => data[k],
    set: (k, v) => {
      data[k] = v
      dirty = true
    },
    save: () => {
      if (!dirty) return
      mkdirSync(dirname(CACHE_FILE), { recursive: true })
      writeFileSync(CACHE_FILE, JSON.stringify(data))
      dirty = false
    },
  }
}

let cache: ReturnType<typeof fileCache> | null = null

/**
 * LLM settings for one headless game, from the environment: GEMINI_API_KEY, and optionally
 * GEMINI_MODEL. Each game gets its own usage counters. Roaming chats are not worded by the LLM
 * headless: nobody would see them.
 */
export function llmFromEnv(): LlmOptions | undefined {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return undefined
  cache ??= fileCache()
  return {
    apiKey,
    model: process.env.GEMINI_MODEL,
    cache,
    usage: newUsage(),
    chats: false,
    requestsPerMinute: Number(process.env.GEMINI_RPM ?? 0),
    onProblem: (m) => console.warn(`  LLM: ${m}`),
  }
}

export function saveLlmCache() {
  cache?.save()
}

/** What the LLM brains in this game cost. */
export function llmUsage(game: Game): LlmUsage | undefined {
  for (const brain of game.brains.values()) if (brain.kind === 'llm') return { ...(brain as LlmBrain).usage }
  return undefined
}
