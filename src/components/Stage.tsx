import { useLayoutEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Grid, Html } from '@react-three/drei'
import { CuboidCollider, RigidBody } from '@react-three/rapier'
import { Color, DoubleSide, MathUtils, Object3D, Vector3 } from 'three'
import type { AmbientLight, DirectionalLight, InstancedMesh } from 'three'
import { ears } from '../ui/sfx'
import { useSim } from '../ui/store'
import { LOOKS } from './fruitLooks'
import LabMap from './LabMap'

const DAY = new Color('#ffffff')
const NIGHT = new Color('#1b1f2b')

/**
 * The whole setting, kept deliberately cheap: a blank backdrop, a grid floor, the room's
 * walls and two lights. The backdrop and lights dim when the lights are sabotaged.
 */
export default function Stage() {
  const splats = useSim((s) => s.splats)
  const bursts = useSim((s) => s.bursts)
  const scene = useThree((s) => s.scene)
  const sun = useRef<DirectionalLight>(null)
  const ambient = useRef<AmbientLight>(null)
  const night = useRef(0)
  const backdrop = useRef(new Color('#ffffff'))
  const cameraRight = useRef(new Vector3())

  useFrame(({ camera }, delta) => {
    // Voices are mixed by how close each speaker is to the camera.
    const right = cameraRight.current.setFromMatrixColumn(camera.matrixWorld, 0)
    ears.position = { x: camera.position.x, y: camera.position.y, z: camera.position.z }
    ears.right = { x: right.x, y: right.y, z: right.z }
    night.current = MathUtils.damp(night.current, useSim.getState().lightsOut ? 0.75 : 0, 2, delta)
    scene.background = backdrop.current.lerpColors(DAY, NIGHT, night.current)
    // During the winners' party the backdrop drifts through pastel colours.
    if (useSim.getState().party) backdrop.current.setHSL((performance.now() / 9000) % 1, 0.75, 0.92)
    if (sun.current) sun.current.intensity = MathUtils.lerp(1.6, 0.5, night.current)
    if (ambient.current) ambient.current.intensity = MathUtils.lerp(1.1, 0.45, night.current)
  })

  return (
    <>
      <ambientLight ref={ambient} intensity={1.1} />
      <directionalLight
        ref={sun}
        position={[10, 30, 8]}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-34}
        shadow-camera-right={34}
        shadow-camera-top={26}
        shadow-camera-bottom={-26}
        shadow-camera-far={80}
      />

      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[200, 0.5, 200]} position={[0, -0.5, 0]} />
        {/* Invisible floor that only shows the shadows cast onto it. */}
        <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[120, 120]} />
          <shadowMaterial transparent opacity={0.22} />
        </mesh>
      </RigidBody>
      <Grid
        position={[0, 0.005, 0]}
        infiniteGrid
        cellSize={1}
        sectionSize={5}
        cellThickness={0.6}
        sectionThickness={1.1}
        cellColor="#d3d8df"
        sectionColor="#9aa4b2"
        fadeDistance={70}
        fadeStrength={1.5}
      />

      <Confetti />

      {/* Juice where a fruit was chopped or shot: one big blot and a scatter of drops. */}
      {splats.map((splat, i) => (
        <group key={i} position={[splat.x, 0.012 + i * 0.0005, splat.z]} rotation={[-Math.PI / 2, 0, splat.seed]}>
          {[0, 1, 2, 3, 4, 5, 6].map((n) => {
            // Drop 0 is the blot; the rest are flung out around it at fixed pseudo-random spots.
            const angle = n * 2.4 + splat.seed
            const reach = n ? splat.size * (0.45 + ((n * 37 + splat.seed) % 5) * 0.09) : 0
            return (
              <mesh key={n} position={[Math.cos(angle) * reach, Math.sin(angle) * reach, 0]} scale={n ? [1, 0.75, 1] : [1.25, 1, 1]}>
                <circleGeometry args={[n ? splat.size * (0.07 + (n % 3) * 0.035) : splat.size * 0.42, 18]} />
                <meshBasicMaterial color={LOOKS[splat.kind].color} transparent opacity={0.6} />
              </mesh>
            )
          })}
        </group>
      ))}

      {/* Comic sound words. */}
      {bursts.map((b) => (
        <Html key={b.key} center position={b.at} zIndexRange={[40, 30]}>
          <div className="burst" style={{ '--tilt': `${((b.key * 53) % 24) - 12}deg` } as React.CSSProperties}>
            {b.text}
          </div>
        </Html>
      ))}

      <LabMap />
    </>
  )
}

const CONFETTI_COUNT = 160
const CONFETTI_COLORS = ['#e2412f', '#f6b62e', '#4c9a3b', '#3d8fd6', '#7a52b3', '#ff6fa3']
const CONFETTI_TOP = 9

/** Paper confetti falling over the lab while the winners dance. One instanced mesh. */
function Confetti() {
  const active = useSim((s) => !!s.party)
  const mesh = useRef<InstancedMesh>(null)
  const pieces = useRef(
    Array.from({ length: CONFETTI_COUNT }, () => {
      const angle = Math.random() * Math.PI * 2
      const radius = Math.sqrt(Math.random()) * 12
      return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, speed: 1.2 + Math.random() * 1.6, offset: Math.random() * CONFETTI_TOP, spin: 2 + Math.random() * 5 }
    }),
  )
  const dummy = useRef(new Object3D())

  useLayoutEffect(() => {
    if (!mesh.current) return
    const color = new Color()
    pieces.current.forEach((_, i) => mesh.current!.setColorAt(i, color.set(CONFETTI_COLORS[i % CONFETTI_COLORS.length])))
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true
  }, [active])

  useFrame(({ clock }) => {
    if (!mesh.current) return
    const t = clock.elapsedTime
    pieces.current.forEach((piece, i) => {
      const fall = (t * piece.speed + piece.offset) % CONFETTI_TOP
      dummy.current.position.set(piece.x + Math.sin(t + i) * 0.3, CONFETTI_TOP - fall, piece.z)
      dummy.current.rotation.set(t * piece.spin, t * piece.spin * 0.7, i)
      dummy.current.updateMatrix()
      mesh.current!.setMatrixAt(i, dummy.current.matrix)
    })
    mesh.current.instanceMatrix.needsUpdate = true
  })

  if (!active) return null
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, CONFETTI_COUNT]} frustumCulled={false}>
      <planeGeometry args={[0.14, 0.22]} />
      <meshBasicMaterial side={DoubleSide} />
    </instancedMesh>
  )
}
