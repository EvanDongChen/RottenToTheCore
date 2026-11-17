import type { Rng } from '../rng'
import { HeuristicBrain } from './heuristic'
import type { LlmOptions } from './llm'
import type { Brain, BrainKind } from './types'

/** A fresh brain for one fruit. Each fruit has its own, with its own random stream. */
export function makeBrain(kind: BrainKind, id: string, rng: Rng, llm?: LlmOptions): Brain {
  void kind
  void llm
  // The Bayesian and LLM brains arrive in milestones 8 and 9.
  return new HeuristicBrain(id, rng)
}
