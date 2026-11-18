// Fits the Bayesian brain's likelihood table from headless games, and checks how well calibrated
// its beliefs are.
//
//   npm run calibrate -- --games 2000            measure, fit, compare, and report
//   npm run calibrate -- --games 2000 --write    also save the fitted table, if it scores better
//
// At every vote, each Bayesian crew fruit's P(Rotten) for every other living fruit is recorded
// next to the truth. That gives the Brier score (mean squared error of the probabilities, lower
// is better) and a reliability table: of all the times it said "about 30%", how often was it
// right? Fitting counts, for each kind of clue, how often it points at a Rotten against how
// often at crew: that ratio is the clue's likelihood ratio.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { LIKELIHOOD } from '../sim/brains/bayesian'
import { FITTED } from '../sim/brains/fitted'
import { deathWindow, indexMemory, knownBodies, provenRotten, reachable, storyBreaks, trustScores } from '../sim/brains/reasoning'
import type { Ballot, MeetingView } from '../sim/brains/types'
import { createGame } from '../sim/engine'
import { playGame } from '../sim/game'
import type { FruitView } from '../sim/view'

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const games = Number(flag('games') ?? 1000)
const firstSeed = Number(flag('seed') ?? 1)
const write = process.argv.includes('--write')
const svgPath = flag('svg') ?? 'docs/calibration.svg'
/**
 * Clues come in bunches (a fruit seen near a body often has no alibi either), and counting each
 * as if it were independent makes the brain overconfident. Fitted ratios are shrunk toward 1 by
 * this power to make up for it.
 */
const shrink = Number(flag('shrink') ?? 0.7)

/** The clues fitted, by their names in the likelihood table. */
const CLUES = ['kill', 'vented', 'nearBody', 'fakeTask', 'caught', 'storyBreak', 'tailed', 'accusedByTrusted', 'vouchedByTrusted', 'unreachable', 'noAlibi', 'defendedRotten'] as const
type Clue = (typeof CLUES)[number]

interface Sample {
  p: number
  rotten: boolean
  clues: Clue[]
}

/** Which clues this crew fruit holds about `who`, as yes or no. */
function cluesAbout(view: FruitView, who: string, breaks: ReturnType<typeof storyBreaks>, reach: Map<string, number>, defenders: Set<string>): Clue[] {
  const out: Clue[] = []
  const mem = view.memory.filter((m) => m.who === who)
  const has = (kind: string, min = 0.5) => mem.some((m) => m.kind === kind && m.now > min)
  if (has('kill')) out.push('kill')
  if (has('vented')) out.push('vented')
  if (has('nearBody')) out.push('nearBody')
  if (has('fakeTask')) out.push('fakeTask')
  if ((view.caught[who] ?? 0) >= 1) out.push('caught')
  if (breaks.has(who)) out.push('storyBreak')
  if (view.tailedBy.includes(who)) out.push('tailed')
  if (mem.some((m) => m.kind === 'heard' && m.told === 'accuse' && m.now > 0.3)) out.push('accusedByTrusted')
  if (mem.some((m) => m.kind === 'heard' && m.told === 'vouch' && m.now > 0.3)) out.push('vouchedByTrusted')
  const open = reach.get(who)
  if (open === 0) out.push('unreachable')
  else if (open === 1) out.push('noAlibi')
  if (defenders.has(who)) out.push('defendedRotten')
  return out
}

/** Play the games and record every crew fruit's beliefs at every vote. */
let crewWins = 0

