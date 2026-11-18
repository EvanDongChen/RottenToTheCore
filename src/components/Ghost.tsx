import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { MathUtils, Vector3 } from 'three'
import type { Group, Material, Mesh } from 'three'
import { currentGame, ghostPositions, simTargets, useSim } from '../ui/store'
import Emote from './Emote'
import { ROLE_TAG } from './fruitLooks'
import { anchors, EYE_SPREAD, FruitBody, LIMB_COLOR } from './fruitShapes'

const FLOAT_HEIGHT = 2.3
const WAIT = 1.4 // seconds the body lies there before its ghost rises
/** In a meeting, ghosts drift round the edge of the Cafeteria, watching. */
const MEETING_RING = 7

/**
 * The see-through ghost of a dead fruit. It rises from the body and floats over wherever the sim
 * has it: a crew ghost keeps doing its tasks (if the rules allow), and the living cannot see it.
 * In a meeting it hangs about the edge of the room and reacts with everyone else.
 */
export default function Ghost({ id }: { id: string }) {
  const fruit = useSim((s) => s.fruits.find((f) => f.id === id))
  const reaction = useSim((s) => s.reactions[id])
  const group = useRef<Group>(null)
  const mouths = useRef<(Mesh | null)[]>([])
  const born = useRef(performance.now())
  const at = useRef<Vector3 | null>(null)
  const phase = useRef(Math.random() * Math.PI * 2)
  const kind = fruit?.kind ?? 'apple'
  const face = useMemo(() => anchors(kind), [kind])

  // Let the living know where this ghost is, so they could turn to it.
  useEffect(() => {
    ghostPositions.set(id, new Vector3())
    return () => {
      ghostPositions.delete(id)
    }
  }, [id])

  // Make every part of the body see-through.
  useLayoutEffect(() => {
    group.current?.traverse((object) => {
      const mesh = object as Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = false
      const material = mesh.material as Material
      material.transparent = true
      material.opacity = 0.42
      material.depthWrite = false
    })
  }, [kind])

  useFrame((_, delta) => {
    const g = group.current
    if (!g || !fruit) return
    const age = (performance.now() - born.current) / 1000
    const target = simTargets.get(id)
    if (!at.current) at.current = new Vector3(target?.x ?? 0, 0.8, target?.z ?? 0)
    const pos = at.current
    const rise = MathUtils.clamp((age - WAIT) / 1.2, 0, 1)
    if (age > WAIT) {
      let tx = target?.x ?? pos.x
      let tz = target?.z ?? pos.z
      if (currentGame().phase === 'meeting') {
        const angle = phase.current + age * 0.05
        tx = Math.cos(angle) * MEETING_RING
        tz = Math.sin(angle) * MEETING_RING * 0.7
      }
      pos.x = MathUtils.damp(pos.x, tx, 1.6, delta)
      pos.z = MathUtils.damp(pos.z, tz, 1.6, delta)
      pos.y = MathUtils.damp(pos.y, FLOAT_HEIGHT, 1.5, delta)
    }
    // Bob gently; bounce when pleased, sink when dismayed, shudder at a shock.
    let lift = Math.sin(age * 1.6 + phase.current) * 0.16
    if (reaction === 'cheer') lift += Math.abs(Math.sin(age * 8)) * 0.4
    if (reaction === 'sulk') lift -= 0.35
    const shudder = reaction === 'gasp' || reaction === 'shake' ? Math.sin(age * 50) * 0.04 : 0
    g.position.set(pos.x + shudder, pos.y + lift, pos.z)
    g.rotation.set(reaction === 'sulk' ? 0.35 : 0, Math.atan2(-pos.x, -pos.z), Math.sin(age * 1.1 + phase.current) * 0.1)
    g.scale.setScalar(rise)
    ghostPositions.get(id)?.copy(g.position)

    const shape = reaction === 'cheer' ? 1 : reaction === 'sulk' ? 2 : reaction === 'gasp' ? 3 : 0
    mouths.current.forEach((mesh, i) => {
      if (mesh) mesh.visible = i === shape
    })
  })

  if (!fruit) return null
  return (
    <group ref={group} rotation-order="YXZ" scale={0}>
      <FruitBody kind={kind} />
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * EYE_SPREAD, face.y + 0.08, face.eyeZ * 0.985]}>
          <sphereGeometry args={[0.035, 12, 12]} />
          <meshBasicMaterial color={LIMB_COLOR} />
        </mesh>
      ))}
      {/* Mouths: a ghostly "o", a grin, a frown, a gape. */}
      <group position={[0, face.y - 0.06, face.mouthZ + 0.008]}>
        {[
          <ringGeometry args={[0.028, 0.05, 20]} />,
          <circleGeometry args={[0.08, 20, Math.PI, Math.PI]} />,
          <ringGeometry args={[0.05, 0.072, 20, 1, 0, Math.PI]} />,
          <circleGeometry args={[0.055, 20]} />,
        ].map((geometry, i) => (
          <mesh key={i} ref={(m) => void (mouths.current[i] = m)} visible={i === 0} position={[0, i === 1 ? 0.03 : i === 2 ? -0.045 : 0, 0]}>
            {geometry}
            <meshBasicMaterial color={LIMB_COLOR} />
          </mesh>
        ))}
      </group>
      <Html center position={[0, 1.15, 0]} zIndexRange={[10, 0]}>
        <div className="fruit-tag ghost">
          <div className="name">
            {fruit.name}
            <span className={`role ${fruit.role}`}>{ROLE_TAG[fruit.role]}</span>
            {reaction && reaction !== 'shake' && <Emote reaction={reaction} />}
          </div>
        </div>
      </Html>
    </group>
  )
}
