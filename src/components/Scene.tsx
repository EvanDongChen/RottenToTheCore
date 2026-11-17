import { Suspense } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Physics } from '@react-three/rapier'
import { advance } from '../ui/clock'
import { useSim } from '../ui/store'
import Dust from './Dust'
import Fruit from './Fruit'
import Stage from './Stage'
import VisionCones from './VisionCones'

/** Looking down on the lab from above and in front, like a board game on a table. */
const CAMERA_FROM: [number, number, number] = [0, 46, 36]

/** Runs the sim's ticks once per frame. Draws nothing. */
function SimClock() {
  useFrame((_, delta) => advance(delta))
  return null
}

/**
 * Everything drawn in 3D. This is the heavy part of the app (three.js and the physics
 * engine), so it is loaded separately and the page can show its interface first.
 */
export default function Scene() {
  const seed = useSim((s) => s.seed)
  // Dead fruits stay where they fell until a meeting clears the bodies away.
  const ids = useSim((s) => s.fruits.filter((f) => !s.cleared[f.id]).map((f) => f.id).join(','))

  return (
    // dpr is capped so high-density screens don't render four times the pixels.
    <Canvas shadows dpr={[1, 1.5]} camera={{ position: CAMERA_FROM, fov: 42, near: 0.5, far: 300 }}>
      <SimClock />
      <Suspense fallback={null}>
        <Physics gravity={[0, -20, 0]}>
          <Stage />
          {/* Keyed by seed too, so a new game mounts fresh fruits at their new spawn points. */}
          {ids.split(',').filter(Boolean).map((id) => (
            <Fruit key={`${seed}:${id}`} id={id} />
          ))}
        </Physics>
        <Dust />
        <VisionCones />
      </Suspense>
      <OrbitControls makeDefault target={[0, 0, 0]} maxPolarAngle={Math.PI / 2.15} minDistance={6} maxDistance={90} />
    </Canvas>
  )
}
