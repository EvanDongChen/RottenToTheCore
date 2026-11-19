import { useLayoutEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, IcosahedronGeometry, Object3D } from 'three'
import type { InstancedMesh } from 'three'

const COUNT = 220 // drops alive at once; the oldest is reused when more are needed
const LIFE = 1.1 // seconds a drop lasts
const GRAVITY = 14
const SHAPE = new IcosahedronGeometry(1, 1)

interface Drop {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  size: number
  age: number
  color: Color
  /** Lying on the floor already. */
  landed: boolean
}

const drops: Drop[] = Array.from({ length: COUNT }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0, age: LIFE, color: new Color(), landed: false }))
let next = 0
/** Set when a burst adds drops, so the colours are re-sent to the GPU. */
let colorsDirty = false

/**
 * A spray of juice: drops thrown up and out from a point at height `y`, which fall, splash on
 * the floor and fade. Used for a kill and for the Juicer. Anything in the scene can call it.
 */
export function spray(x: number, z: number, color: string, amount = 1, y = 1) {
  const count = Math.round(14 + amount * 22)
  for (let i = 0; i < count; i++) {
    const d = drops[next]
    next = (next + 1) % COUNT
    const angle = Math.random() * Math.PI * 2
    const out = (1.2 + Math.random() * 3.2) * (0.7 + amount * 0.4)
    d.x = x
    d.y = y
    d.z = z
    d.vx = Math.cos(angle) * out
    d.vz = Math.sin(angle) * out
    d.vy = 2.5 + Math.random() * 4.5 * amount
    d.size = 0.05 + Math.random() * 0.08
    d.age = 0
    d.landed = false
    d.color.set(color).offsetHSL(0, 0, (Math.random() - 0.5) * 0.12)
  }
  colorsDirty = true
}

/** Draws every drop of juice in the scene as one instanced mesh. */
export default function Spray() {
  const mesh = useRef<InstancedMesh>(null)
  const dummy = useRef(new Object3D())

  useLayoutEffect(() => {
    drops.forEach((d, i) => mesh.current?.setColorAt(i, d.color))
  }, [])

  useFrame((_, delta) => {
    const m = mesh.current
    if (!m) return
    const dt = Math.min(delta, 1 / 20)
    drops.forEach((d, i) => {
      const o = dummy.current
      if (d.age >= LIFE) {
        o.scale.setScalar(0)
      } else {
        d.age += dt
        if (!d.landed) {
          d.vy -= GRAVITY * dt
          d.x += d.vx * dt
          d.y += d.vy * dt
          d.z += d.vz * dt
          // Hitting the floor: a flat little splash that stays put.
          if (d.y <= 0.03) {
            d.y = 0.03
            d.landed = true
          }
        }
        const fade = 1 - Math.max(0, (d.age - LIFE * 0.6) / (LIFE * 0.4))
        o.position.set(d.x, d.y, d.z)
        if (d.landed) o.scale.set(d.size * 1.8 * fade, 0.01, d.size * 1.8 * fade)
        else o.scale.setScalar(d.size * fade)
      }
      o.updateMatrix()
      m.setMatrixAt(i, o.matrix)
      if (colorsDirty) m.setColorAt(i, d.color)
    })
    m.instanceMatrix.needsUpdate = true
    if (colorsDirty && m.instanceColor) m.instanceColor.needsUpdate = true
    colorsDirty = false
  })

  return (
    <instancedMesh ref={mesh} args={[SHAPE, undefined, COUNT]} frustumCulled={false}>
      <meshStandardMaterial roughness={0.2} metalness={0} />
    </instancedMesh>
  )
}
