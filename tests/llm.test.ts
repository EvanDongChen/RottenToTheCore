import { describe, expect, it } from 'vitest'
import { memoryCache, newUsage } from '../src/sim/brains/llm'
import type { LlmBrain, LlmOptions } from '../src/sim/brains/llm'
import { createGame } from '../src/sim/engine'
import { playGame } from '../src/sim/game'

/** A stand-in for the Gemini API that answers from a script and counts calls. */
function fakeGemini(reply: (prompt: string, schema: unknown) => unknown) {
  let calls = 0
  const f = (async (_url: string, init: { body: string }) => {
    calls++
    const body = JSON.parse(init.body)
    const prompt = body.contents[0].parts[0].text as string
    const out = reply(prompt, body.generationConfig.responseSchema)
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 40 } }), { status: 200 })
  }) as unknown as typeof fetch
  return { fetch: f, calls: () => calls }
}

function options(f: typeof fetch): LlmOptions {
  return { apiKey: 'test', fetch: f, cache: memoryCache(), usage: newUsage(), switchModels: false }
}

describe('LLM brain', () => {
  it('plays a whole game, repairing nonsense replies, and tracks cost', async () => {
    const gemini = fakeGemini((_p, schema) =>
      (schema as { properties: Record<string, unknown> }).properties.move
        ? { move: 'accuse', target: 'Nobody At All', say: 'It was the moon!', claim: { kind: 'saw', what: 'kill', who: 'Ghosty', room: 'nowhere', at: 3 } }
        : { target: 'the moon', reason: 'hunch' },
    )
    const llm = options(gemini.fetch)
    const game = await playGame(createGame({ seed: 4, brains: { crew: 'llm', rotten: 'heuristic' }, llm }))
    expect(game.winner).toBeTruthy()
    const usage = ([...game.brains.values()].find((b) => b.kind === 'llm') as LlmBrain).usage
    expect(usage.calls).toBeGreaterThan(5)
    expect(usage.repaired).toBeGreaterThan(0)
    expect(usage.inputTokens).toBe(1000 * (usage.calls - usage.cached))
    expect(usage.dollars).toBeGreaterThan(0)
  })

  it('counts a claim about something the fruit never saw as hallucinated', async () => {
    const game = createGame({ seed: 4, brains: { crew: 'llm', rotten: 'heuristic' } })
    const victim = game.fruits[1].def.name
    const accused = game.fruits[2].def.name
    const gemini = fakeGemini(() => ({ move: 'hardClaim', target: accused, say: `I saw ${accused} slice ${victim}!`, claim: { kind: 'saw', what: 'kill', who: accused, room: 'lab', at: 10, victim } }))
    const llm = options(gemini.fetch)
    const g = await playGame(createGame({ seed: 4, brains: { crew: 'llm', rotten: 'heuristic' }, llm }))
    const usage = ([...g.brains.values()].find((b) => b.kind === 'llm') as LlmBrain).usage
    expect(usage.claims).toBeGreaterThan(0)
    expect(usage.hallucinated).toBeGreaterThan(0)
  })

  it('never calls the API twice for the same prompt (replays are free)', async () => {
    const gemini = fakeGemini((_p, schema) => ((schema as { properties: Record<string, unknown> }).properties.move ? { move: 'skip', say: 'Skip.' } : { target: 'skip', reason: 'unsure' }))
    const cache = memoryCache()
    const a = await playGame(createGame({ seed: 7, brains: { crew: 'llm' }, llm: { ...options(gemini.fetch), cache } }))
    const first = gemini.calls()
    const b = await playGame(createGame({ seed: 7, brains: { crew: 'llm' }, llm: { ...options(gemini.fetch), cache } }))
    expect(gemini.calls()).toBe(first)
    expect(JSON.stringify(b.log)).toBe(JSON.stringify(a.log))
  })

  it('falls back to the Bayesian brain when the API fails', async () => {
    const failing = (async () => new Response('{"error":{"message":"down"}}', { status: 500 })) as unknown as typeof fetch
    const game = await playGame(createGame({ seed: 4, brains: { crew: 'llm' }, llm: options(failing) }))
    expect(game.winner).toBeTruthy()
  })
})