async function measure(): Promise<Sample[]> {
  const samples: Sample[] = []
  crewWins = 0
  for (let i = 0; i < games; i++) {
    const game = createGame({ seed: firstSeed + i, brains: { crew: 'bayesian', rotten: 'heuristic' } })
    for (const f of game.fruits) {
      if (f.role !== 'crew') continue
      const brain = game.brains.get(f.id)!
      const vote = brain.vote.bind(brain)
      brain.vote = (view: FruitView, meeting: MeetingView): Promise<Ballot> => {
        const beliefs = brain.beliefs(view)
        const breaks = storyBreaks(view)
        const trust = trustScores(view, breaks)
        const index = indexMemory(view, trust)
        const body = knownBodies(view).at(-1)
        const reach = new Map<string, number>()
        if (body) for (const id of meeting.living) reach.set(id, reachable(id, body, index, deathWindow(view, body, trust)).open)
        const rotten = provenRotten(view)
        const defenders = new Set(view.public.filter((e) => e.kind === 'line' && e.target && rotten.has(e.target) && (e.move === 'vouch' || e.move === 'corroborate')).map((e) => (e.kind === 'line' ? e.who : '')))
        for (const id of meeting.living) {
          if (id === view.id || !(id in beliefs)) continue
          samples.push({ p: beliefs[id], rotten: game.fruits.find((x) => x.id === id)!.role === 'rotten', clues: cluesAbout(view, id, breaks, reach, defenders) })
        }
        return vote(view, meeting)
      }
    }
    await playGame(game)
    if (game.winner === 'crew') crewWins++
    if ((i + 1) % Math.ceil(games / 10) === 0) process.stdout.write(`  ${i + 1}/${games}\r`)
  }
  return samples
}

function brier(samples: Sample[]): number {
  return samples.reduce((a, s) => a + (s.p - (s.rotten ? 1 : 0)) ** 2, 0) / Math.max(1, samples.length)
}

/** What the Brier score would be if it always said the base rate: the score to beat. */
function baseline(samples: Sample[]): number {
  const rate = samples.filter((s) => s.rotten).length / Math.max(1, samples.length)
  return samples.reduce((a, s) => a + (rate - (s.rotten ? 1 : 0)) ** 2, 0) / Math.max(1, samples.length)
}

/** Predictions in ten bins: how sure it said it was, against how often it was right. */
function reliability(samples: Sample[]) {
  const bins = Array.from({ length: 10 }, (_, i) => ({ lo: i / 10, hi: (i + 1) / 10, n: 0, said: 0, true: 0 }))
  for (const s of samples) {
    const b = bins[Math.min(9, Math.floor(s.p * 10))]
    b.n++
    b.said += s.p
    if (s.rotten) b.true++
  }
  return bins.map((b) => ({ ...b, said: b.n ? b.said / b.n : 0, true: b.n ? b.true / b.n : 0 }))
}

/** Each clue's likelihood ratio: P(clue | Rotten) / P(clue | crew), smoothed so rare clues don't run wild. */
function fit(samples: Sample[]): Partial<Record<Clue, number>> {
  const rotten = samples.filter((s) => s.rotten)
  const crew = samples.filter((s) => !s.rotten)
  const out: Partial<Record<Clue, number>> = {}
  for (const c of CLUES) {
    const r = rotten.filter((s) => s.clues.includes(c)).length
    const k = crew.filter((s) => s.clues.includes(c)).length
    // Too rare to say anything about: keep the hand-picked value.
    if (r + k < 30) continue
    const lr = Math.pow(((r + 1) / (rotten.length + 2)) / ((k + 1) / (crew.length + 2)), shrink)
    out[c] = Math.round(Math.max(0.05, Math.min(100, lr)) * 100) / 100
  }
  return out
}

