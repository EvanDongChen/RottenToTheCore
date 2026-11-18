import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group, Mesh, MeshBasicMaterial } from 'three'
import { currentGame } from '../ui/store'
import { LOOKS } from './fruitLooks'

/** Bodies with flies at once (any more just go without). */
const MOST = 4
const FLIES = 3
/** Sim seconds after a death before the first fly turns up, and between the next ones. */
const FIRST_FLY = 3
const NEXT_FLY = 4
/** The pool spreads out to this size over this many sim seconds. */
const POOL_SIZE = 1.5
const POOL_SECONDS = 25

/**
 * A body left lying about: a pool of juice spreads slowly out from under it, and flies turn up
 * one by one and buzz round it, until somebody reports it and the meeting clears it away.
 */
export default function BodyFlies() {
  const spots = useRef<(Group | null)[]>([])
  const pools = useRef<(Mesh | null)[]>([])
  const flies = useRef<(Group | null)[]>([])

  useFrame(() => {
    const game = currentGame()
    const now = performance.now() / 1000
    spots.current.forEach((g, i) => {
      if (!g) return
      const body = game.bodies[i]
      g.visible = !!body
      if (!body) return
      const age = game.time - body.time
      g.position.set(body.pos[0], 0, body.pos[1])
      const pool = pools.current[i]
      if (pool) {
        const grow = Math.min(1, age / POOL_SECONDS)
        pool.scale.setScalar(0.3 + (POOL_SIZE - 0.3) * Math.sqrt(grow))
        const kind = game.fruits.find((f) => f.id === body.id)?.def.kind
        if (kind) (pool.material as MeshBasicMaterial).color.set(LOOKS[kind].color)
      }
      for (let k = 0; k < FLIES; k++) {
        const fly = flies.current[i * FLIES + k]
        if (!fly) continue
        fly.visible = age > FIRST_FLY + k * NEXT_FLY
        if (!fly.visible) continue
        // A lazy figure-of-eight round the body, with a jittery buzz on top.
        const t = now * (1.6 + k * 0.37) + k * 2.1
        const r = 0.55 + k * 0.18
        fly.position.set(
          Math.sin(t) * r + Math.sin(now * 23 + k) * 0.03,
          0.95 + Math.sin(t * 2) * 0.25 + k * 0.18 + Math.sin(now * 31 + k) * 0.03,
          Math.sin(t) * Math.cos(t) * r * 1.3,
        )
        fly.rotation.y = t + Math.PI / 2
        // Wings: a fast flicker.
        const wings = fly.children[1]
        if (wings) wings.scale.y = 0.4 + Math.abs(Math.sin(now * 90 + k)) * 0.6
      }
    })
  })

  return (
    <>
      {Array.from({ length: MOST }, (_, i) => (
        <group key={i} ref={(g) => void (spots.current[i] = g)} visible={false}>
          <mesh ref={(m) => void (pools.current[i] = m)} rotation={[-Math.PI / 2, 0, i]} position={[0.1, 0.014, 0.05]} scale={[1, 0.8, 1]}>
            <circleGeometry args={[0.6, 24]} />
            <meshBasicMaterial transparent opacity={0.45} depthWrite={false} />
          </mesh>
          {Array.from({ length: FLIES }, (_, k) => (
            <group key={k} ref={(g) => void (flies.current[i * FLIES + k] = g)} visible={false}>
              <mesh>
                <sphereGeometry args={[0.075, 8, 6]} />
                <meshBasicMaterial color="#1c1c22" />
              </mesh>
              <mesh position={[0, 0.07, 0]}>
                <boxGeometry args={[0.24, 0.08, 0.02]} />
                <meshBasicMaterial color="#e6f2ff" transparent opacity={0.7} />
              </mesh>
            </group>
          ))}
        </group>
      ))}
    </>
  )
}
