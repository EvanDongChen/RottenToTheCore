import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Mesh } from 'three'
import { fruitPositions, ghostPositions, useSim } from '../ui/store'

/** A pulsing ring on the floor under the fruit the camera is following. */
export default function FollowRing() {
  const ring = useRef<Mesh>(null)
  useFrame(() => {
    const m = ring.current
    if (!m) return
    const id = useSim.getState().follow
    const at = id ? (fruitPositions.get(id) ?? ghostPositions.get(id)) : undefined
    m.visible = !!at
    if (!at) return
    m.position.set(at.x, 0.035, at.z)
    m.scale.setScalar(1 + Math.sin(performance.now() * 0.005) * 0.07)
    m.rotation.z += 0.01
  })
  return (
    <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} visible={false} renderOrder={2}>
      <ringGeometry args={[0.95, 1.2, 40, 1, 0, Math.PI * 1.7]} />
      <meshBasicMaterial color="#ffb000" transparent opacity={0.85} depthWrite={false} />
    </mesh>
  )
}
