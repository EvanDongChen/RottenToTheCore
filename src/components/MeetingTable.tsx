import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group, Mesh, MeshBasicMaterial } from 'three'
import { seatPos } from '../sim/engine'
import { BUTTON, SEAT_RING, TABLE } from '../sim/map'
import { currentGame, fruitPositions, useSim } from '../ui/store'

const TABLE_HEIGHT = 0.75
/** Stools stand just behind each seat. */
const STOOL_RING = SEAT_RING + 0.85
const PRESS_MS = 500

/**
 * The round Cafeteria table with the big red emergency button in the middle, a stool behind each
 * seat, and a spotlight ring that follows whoever is speaking in a meeting.
 */
export default function MeetingTable() {
  const living = useSim((s) => s.fruits.filter((f) => f.alive).length)
  const button = useRef<Group>(null)
  const spot = useRef<Mesh>(null)

  useFrame(() => {
    const s = useSim.getState()
    // The button squashes down when pressed, then springs back.
    if (button.current) {
      const age = performance.now() - s.buttonAt
      const press = age >= 0 && age < PRESS_MS ? Math.sin((age / PRESS_MS) * Math.PI) : 0
      button.current.scale.y = 1 - press * 0.6
    }
    // The speaker stands in a pool of light.
    if (spot.current) {
      const at = s.speaker && currentGame().phase === 'meeting' ? fruitPositions.get(s.speaker) : undefined
      spot.current.visible = !!at
      if (at) {
        spot.current.position.set(at.x, 0.03, at.z)
        const pulse = 1 + Math.sin(performance.now() * 0.006) * 0.06
        spot.current.scale.setScalar(pulse)
        ;(spot.current.material as MeshBasicMaterial).opacity = 0.55
      }
    }
  })

  return (
    <>
      <group position={[TABLE.at[0], 0, TABLE.at[1]]}>
        <mesh castShadow receiveShadow position={[0, TABLE_HEIGHT, 0]}>
          <cylinderGeometry args={[TABLE.radius, TABLE.radius, 0.12, 40]} />
          <meshStandardMaterial color="#ffffff" roughness={0.6} />
        </mesh>
        <mesh castShadow position={[0, TABLE_HEIGHT / 2, 0]}>
          <cylinderGeometry args={[0.25, 0.4, TABLE_HEIGHT, 16]} />
          <meshStandardMaterial color="#d7dce3" />
        </mesh>
        <group position={[BUTTON[0] - TABLE.at[0], TABLE_HEIGHT + 0.06, BUTTON[1] - TABLE.at[1]]}>
          <mesh castShadow position={[0, 0.06, 0]}>
            <cylinderGeometry args={[0.45, 0.5, 0.12, 24]} />
            <meshStandardMaterial color="#2b2f36" />
          </mesh>
          <group ref={button} position={[0, 0.12, 0]}>
            <mesh castShadow position={[0, 0.06, 0]}>
              <sphereGeometry args={[0.32, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshStandardMaterial color="#e2412f" emissive="#e2412f" emissiveIntensity={0.25} />
            </mesh>
          </group>
        </group>
      </group>

      {Array.from({ length: living }, (_, i) => {
        const [sx, sz] = seatPos(i, living)
        const k = STOOL_RING / SEAT_RING
        return (
          <group key={`${i}/${living}`} position={[sx * k, 0, sz * k]}>
            <mesh castShadow receiveShadow position={[0, 0.36, 0]}>
              <cylinderGeometry args={[0.28, 0.28, 0.08, 18]} />
              <meshStandardMaterial color="#d9a066" />
            </mesh>
            <mesh castShadow position={[0, 0.17, 0]}>
              <cylinderGeometry args={[0.05, 0.1, 0.34, 8]} />
              <meshStandardMaterial color="#9aa4b2" />
            </mesh>
          </group>
        )
      })}

      <mesh ref={spot} rotation={[-Math.PI / 2, 0, 0]} visible={false} renderOrder={2}>
        <ringGeometry args={[0.75, 1.1, 40]} />
        <meshBasicMaterial color="#ffe27a" transparent opacity={0.55} depthWrite={false} />
      </mesh>
    </>
  )
}
