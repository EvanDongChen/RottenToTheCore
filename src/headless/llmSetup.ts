import type { LlmOptions } from '../sim/brains/llm'
import type { Game } from '../sim/engine'
import type { LlmUsage } from '../sim/metrics'

/** LLM settings for headless runs, from the environment. Filled out with milestone 9. */
export function llmFromEnv(): LlmOptions | undefined {
  const apiKey = process.env.GEMINI_API_KEY
  return apiKey ? { apiKey } : undefined
}

/** What the LLM brains in this game cost. Filled out with milestone 9. */
export function llmUsage(game: Game): LlmUsage | undefined {
  void game
  return undefined
}
