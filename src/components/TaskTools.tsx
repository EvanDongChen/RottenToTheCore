import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group, Object3D } from 'three'
import { STATIONS } from '../sim/map'
import type { Station } from '../sim/map'
import { currentGame, fruitPositions, useSim } from '../ui/store'

/** Where the tool is held: a little toward the station and out to the side, so the fruit's body doesn't hide it. */
const REACH = 0.45
const SIDE = 0.62
/** Tools are drawn a bit larger than life so they read from the camera. */
const SIZE = 1.4
const HAND_HEIGHT = 0.8
/** Little bits (drips, sparks, leaves) each effect cycles through. */
const BITS = 5

/**
 * The tool in a working fruit's hands, and what it does: a cloth scrubbing the table, a watering
 * can dripping, shears snipping leaves off, a screwdriver throwing sparks, a card through a
 * reader, a test tube being shaken, a wrench turning, a thermometer and clipboard, crates lifted
 * into the fridge. A Rotten faking a task holds the tool too, except at the two visual tasks
 * (the blender and the scanner), where only a real worker sets things going.
 */
export default function TaskTools() {
  return (
    <>
      {STATIONS.map((s) => (
        <Tool key={s.id} station={s} />
      ))}
    </>
  )
}

function Tool({ station }: { station: Station }) {
  const root = useRef<Group>(null)
  const tool = useRef<Group>(null)
  const bits = useRef<(Object3D | null)[]>([])

  useFrame(() => {
    const g = root.current
    if (!g) return
    const worker = currentGame().fruits.find(
      (f) => f.alive && f.working === station.id && !f.path.length && (f.role === 'crew' || !station.visual),
    )
    const at = worker ? fruitPositions.get(worker.id) : undefined
    g.visible = !!at && !useSim.getState().venting[worker!.id]
    if (!at || !worker) return
    // Between the fruit and its station, facing the station.
    const dx = station.at[0] - at.x
    const dz = station.at[1] - at.z
    const d = Math.hypot(dx, dz) || 1
    const reach = Math.min(REACH, d)
    // Out to the side the camera can see (the camera looks north, from the south).
    const side = dz / d > 0 ? -SIDE : SIDE
    g.position.set(at.x + (dx / d) * reach + (dz / d) * side, 0, at.z + (dz / d) * reach - (dx / d) * side)
    g.rotation.y = Math.atan2(dx, dz)
    g.scale.setScalar(SIZE)
    animate(station.id, tool.current, bits.current, performance.now() / 1000)
  })

  return (
    <group ref={root} visible={false}>
      <group ref={tool} position={[0, HAND_HEIGHT, 0]}>
        <Shape id={station.id} />
      </group>
      {Array.from({ length: BITS }, (_, i) => (
        <mesh key={i} ref={(m) => void (bits.current[i] = m)} visible={false}>
          <Bit id={station.id} />
        </mesh>
      ))}
    </group>
  )
}

/** Each bit's place in its little loop, 0..1, offset so they don't all move together. */
function phase(t: number, i: number, period: number) {
  return (t / period + i / BITS) % 1
}

