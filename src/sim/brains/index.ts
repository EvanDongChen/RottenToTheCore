import type { Rng } from '../rng'
import { BayesianBrain } from './bayesian'
import { HeuristicBrain } from './heuristic'
import { LlmBrain } from './llm'
import type { LlmOptions } from './llm'
import type { Brain, BrainKind } from './types'

/**
 * A fresh brain for one fruit. Each fruit has its own, with its own random stream. Without an API
 * key, an LLM brain plays as the Bayesian brain it is built on.
 */
export function makeBrain(kind: BrainKind, id: string, rng: Rng, llm?: LlmOptions): Brain {
  if (kind === 'llm' && llm?.apiKey) return new LlmBrain(id, rng, llm)
  if (kind === 'bayesian' || kind === 'llm') return new BayesianBrain(id, rng)
  return new HeuristicBrain(id, rng)
}