function chart(before: ReturnType<typeof reliability>, after: ReturnType<typeof reliability> | null): string {
  const W = 420
  const P = 48
  const S = W - P * 1.5
  const x = (v: number) => P + v * S
  const y = (v: number) => W - P - v * S
  const most = Math.max(...before.map((b) => b.n), 1)
  const dots = (bins: ReturnType<typeof reliability>, color: string) =>
    bins
      .filter((b) => b.n > 0)
      .map((b) => `<circle cx="${x(b.said).toFixed(1)}" cy="${y(b.true).toFixed(1)}" r="${(3 + 9 * Math.sqrt(b.n / most)).toFixed(1)}" fill="${color}" fill-opacity="0.75" stroke="#2a1a12" stroke-width="1.5"/>`)
      .join('\n  ')
  const line = (bins: ReturnType<typeof reliability>, color: string) =>
    `<polyline fill="none" stroke="${color}" stroke-width="2" points="${bins
      .filter((b) => b.n > 0)
      .map((b) => `${x(b.said).toFixed(1)},${y(b.true).toFixed(1)}`)
      .join(' ')}"/>`
  const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1]
    .map((v) => `<text x="${x(v)}" y="${W - P + 18}" text-anchor="middle">${v * 100}%</text><text x="${P - 8}" y="${y(v) + 4}" text-anchor="end">${v * 100}%</text>`)
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${W}" font-family="sans-serif" font-size="11" fill="#2a1a12">
  <title>How well calibrated the Bayesian brain is</title>
  <rect width="${W}" height="${W}" fill="#fffdf5"/>
  <line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" stroke="#9aa4b2" stroke-dasharray="5 4"/>
  <rect x="${x(0)}" y="${y(1)}" width="${S}" height="${S}" fill="none" stroke="#2a1a12"/>
  ${ticks}
  <text x="${x(0.5)}" y="${W - 8}" text-anchor="middle" font-weight="bold">What it said: P(Rotten)</text>
  <text transform="translate(12 ${y(0.5)}) rotate(-90)" text-anchor="middle" font-weight="bold">How often it was Rotten</text>
  ${line(before, '#d8342c')}
  ${dots(before, '#d8342c')}
  ${after ? line(after, '#3d8fd6') : ''}
  ${after ? dots(after, '#3d8fd6') : ''}
  <text x="${x(0.03)}" y="${y(0.95)}" font-weight="bold" fill="#d8342c">${after ? 'hand-picked' : 'Bayesian brain'}</text>
  ${after ? `<text x="${x(0.03)}" y="${y(0.95) + 15}" font-weight="bold" fill="#3d8fd6">fitted</text>` : ''}
  <text x="${x(0.6)}" y="${y(0.1)}" fill="#6b7480">dashed line: perfectly calibrated</text>
</svg>
`
}

function report(name: string, samples: Sample[]) {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`
  console.log(`\n${name}: crew won ${pct(crewWins / games)}. ${samples.length} predictions, Brier ${brier(samples).toFixed(4)} (always saying the base rate: ${baseline(samples).toFixed(4)})`)
  console.log('  said        n      was Rotten')
  for (const b of reliability(samples)) if (b.n) console.log(`  ${pct(b.said).padStart(6)}  ${String(b.n).padStart(6)}    ${pct(b.true).padStart(6)}`)
}

console.log(`Fitted ratios are shrunk toward 1 by the power ${shrink}.`)
console.log(`Calibrating on seeds ${firstSeed}..${firstSeed + games - 1} (Bayesian crew vs heuristic Rotten)`)
const before = await measure()
report('As it stands', before)
const fitted = fit(before)
console.log('\nFitted likelihood ratios (hand-picked in brackets):')
for (const c of CLUES) console.log(`  ${c.padEnd(18)} ${fitted[c] !== undefined ? String(fitted[c]).padStart(6) : '     -'}  (${LIKELIHOOD[c]})`)

// Play the same games again with the fitted table and compare.
const kept = { ...LIKELIHOOD }
Object.assign(LIKELIHOOD, fitted)
const after = await measure()
report('With the fitted table', after)
const better = brier(after) < brier(before)
console.log(`\nThe fitted table ${better ? 'scores better' : 'does not score better'}: Brier ${brier(before).toFixed(4)} -> ${brier(after).toFixed(4)}.`)
mkdirSync(dirname(svgPath), { recursive: true })
writeFileSync(svgPath, chart(reliability(before), reliability(after)))
console.log(`Chart written to ${svgPath}.`)
if (write && better) {
  const merged = { ...FITTED, ...fitted }
  writeFileSync(
    'src/sim/brains/fitted.ts',
    `// Written by \`npm run calibrate -- --write\` from ${games} games. Overrides the hand-picked\n// likelihood ratios in bayesian.ts. Delete an entry to go back to the hand-picked value.\nexport const FITTED: Record<string, number> = ${JSON.stringify(merged, null, 2)}\n`,
  )
  console.log('Saved to src/sim/brains/fitted.ts.')
} else if (write) {
  Object.assign(LIKELIHOOD, kept)
  console.log('Not saved: the hand-picked table is as good or better.')
}
