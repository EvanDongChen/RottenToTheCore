import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { DoubleSide } from 'three'
import type { Group, Mesh, MeshStandardMaterial } from 'three'
import { currentGame, useSim } from '../ui/store'

/** The jar: from just above the motor base to its lid. */
const JAR_BOTTOM = 1.32
const JAR_HEIGHT = 1.7
const JAR_RADIUS = 0.66
/** How long the jar takes to drain into the glass once the blending stops, in real ms. */
const DRAIN_MS = 900
/** The everyday batch of orange juice a crew fruit blends at the station. */
const BATCH = '#ffb03a'

/**
 * The Juicer's big blender. An ejected fruit lands in the jar and whirls round as the blades wind
 * up and the jar fills with its juice, which then drains into the glass beside it. A crew fruit
 * doing the "Juice a batch" task runs it gently with a little orange juice in.
 */
export default function Blender() {
  const jar = useRef<Group>(null)
  const blades = useRef<Group>(null)
  const juice = useRef<Mesh>(null)
  const dial = useRef<Mesh>(null)

  useFrame((_, delta) => {
    const now = performance.now()
    const b = useSim.getState().blending
    const working = currentGame().fruits.some((f) => f.working === 'juice' && f.role === 'crew' && !f.path.length)
    const age = b ? now - b.at : Infinity
    const running = !!b && age < b.ms
    const draining = !!b && age >= b.ms && age < b.ms + DRAIN_MS
    const q = b ? Math.min(1, age / b.ms) : 0

    // The blades: a scream while blending, a gentle whirr for a batch.
    if (blades.current) blades.current.rotation.y += delta * (running ? 12 + q * 50 : working ? 9 : 0)
    // The whole jar rattles on its base as it winds up.
    if (jar.current) {
      const shake = running ? 0.025 + q * 0.03 : working ? 0.008 : 0
      jar.current.position.set(Math.sin(now * 0.11) * shake, 0, Math.cos(now * 0.13) * shake)
    }
    if (dial.current) dial.current.rotation.z = running ? -2.4 : working ? -1.2 : 0

    // The juice: rises as the fruit wears away, drains into the glass afterwards.
    const level = running ? q ** 1.8 * 0.75 : draining ? 0.75 * (1 - (age - b!.ms) / DRAIN_MS) : working ? 0.22 + Math.sin(now * 0.004) * 0.03 : 0
    if (juice.current) {
      juice.current.visible = level > 0.01
      const h = Math.max(0.01, level * JAR_HEIGHT)
      juice.current.scale.set(1, h, 1)
      juice.current.position.y = JAR_BOTTOM + h / 2
      // A whirlpool wobble on the surface.
      juice.current.rotation.y += delta * (running ? 20 : 3)
      ;(juice.current.material as MeshStandardMaterial).color.set(b && (running || draining) ? b.color : BATCH)
    }
  })

  return (
    <>
      {/* The motor base, with its speed dial. */}
      <mesh castShadow receiveShadow position={[0, 0.65, 0]}>
        <boxGeometry args={[1.6, 1.3, 1.2]} />
        <meshStandardMaterial color="#e9edf2" />
      </mesh>
      <mesh position={[0, 0.7, 0.61]}>
        <circleGeometry args={[0.22, 20]} />
        <meshStandardMaterial color="#2b2f36" />
      </mesh>
      <mesh ref={dial} position={[0, 0.7, 0.62]}>
        <boxGeometry args={[0.05, 0.36, 0.02]} />
        <meshStandardMaterial color="#e2412f" />
      </mesh>
      <group ref={jar}>
        {/* The glass jar. */}
        <mesh position={[0, JAR_BOTTOM + JAR_HEIGHT / 2, 0]} renderOrder={3}>
          <cylinderGeometry args={[JAR_RADIUS + 0.08, JAR_RADIUS - 0.06, JAR_HEIGHT, 28, 1, true]} />
          <meshStandardMaterial color="#dff3ff" transparent opacity={0.28} side={DoubleSide} depthWrite={false} />
        </mesh>
        {/* A rim at the bottom, and the lid. */}
        <mesh position={[0, JAR_BOTTOM + 0.05, 0]}>
          <cylinderGeometry args={[JAR_RADIUS - 0.02, JAR_RADIUS + 0.02, 0.12, 24]} />
          <meshStandardMaterial color="#6b7480" />
        </mesh>
        <mesh castShadow position={[0, JAR_BOTTOM + JAR_HEIGHT + 0.06, 0]}>
          <cylinderGeometry args={[JAR_RADIUS + 0.12, JAR_RADIUS + 0.12, 0.12, 24]} />
          <meshStandardMaterial color="#3d4450" />
        </mesh>
        <mesh position={[0, JAR_BOTTOM + JAR_HEIGHT + 0.17, 0]}>
          <cylinderGeometry args={[0.14, 0.18, 0.12, 12]} />
          <meshStandardMaterial color="#3d4450" />
        </mesh>
        {/* The handle. */}
        <mesh position={[JAR_RADIUS + 0.2, JAR_BOTTOM + JAR_HEIGHT / 2, 0]}>
          <boxGeometry args={[0.1, 1.1, 0.14]} />
          <meshStandardMaterial color="#3d4450" />
        </mesh>
        {/* The blades. */}
        <group ref={blades} position={[0, JAR_BOTTOM + 0.16, 0]}>
          <mesh rotation={[0, 0, 0.25]}>
            <boxGeometry args={[0.9, 0.03, 0.12]} />
            <meshStandardMaterial color="#c9d1db" metalness={0.6} roughness={0.3} />
          </mesh>
          <mesh rotation={[0.25, Math.PI / 2, 0]}>
            <boxGeometry args={[0.9, 0.03, 0.12]} />
            <meshStandardMaterial color="#c9d1db" metalness={0.6} roughness={0.3} />
          </mesh>
        </group>
        <mesh ref={juice} visible={false}>
          <cylinderGeometry args={[JAR_RADIUS - 0.04, JAR_RADIUS - 0.06, 1, 24, 1]} />
          <meshStandardMaterial color={BATCH} transparent opacity={0.85} />
        </mesh>
      </group>
      {/* The spout, over the glass. */}
      <mesh position={[-0.85, 1.05, 0]}>
        <boxGeometry args={[0.25, 0.08, 0.4]} />
        <meshStandardMaterial color="#9aa4b2" />
      </mesh>
      <JuiceGlass />
    </>
  )
}

/** The Juicer's big glass beside the blender: it fills a little more with every fruit that goes in. */
function JuiceGlass() {
  const count = useSim((s) => s.juice)
  const level = Math.min(1, 0.15 + count * 0.22)
  return (
    <group position={[1.3, 0, 0]}>
      <mesh position={[0, 0.4, 0]}>
        <cylinderGeometry args={[0.24, 0.2, 0.8, 16, 1, true]} />
        <meshStandardMaterial color="#ffffff" transparent opacity={0.35} side={DoubleSide} />
      </mesh>
      <mesh position={[0, (0.78 * level) / 2 + 0.01, 0]}>
        <cylinderGeometry args={[0.21, 0.19, 0.78 * level, 16]} />
        <meshStandardMaterial color={BATCH} />
      </mesh>
    </group>
  )
}