/** Move the tool and its bits for one frame. Positions are relative to the spot in front of the fruit. */
function animate(id: string, tool: Group | null, bits: (Object3D | null)[], t: number) {
  if (!tool) return
  tool.position.set(0, HAND_HEIGHT, 0)
  tool.rotation.set(0, 0, 0)
  tool.scale.setScalar(1)
  bits.forEach((b) => b && (b.visible = false))
  const each = (fn: (b: Object3D, p: number, i: number) => void, period: number) =>
    bits.forEach((b, i) => {
      if (!b) return
      b.visible = true
      fn(b, phase(t, i, period), i)
    })

  switch (id) {
    case 'wipe': {
      // Scrubbing in circles on the table top, with a sparkle now and then.
      tool.position.set(Math.cos(t * 7) * 0.2, 0.58, 0.3 + Math.sin(t * 7) * 0.15)
      tool.rotation.y = t * 7
      each((b, p, i) => {
        b.position.set(Math.cos(i * 2.4) * 0.35, 0.6 + p * 0.45, 0.3 + Math.sin(i * 2.4) * 0.2)
        b.scale.setScalar(Math.sin(p * Math.PI) * 1.2)
      }, 1.1)
      break
    }
    case 'water': {
      // The can tips forward and drips.
      tool.rotation.x = 0.6 + Math.sin(t * 3) * 0.12
      each((b, p, i) => {
        b.position.set((i - 2) * 0.03, 1.0 - p * 1.0, 0.75 + p * 0.1)
        b.scale.setScalar(1 - p * 0.4)
      }, 0.7)
      break
    }
    case 'prune': {
      // The shears snip open and shut; leaves flutter down.
      const snip = Math.abs(Math.sin(t * 6))
      tool.children[0] && (tool.children[0].rotation.y = snip * 0.5)
      tool.children[1] && (tool.children[1].rotation.y = -snip * 0.5)
      tool.position.y = HAND_HEIGHT + 0.2 + Math.sin(t * 1.3) * 0.15
      each((b, p, i) => {
        b.position.set(Math.sin(p * 9 + i) * 0.25, 1.4 - p * 1.35, 0.5 + i * 0.05)
        b.rotation.set(p * 6, p * 4 + i, 0)
      }, 2.4)
      break
    }
    case 'wiring': {
      // Screwdriver twisting into the panel, sparks spitting out.
      tool.rotation.z = t * 9
      tool.position.z = 0.25 + Math.sin(t * 2) * 0.05
      each((b, p, i) => {
        const a = i * 1.26 + Math.floor(t / 0.5) * 2.1
        b.position.set(Math.cos(a) * p * 0.6, HAND_HEIGHT + Math.sin(a) * p * 0.5 + 0.1 - p * p * 0.4, 0.6)
        b.scale.setScalar(1 - p)
      }, 0.5)
      break
    }
    case 'swipe': {
      // The card slides through, again and again (it's always too fast or too slow).
      const s = (t * 1.2) % 1
      tool.position.set(-0.35 + s * 0.7, HAND_HEIGHT + 0.1, 0.35)
      break
    }
    case 'scan': {
      // Shaking the sample tube, bubbles rising inside.
      tool.rotation.z = Math.sin(t * 14) * 0.35
      each((b, p, i) => {
        b.position.set(Math.sin(i) * 0.03, HAND_HEIGHT - 0.1 + p * 0.3, 0)
        b.scale.setScalar(1 - p * 0.5)
      }, 0.8)
      break
    }
    case 'calibrate': {
      // A wrench cranking round the dial.
      tool.rotation.z = Math.sin(t * 4) * 0.9
      tool.position.z = 0.35
      break
    }
    case 'temps': {
      // Thermometer held up, then a tick on the clipboard.
      tool.rotation.x = -0.4
      tool.position.y = HAND_HEIGHT + Math.abs(Math.sin(t * 2)) * 0.1
      const mercury = tool.children[2]
      if (mercury) mercury.scale.y = 0.3 + 0.7 * ((Math.sin(t * 1.5) + 1) / 2)
      break
    }
    case 'fridge': {
      // A crate lifted up and pushed onto the shelf, over and over.
      const s = (t * 0.8) % 1
      tool.position.set(0, HAND_HEIGHT - 0.2 + Math.sin(Math.min(1, s * 1.6) * Math.PI) * 0.4, 0.2 + s * 0.5)
      tool.scale.setScalar(s > 0.85 ? 1 - (s - 0.85) / 0.15 : 1)
      break
    }
    case 'juice': {
      // Dropping fruit into the blender jar, one at a time.
      const s = (t * 0.9) % 1
      tool.position.set(0, HAND_HEIGHT + Math.sin(s * Math.PI) * 1.4, 0.2 + s * 0.6)
      tool.scale.setScalar(s > 0.8 ? 1 - (s - 0.8) / 0.2 : 1)
      break
    }
  }
}

const mat = (color: string, emissive = false) => <meshStandardMaterial color={color} emissive={emissive ? color : undefined} emissiveIntensity={emissive ? 0.8 : 0} />

