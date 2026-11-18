import type { Rng } from '../rng'
import { BayesianBrain } from './bayesian'
import { HeuristicBrain } from './heuristic'
import type { LlmOptions } from './llm'
import type { Brain, BrainKind } from './types'

/** A fresh brain for one fruit. Each fruit has its own, with its own random stream. */
export function makeBrain(kind: BrainKind, id: string, rng: Rng, llm?: LlmOptions): Brain {
  void llm
  // The LLM brain arrives in milestone 9.
  if (kind === 'bayesian') return new BayesianBrain(id, rng)
  return new HeuristicBrain(id, rng)
}
