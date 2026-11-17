import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { IcosahedronGeometry, Object3D } from 'three'
import type { InstancedMesh } from 'three'

const COUNT = 140 // dust motes alive at once; the oldest is reused when more are needed
const LIFE = 0.6 // seconds a mote lasts
const SHAPE = new IcosahedronGeometry(1, 2)

interface Mote {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  size: number
  /** Seconds since it was kicked up; at LIFE or more it is gone. */
  age: number
}

const motes: Mote[] = Array.from({ length: COUNT }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0, age: LIFE }))
let next = 0

/**
 * Kick up a little cloud of dust at a spot on the ground. `size` is about 1 for a landing,
 * less for a footstep. Anything in the scene can call this; the Dust component draws it.
 */
export function puff(x: number, z: number, size = 1) {
  const count = Math.max(2, Math.round(2 + size * 3))
  for (let i = 0; i < count; i++) {
    const mote = motes[next]
    next = (next + 1) % COUNT
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.6
    const speed = (0.6 + Math.random() * 0.9) * (0.6 + size * 0.6)
    mote.x = x + Math.cos(angle) * 0.18
    mote.y = 0.08
    mote.z = z + Math.sin(angle) * 0.18
    mote.vx = Math.cos(angle) * speed
    mote.vy = 0.35 + Math.random() * 0.5
    mote.vz = Math.sin(angle) * speed
    mote.size = (0.1 + Math.random() * 0.07) * (0.7 + size * 0.5)
    mote.age = 0
  }
}

/** Draws every mote of dust in the scene as one instanced mesh. */
export default function Dust() {
  const mesh = useRef<InstancedMesh>(null)
  const dummy = useRef(new Object3D())

  useFrame((_, delta) => {
    if (!mesh.current) return
    const dt = Math.min(delta, 1 / 20)
    motes.forEach((mote, i) => {
      const d = dummy.current
      if (mote.age >= LIFE) {
        d.scale.setScalar(0)
      } else {
        mote.age += dt
        // Shoots out, slows down and drifts up, swelling and then shrinking away.
        mote.vx *= 1 - 4 * dt
        mote.vz *= 1 - 4 * dt
        mote.vy *= 1 - 2 * dt
        mote.x += mote.vx * dt
        mote.y += mote.vy * dt
        mote.z += mote.vz * dt
        const t = mote.age / LIFE
        d.position.set(mote.x, mote.y, mote.z)
        d.scale.setScalar(mote.size * (0.6 + t * 1.4) * (1 - t * t))
      }
      d.updateMatrix()
      mesh.current!.setMatrixAt(i, d.matrix)
    })
    mesh.current.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[SHAPE, undefined, COUNT]} frustumCulled={false}>
      {/* Soft, pale and unlit, so the puffs read as dust rather than pebbles, by day or night. */}
      <meshBasicMaterial color="#f4efe6" transparent opacity={0.8} depthWrite={false} />
    </instancedMesh>
  )
}
