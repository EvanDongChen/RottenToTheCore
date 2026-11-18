// Runs games with no 3D, as fast as the CPU allows.
//
//   npm run sim -- --games 5000 --crew bayesian --rotten heuristic --seed 1 --out results/
//   npm run sim -- --games 1000 --matrix
//   npm run sim -- --games 1 --seed 42 --log results/game42.jsonl   (full event log, for replays)
//
// Writes one JSON line per game plus a summary per matchup. `npm run report` turns the
// summaries into the tables in RESULTS.md.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BRAIN_KINDS } from '../sim/brains/types'
import type { BrainKind } from '../sim/brains/types'
import { createGame } from '../sim/engine'
import { playGame } from '../sim/game'
import { hashLog } from '../sim/log'
import { resultOf, summarize } from '../sim/metrics'
import type { GameResult, Summary } from '../sim/metrics'
import type { Rules } from '../sim/types'
import { llmFromEnv, llmUsage, saveLlmCache } from './llmSetup'

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const has = (name: string) => process.argv.includes(`--${name}`)
const num = (name: string, fallback: number) => {
  const v = Number(flag(name))
  return Number.isFinite(v) ? v : fallback
}
const brain = (name: string): BrainKind => {
  const v = flag(name) ?? 'heuristic'
  if (!BRAIN_KINDS.includes(v as BrainKind)) throw new Error(`--${name} must be one of ${BRAIN_KINDS.join(', ')}`)
  return v as BrainKind
}

const games = num('games', 200)
const firstSeed = num('seed', 1)
const out = flag('out') ?? 'results'
const logPath = flag('log')
// Rule overrides: --rules rotten=2,killCooldown=30
const rules: Partial<Rules> = {}
for (const pair of (flag('rules') ?? '').split(',').filter(Boolean)) {
  const [k, v] = pair.split('=')
  ;(rules as Record<string, unknown>)[k] = v === 'true' ? true : v === 'false' ? false : Number(v)
}

const matchups: [BrainKind, BrainKind][] = has('matrix')
  ? BRAIN_KINDS.filter((k) => k !== 'llm' || has('with-llm')).flatMap((c) => BRAIN_KINDS.filter((k) => k !== 'llm' || has('with-llm')).map((r) => [c, r] as [BrainKind, BrainKind]))
  : [[brain('crew'), brain('rotten')]]

const pct = (n: number) => `${(n * 100).toFixed(1)}%`

async function runMatchup(crew: BrainKind, rotten: BrainKind): Promise<Summary> {
  const wantsLlm = crew === 'llm' || rotten === 'llm'
  if (wantsLlm && !process.env.GEMINI_API_KEY) console.warn('  No GEMINI_API_KEY set: the LLM brain plays as the Bayesian brain.')
  const results: GameResult[] = []
  const started = performance.now()
  let combined = ''
  for (let i = 0; i < games; i++) {
    const seed = firstSeed + i
    const llm = wantsLlm ? llmFromEnv() : undefined
    const game = createGame({ seed, rules, brains: { crew, rotten }, llm })
    try {
      await playGame(game)
    } catch (err) {
      console.error(`seed ${seed} threw:`, err)
      process.exitCode = 1
      throw err
    }
    results.push(resultOf(game, crew, rotten, llm ? llmUsage(game) : undefined))
    if (llm) saveLlmCache()
    combined += hashLog(game.log)
    if (logPath && i === 0) writeFileSync(logPath, game.log.map((e) => JSON.stringify(e)).join('\n') + '\n')
    if (!has('quiet') && games >= 50 && (i + 1) % Math.ceil(games / 10) === 0) process.stdout.write(`  ${crew} vs ${rotten}: ${i + 1}/${games}\r`)
  }
  const ms = performance.now() - started
  const summary = summarize(results)
  mkdirSync(out, { recursive: true })
  const name = `${crew}-vs-${rotten}`
  writeFileSync(join(out, `${name}.jsonl`), results.map((r) => JSON.stringify(r)).join('\n') + '\n')
  writeFileSync(join(out, `${name}.summary.json`), JSON.stringify({ ...summary, rules, firstSeed, ms: Math.round(ms) }, null, 2))
  const s = summary
  console.log(
    `${name.padEnd(24)} ${String(games).padStart(5)} games  crew ${pct(s.crewWinRate).padStart(6)}  rotten ${pct(s.rottenWinRate).padStart(6)}  draw ${pct(s.drawRate).padStart(5)}` +
      `  | ${s.avgLength.toFixed(1)} min, ${s.meetingsPerGame.toFixed(1)} meetings, eject accuracy ${pct(s.ejectionAccuracy)}  | ${(ms / 1000).toFixed(1)} s, hash ${hashLog([{ t: 0, kind: 'found', who: combined, body: '' }])}`,
  )
  return summary
}

console.log(`Seeds ${firstSeed}..${firstSeed + games - 1}${Object.keys(rules).length ? `, rules ${JSON.stringify(rules)}` : ''}`)
for (const [crew, rotten] of matchups) await runMatchup(crew, rotten)