/** What each tool looks like. */
function Shape({ id }: { id: string }) {
  switch (id) {
    case 'wipe':
      return (
        <mesh>
          <boxGeometry args={[0.32, 0.05, 0.22]} />
          {mat('#5ab0f0')}
        </mesh>
      )
    case 'water':
      return (
        <group>
          <mesh>
            <cylinderGeometry args={[0.16, 0.16, 0.3, 14]} />
            {mat('#3d8fd6')}
          </mesh>
          <mesh position={[0, 0.06, 0.24]} rotation={[0.9, 0, 0]}>
            <cylinderGeometry args={[0.025, 0.04, 0.35, 8]} />
            {mat('#3d8fd6')}
          </mesh>
        </group>
      )
    case 'prune':
      return (
        <>
          <mesh position={[0, 0, 0.12]}>
            <boxGeometry args={[0.04, 0.03, 0.3]} />
            {mat('#c9d1db')}
          </mesh>
          <mesh position={[0, 0.02, 0.12]}>
            <boxGeometry args={[0.04, 0.03, 0.3]} />
            {mat('#c9d1db')}
          </mesh>
          <mesh position={[0, 0, -0.08]}>
            <boxGeometry args={[0.12, 0.05, 0.14]} />
            {mat('#e2412f')}
          </mesh>
        </>
      )
    case 'wiring':
      return (
        <group rotation={[Math.PI / 2, 0, 0]}>
          <mesh position={[0, -0.05, 0]}>
            <cylinderGeometry args={[0.06, 0.06, 0.18, 10]} />
            {mat('#f2c230')}
          </mesh>
          <mesh position={[0, 0.12, 0]}>
            <cylinderGeometry args={[0.015, 0.015, 0.2, 6]} />
            {mat('#c9d1db')}
          </mesh>
        </group>
      )
    case 'swipe':
      return (
        <mesh rotation={[0, Math.PI / 2, 0]}>
          <boxGeometry args={[0.24, 0.15, 0.015]} />
          {mat('#ffffff')}
        </mesh>
      )
    case 'scan':
      return (
        <group>
          <mesh>
            <cylinderGeometry args={[0.05, 0.05, 0.32, 10, 1, true]} />
            <meshStandardMaterial color="#dff3ff" transparent opacity={0.5} />
          </mesh>
          <mesh position={[0, -0.07, 0]}>
            <cylinderGeometry args={[0.042, 0.042, 0.16, 10]} />
            {mat('#8de07a', true)}
          </mesh>
        </group>
      )
    case 'calibrate':
      return (
        <group>
          <mesh position={[0, 0.12, 0]}>
            <boxGeometry args={[0.05, 0.3, 0.03]} />
            {mat('#9aa4b2')}
          </mesh>
          <mesh position={[0, 0.3, 0]}>
            <torusGeometry args={[0.06, 0.025, 6, 12, Math.PI * 1.5]} />
            {mat('#9aa4b2')}
          </mesh>
        </group>
      )
    case 'temps':
      return (
        <group>
          <mesh position={[-0.12, 0, 0]}>
            <boxGeometry args={[0.24, 0.3, 0.02]} />
            {mat('#d9a066')}
          </mesh>
          <mesh position={[0.16, 0.05, 0]}>
            <cylinderGeometry args={[0.025, 0.025, 0.32, 8]} />
            <meshStandardMaterial color="#ffffff" transparent opacity={0.7} />
          </mesh>
          <mesh position={[0.16, -0.05, 0.005]}>
            <boxGeometry args={[0.02, 0.2, 0.02]} />
            {mat('#e2412f', true)}
          </mesh>
        </group>
      )
    case 'fridge':
      return (
        <mesh>
          <boxGeometry args={[0.4, 0.25, 0.3]} />
          {mat('#b98552')}
        </mesh>
      )
    case 'juice':
      return (
        <mesh>
          <sphereGeometry args={[0.13, 12, 10]} />
          {mat('#ff9a2a')}
        </mesh>
      )
  }
  return null
}

/** What each effect's little bits look like. */
function Bit({ id }: { id: string }) {
  switch (id) {
    case 'wipe':
      return (
        <>
          <octahedronGeometry args={[0.06]} />
          <meshBasicMaterial color="#fffbd0" />
        </>
      )
    case 'water':
      return (
        <>
          <sphereGeometry args={[0.04, 6, 6]} />
          <meshBasicMaterial color="#7fc4ff" />
        </>
      )
    case 'prune':
      return (
        <>
          <planeGeometry args={[0.14, 0.09]} />
          <meshStandardMaterial color="#4c9a3b" side={2} />
        </>
      )
    case 'wiring':
      return (
        <>
          <boxGeometry args={[0.05, 0.05, 0.05]} />
          <meshBasicMaterial color="#ffe14a" />
        </>
      )
    case 'scan':
      return (
        <>
          <sphereGeometry args={[0.015, 6, 6]} />
          <meshBasicMaterial color="#e8ffe0" />
        </>
      )
  }
  // The rest have no bits; an empty geometry keeps them out of sight.
  return <bufferGeometry />
}
