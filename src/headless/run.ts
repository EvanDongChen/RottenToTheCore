// Runs games with no 3D: `npm run sim -- --games 200 --seed 1 --seconds 120`.
// Milestone 1: games are only fruits walking, so this checks the sim runs headless and stays
// deterministic. Win rates and results files arrive with the core loop in milestone 3.
import { createGame, runFor } from '../sim/engine'
import { hashLog } from '../sim/log'

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`)
  const value = i >= 0 ? Number(process.argv[i + 1]) : NaN
  return Number.isFinite(value) ? value : fallback
}

const games = arg('games', 100)
const firstSeed = arg('seed', 1)
const seconds = arg('seconds', 120)

const started = performance.now()
let ticks = 0
let events = 0
let combined = ''
for (let i = 0; i < games; i++) {
  const game = createGame({ seed: firstSeed + i })
  runFor(game, seconds)
  ticks += game.tick
  events += game.log.length
  combined += hashLog(game.log)
}
const ms = performance.now() - started

console.log(`${games} games × ${seconds} sim s, seeds ${firstSeed}..${firstSeed + games - 1}`)
console.log(`${ticks.toLocaleString()} ticks, ${events.toLocaleString()} events in ${ms.toFixed(0)} ms (${Math.round(ticks / (ms / 1000)).toLocaleString()} ticks/s)`)
console.log(`run hash ${hashLog([{ t: 0, kind: 'arrive', who: combined, at: [0, 0] }])}`)
