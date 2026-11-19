import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector3 } from 'three'
import type { Group } from 'three'
import { TABLE } from '../sim/map'
import { currentGame, fruitPositions, useSim } from '../ui/store'
import { LOOKS } from './fruitLooks'

/** Real milliseconds (at 1x) a ballot is in the air. */
export const BALLOT_FLIGHT_MS = 750
/** How high the arc rises above the higher of its two ends. */
const ARC = 1.6
/** Skip votes land in a pile on the table, off to one side of the button. */
const PILE = new Vector3(TABLE.at[0] - 1.05, 0.83, TABLE.at[1] + 0.55)
/** Where over a fruit a ballot lands: about where its name tag hangs. */
const OVER_HEAD = 2.1
const SCATTER = new Vector3()
const MOST = 12

/**
 * Votes as paper: each ballot, striped in the voter's colour, is flung from the voter in an arc
 * to the fruit it picked, where it vanishes into that fruit's tally, or onto the skip pile in
 * the middle of the table, where it stays until the meeting is over.
 */
export default function Ballots() {
  const slots = useRef<(Group | null)[]>([])
  const from = useRef(new Map<string, Vector3>())
  const to = new Vector3()
  const start = new Vector3()

  useFrame(() => {
    const { ballots, speed } = useSim.getState()
    const now = performance.now()
    const flight = BALLOT_FLIGHT_MS / Math.sqrt(speed)
    const game = currentGame()
    let skips = 0
    slots.current.forEach((g, i) => {
      if (!g) return
      const b = ballots[i]
      if (!b) {
        g.visible = false
        return
      }
      const key = `${b.voter}@${b.at}`
      // Where it was thrown from is fixed when it's thrown, so it doesn't swing about with the voter.
      if (!from.current.has(key)) from.current.set(key, (fruitPositions.get(b.voter) ?? PILE).clone().setY(1.5))
      start.copy(from.current.get(key)!)
      const skip = b.target === 'skip'
      if (skip) {
        // A messy heap: each one lands a little off from the last.
        const k = skips++
        to.copy(PILE).add(SCATTER.set(Math.sin(k * 2.3) * 0.22, k * 0.03, Math.cos(k * 1.7) * 0.18))
      }
      else to.copy(fruitPositions.get(b.target) ?? PILE).setY(OVER_HEAD)
      const p = Math.min(1, (now - b.at) / flight)
      // Landed on a fruit: gone into its tally.
      g.visible = skip || p < 1
      if (!g.visible) return
      g.position.lerpVectors(start, to, p)
      g.position.y += Math.sin(p * Math.PI) * ARC
      // Tumbling through the air, then lying flat on the pile.
      if (p < 1) g.rotation.set(p * 9, p * 5, p * 3)
      else g.rotation.set(0, (i * 1.3) % Math.PI, 0)
      g.scale.setScalar(p < 0.15 ? p / 0.15 : 1)
      const stripe = g.children[1] as unknown as { material: { color: { set(c: string): void } } }
      const kind = game.fruits.find((f) => f.id === b.voter)?.def.kind
      if (kind) stripe.material.color.set(LOOKS[kind].color)
    })
    // Forget throws from earlier meetings.
    if (!ballots.length && from.current.size) from.current.clear()
  })

  return (
    <>
      {Array.from({ length: MOST }, (_, i) => (
        <group key={i} ref={(g) => void (slots.current[i] = g)} visible={false}>
          <mesh castShadow>
            <boxGeometry args={[0.6, 0.025, 0.42]} />
            <meshStandardMaterial color="#fffdf5" />
          </mesh>
          <mesh position={[0, 0.015, -0.11]}>
            <boxGeometry args={[0.52, 0.006, 0.09]} />
            <meshStandardMaterial color="#888888" />
          </mesh>
          <mesh position={[0.1, 0.015, 0.08]} rotation={[0, 0.6, 0]}>
            <boxGeometry args={[0.2, 0.006, 0.045]} />
            <meshStandardMaterial color="#2a1a12" />
          </mesh>
        </group>
      ))}
    </>
  )
}
