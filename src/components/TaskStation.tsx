import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, DoubleSide } from 'three'
import type { Group, Mesh, MeshBasicMaterial, MeshStandardMaterial } from 'three'
import { FUSE_BOX, MELTDOWN_PANELS, MONITORS, station, STATIONS } from '../sim/map'
import type { Vec2 } from '../sim/types'
import { currentGame, useSim } from '../ui/store'

/**
 * Every room's props, built from simple shapes and set against the walls, clear of the doors and
 * the spots where fruits stand to work. Each room says what it is at a glance. Stations light up
 * while someone works at them, and the two visual tasks show their effect: the Lab's scanner beam
 * and the Juicer's cup filling.
 */

type Kind =
  | 'pots'
  | 'planter'
  | 'tallPlant'
  | 'wateringCan'
  | 'press'
  | 'crates'
  | 'barrel'
  | 'conveyor'
  | 'bench'
  | 'shelf'
  | 'centrifuge'
  | 'whiteboard'
  | 'fuseWall'
  | 'transformer'
  | 'cables'
  | 'vending'
  | 'counter'
  | 'bin'
  | 'mapTable'
  | 'cardReader'
  | 'cabinet'
  | 'panels'
  | 'vat'
  | 'drawers'
  | 'fridge'
  | 'iceCrate'
  | 'desk'
  | 'screens'
  | 'serverRack'

/** One prop: what it is, where, and which way it faces (radians about the vertical). */
export interface Decor {
  kind: Kind
  at: Vec2
  rot?: number
}

/** Props stand a little further from the room centre than the working spot. */
function behind(at: Vec2): Vec2 {
  return [at[0], at[1] + (at[1] >= 0 ? 1.1 : -1.1)]
}

const station$ = (id: string) => behind(station(id).at)

export const DECOR: Decor[] = [
  // Greenhouse: plant beds, pots and a watering can.
  { kind: 'pots', at: station$('water') },
  { kind: 'pots', at: station$('prune') },
  { kind: 'planter', at: [-28.2, -13.5], rot: Math.PI / 2 },
  { kind: 'tallPlant', at: [-18.1, -18.1] },
  { kind: 'tallPlant', at: [-28.1, -10.9] },
  { kind: 'wateringCan', at: [-24.6, -18.1] },
  // Juicer: the big press, crates of fruit, barrels and a conveyor.
  { kind: 'press', at: station$('juice') },
  { kind: 'crates', at: [-7, -18] },
  { kind: 'crates', at: [6.9, -18] },
  { kind: 'barrel', at: [-7.1, -11] },
  { kind: 'barrel', at: [7.1, -11] },
  { kind: 'conveyor', at: [-4, -18.4] },
  // Lab: the microscope bench with its scanner arch, shelves of beakers, a centrifuge.
  { kind: 'bench', at: station$('scan') },
  { kind: 'shelf', at: [28.4, -16], rot: -Math.PI / 2 },
  { kind: 'centrifuge', at: [27.8, -11] },
  { kind: 'whiteboard', at: [19.3, -18.85] },
  // Electrical: fuse boxes with blinking lights, a transformer, cables on the floor.
  { kind: 'fuseWall', at: station$('wiring') },
  { kind: 'fuseWall', at: behind(FUSE_BOX), rot: Math.PI },
  { kind: 'transformer', at: [-18, -5] },
  { kind: 'cables', at: [-23, 0] },
  // Cafeteria: a vending machine, a counter and a bin (the table is drawn separately).
  { kind: 'vending', at: [-7.1, -5.1] },
  { kind: 'counter', at: [-7.3, 2.5], rot: Math.PI / 2 },
  { kind: 'bin', at: [7.2, 5.2] },
  // Admin: the card reader, a map table and filing cabinets.
  { kind: 'cardReader', at: station$('swipe') },
  { kind: 'mapTable', at: [25.5, 2.5] },
  { kind: 'cabinet', at: [28.4, 4.6] },
  { kind: 'cabinet', at: [28.4, 3.4] },
  // Ripening Chamber: control panels, ripening vats and drawers.
  { kind: 'panels', at: station$('calibrate') },
  { kind: 'vat', at: [-22.5, 18] },
  { kind: 'vat', at: [-28, 14.6] },
  { kind: 'drawers', at: [-18.1, 11.2] },
  // Cold Storage: fridges with doors, ice crates.
  { kind: 'fridge', at: station$('temps') },
  { kind: 'fridge', at: station$('fridge') },
  { kind: 'fridge', at: [-1.3, 18.2] },
  { kind: 'fridge', at: [1.3, 18.2] },
  { kind: 'iceCrate', at: [7, 11] },
  { kind: 'iceCrate', at: [-7, 11] },
  // Security: the desk of monitors, a wall of screens, a server rack.
  { kind: 'desk', at: behind(MONITORS) },
  { kind: 'screens', at: [28.55, 13.5], rot: Math.PI / 2 },
  { kind: 'serverRack', at: [18.1, 18.2] },
]

/** Where props are, for keeping the painted room names clear of them. */
export const PROP_SPOTS: Vec2[] = [...DECOR.map((d) => d.at), ...STATIONS.map((s) => s.at), ...MELTDOWN_PANELS]

export default function TaskStations() {
  return (
    <>
      {DECOR.map((d, i) => (
        <group key={i} position={[d.at[0], 0, d.at[1]]} rotation={[0, d.rot ?? 0, 0]}>
          <Prop kind={d.kind} />
        </group>
      ))}
      <StationEffects />
    </>
  )
}

const Box = ({ size, at, color, emissive }: { size: [number, number, number]; at: [number, number, number]; color: string; emissive?: string }) => (
  <mesh castShadow receiveShadow position={at}>
    <boxGeometry args={size} />
    <meshStandardMaterial color={color} roughness={0.7} emissive={emissive ?? '#000000'} emissiveIntensity={emissive ? 0.6 : 0} />
  </mesh>
)

const Cyl = ({ r, h, at, color, top }: { r: number; h: number; at: [number, number, number]; color: string; top?: number }) => (
  <mesh castShadow receiveShadow position={at}>
    <cylinderGeometry args={[top ?? r, r, h, 18]} />
    <meshStandardMaterial color={color} roughness={0.6} />
  </mesh>
)

const Ball = ({ r, at, color }: { r: number; at: [number, number, number]; color: string }) => (
  <mesh castShadow position={at}>
    <sphereGeometry args={[r, 14, 10]} />
    <meshStandardMaterial color={color} roughness={0.6} />
  </mesh>
)

const FRUIT_COLORS = ['#d8342c', '#f08a1c', '#f2d43a', '#58b033', '#6b3fa0']

function Prop({ kind }: { kind: Kind }) {
  switch (kind) {
    case 'pots':
      return (
        <>
          {[-0.6, 0.6].map((x) => (
            <group key={x} position={[x, 0, 0]}>
              <Cyl r={0.25} top={0.35} h={0.6} at={[0, 0.3, 0]} color="#c98b4a" />
              <Ball r={0.45} at={[0, 0.85, 0]} color="#5fb04a" />
              <Ball r={0.25} at={[0.2, 1.15, 0.1]} color="#76c95a" />
            </group>
          ))}
        </>
      )
    case 'planter':
      return (
        <>
          <Box size={[5, 0.5, 1]} at={[0, 0.25, 0]} color="#a87443" />
          <Box size={[4.8, 0.08, 0.85]} at={[0, 0.52, 0]} color="#6b4a2b" />
          {[-2, -1, 0, 1, 2].map((x) => (
            <Ball key={x} r={0.32} at={[x, 0.8, 0]} color={x % 2 ? '#4f9b3c' : '#6cc04a'} />
          ))}
        </>
      )
    case 'tallPlant':
      return (
        <>
          <Cyl r={0.3} top={0.4} h={0.7} at={[0, 0.35, 0]} color="#c98b4a" />
          <Cyl r={0.05} h={1.2} at={[0, 1.2, 0]} color="#3f6f2a" />
          <Ball r={0.55} at={[0, 1.9, 0]} color="#3f8f3a" />
          <Ball r={0.35} at={[0.3, 2.2, 0.1]} color="#5fb04a" />
        </>
      )
    case 'wateringCan':
      return (
        <>
          <Cyl r={0.22} h={0.4} at={[0, 0.2, 0]} color="#3d8fd6" />
          <mesh position={[0.3, 0.32, 0]} rotation={[0, 0, -0.8]}>
            <cylinderGeometry args={[0.03, 0.05, 0.45, 8]} />
            <meshStandardMaterial color="#3d8fd6" />
          </mesh>
        </>
      )
    case 'press':
      return <JuicerPress />
    case 'crates':
      return (
        <>
          {[
            [0, 0.3, 0],
            [0.15, 0.9, 0.05],
          ].map((p, i) => (
            <group key={i} position={p as [number, number, number]}>
              <Box size={[1, 0.6, 0.8]} at={[0, 0, 0]} color="#c98b4a" />
              {[-0.25, 0, 0.25].map((x, j) => (
                <Ball key={x} r={0.16} at={[x, 0.33, 0]} color={FRUIT_COLORS[(i * 3 + j) % FRUIT_COLORS.length]} />
              ))}
            </group>
          ))}
        </>
      )
    case 'barrel':
      return (
        <>
          <Cyl r={0.42} top={0.38} h={1} at={[0, 0.5, 0]} color="#a0602c" />
          <Cyl r={0.44} h={0.06} at={[0, 0.25, 0]} color="#5a3a1c" />
          <Cyl r={0.44} h={0.06} at={[0, 0.75, 0]} color="#5a3a1c" />
        </>
      )
    case 'conveyor':
      return (
        <>
          <Box size={[4, 0.12, 0.8]} at={[0, 0.6, 0]} color="#2b2f36" />
          {[-1.8, 1.8].map((x) => (
            <Box key={x} size={[0.12, 0.6, 0.7]} at={[x, 0.3, 0]} color="#9aa4b2" />
          ))}
          <ConveyorFruit />
        </>
      )
    case 'bench':
      return <ScanBench />
    case 'shelf':
      return (
        <>
          <Box size={[3, 1.8, 0.4]} at={[0, 0.9, 0]} color="#e9edf2" />
          {[0.6, 1.2].map((y) =>
            [-1, -0.4, 0.2, 0.8].map((x, i) => (
              <mesh key={`${x}${y}`} position={[x, y + 0.15, 0.1]}>
                <cylinderGeometry args={[0.08, 0.1, 0.3, 10]} />
                <meshStandardMaterial color={['#7fd3ff', '#bfeee0', '#ffb3c7', '#f6d365'][i]} transparent opacity={0.8} />
              </mesh>
            )),
          )}
        </>
      )
    case 'centrifuge':
      return (
        <>
          <Cyl r={0.5} h={0.8} at={[0, 0.4, 0]} color="#d7dce3" />
          <Spinner />
        </>
      )
    case 'whiteboard':
      return (
        <>
          <Box size={[2.4, 1.2, 0.06]} at={[0, 1.3, 0]} color="#ffffff" />
          <Box size={[1.4, 0.04, 0.02]} at={[-0.3, 1.5, 0.04]} color="#3d58b8" />
          <Box size={[0.9, 0.04, 0.02]} at={[0.2, 1.25, 0.04]} color="#e2412f" />
        </>
      )
    case 'fuseWall':
      return <FuseBoxes />
    case 'transformer':
      return (
        <>
          <Box size={[1, 1.2, 1]} at={[0, 0.6, 0]} color="#8a939f" />
          <Box size={[0.5, 0.18, 0.05]} at={[0, 0.9, 0.53]} color="#f6b62e" />
        </>
      )
    case 'cables':
      return (
        <>
          {[-0.3, 0, 0.3].map((z, i) => (
            <mesh key={z} position={[0, 0.03, z]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.04, 0.04, 6, 8]} />
              <meshStandardMaterial color={['#2b2f36', '#e2412f', '#3d58b8'][i]} />
            </mesh>
          ))}
        </>
      )
    case 'vending':
      return (
        <>
          <Box size={[1.1, 2, 0.8]} at={[0, 1, 0]} color="#e2412f" />
          <Box size={[0.7, 1.1, 0.04]} at={[-0.1, 1.2, 0.42]} color="#bfe6ff" emissive="#7fd3ff" />
        </>
      )
    case 'counter':
      return (
        <>
          <Box size={[4, 0.9, 0.8]} at={[0, 0.45, 0]} color="#ffffff" />
          <Box size={[4.1, 0.08, 0.9]} at={[0, 0.94, 0]} color="#c9d0da" />
          {[-1.2, 0, 1.2].map((x, i) => (
            <Ball key={x} r={0.16} at={[x, 1.12, 0]} color={FRUIT_COLORS[i + 1]} />
          ))}
        </>
      )
    case 'bin':
      return <Cyl r={0.35} top={0.4} h={0.8} at={[0, 0.4, 0]} color="#4c9a3b" />
    case 'cardReader':
      return (
        <>
          <Box size={[0.6, 1.2, 0.4]} at={[0, 0.6, 0]} color="#9aa4b2" />
          <Box size={[0.35, 0.12, 0.05]} at={[0, 1.0, 0.22]} color="#2b2f36" emissive="#4c9a3b" />
        </>
      )
    case 'mapTable':
      return (
        <>
          <Box size={[2.6, 0.8, 1.6]} at={[0, 0.4, 0]} color="#e9edf2" />
          <Box size={[2.4, 0.03, 1.4]} at={[0, 0.82, 0]} color="#3d8fd6" emissive="#3d8fd6" />
          {[
            [-0.6, 0.2],
            [0.5, -0.3],
            [0.2, 0.4],
          ].map(([x, z], i) => (
            <Box key={i} size={[0.3, 0.02, 0.25]} at={[x, 0.85, z]} color="#ffffff" />
          ))}
        </>
      )
    case 'cabinet':
      return (
        <>
          <Box size={[0.9, 1.4, 1]} at={[0, 0.7, 0]} color="#c9d0da" />
          {[0.45, 0.95].map((y) => (
            <Box key={y} size={[0.05, 0.06, 0.4]} at={[-0.47, y, 0]} color="#2b2f36" />
          ))}
        </>
      )
    case 'panels':
      return <RipeningPanels />
    case 'vat':
      return (
        <>
          <Cyl r={0.7} h={1.6} at={[0, 0.8, 0]} color="#e9edf2" />
          <mesh position={[0, 0.9, 0]}>
            <cylinderGeometry args={[0.72, 0.72, 0.6, 20, 1, true]} />
            <meshStandardMaterial color="#ff8a5c" emissive="#ff8a5c" emissiveIntensity={0.5} transparent opacity={0.85} side={DoubleSide} />
          </mesh>
        </>
      )
    case 'drawers':
      return (
        <>
          <Box size={[1.6, 1.1, 0.9]} at={[0, 0.55, 0]} color="#e9edf2" />
          {[0.35, 0.75].map((y) => (
            <Box key={y} size={[1.3, 0.04, 0.02]} at={[0, y, 0.46]} color="#9aa4b2" />
          ))}
        </>
      )
    case 'fridge':
      return (
        <>
          <Box size={[1.2, 2, 0.8]} at={[0, 1, 0]} color="#f2f6fb" />
          <Box size={[1.16, 0.03, 0.02]} at={[0, 1.3, -0.41]} color="#c9d0da" />
          <Box size={[0.08, 0.5, 0.06]} at={[0.45, 1.55, -0.43]} color="#9aa4b2" />
          <Box size={[0.08, 0.5, 0.06]} at={[0.45, 0.85, -0.43]} color="#9aa4b2" />
        </>
      )
    case 'iceCrate':
      return (
        <>
          <Box size={[0.9, 0.6, 0.9]} at={[0, 0.3, 0]} color="#bfe6ff" />
          {[-0.2, 0.15].map((x, i) => (
            <Box key={x} size={[0.3, 0.25, 0.3]} at={[x, 0.72, i ? 0.15 : -0.1]} color="#e6f6ff" />
          ))}
        </>
      )
    case 'desk':
      return (
        <>
          <Box size={[2.4, 0.8, 0.8]} at={[0, 0.4, 0]} color="#e9edf2" />
          <Screens count={2} width={0.9} y={1.15} />
        </>
      )
    case 'screens':
      return (
        <>
          <Box size={[3.4, 0.1, 0.3]} at={[0, 0.7, 0]} color="#9aa4b2" />
          <Screens count={3} width={1} y={1.4} />
        </>
      )
    case 'serverRack':
      return <ServerRack />
  }
}

// ---------- Animated props ----------

/** Monitors that flicker between camera feeds. */
function Screens({ count, width, y }: { count: number; width: number; y: number }) {
  const screens = useRef<(Mesh | null)[]>([])
  const colors = useMemo(() => ['#2f5d7c', '#3a6e4f', '#5a4a7c', '#2d6b6b'].map((c) => new Color(c)), [])
  useFrame(() => {
    const t = performance.now()
    screens.current.forEach((m, i) => {
      if (!m) return
      const material = m.material as MeshStandardMaterial
      // Each screen cuts to another feed now and then, with a little flicker.
      const feed = Math.floor(t / 2300 + i * 1.7) % colors.length
      material.emissive.copy(colors[feed])
      material.emissiveIntensity = 0.7 + Math.sin(t * 0.03 + i) * 0.08 + (Math.random() < 0.02 ? 0.4 : 0)
    })
  })
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const x = (i - (count - 1) / 2) * (width + 0.15)
        return (
          <group key={i} position={[x, y, 0]}>
            <Box size={[width, 0.62, 0.08]} at={[0, 0, 0]} color="#2b2f36" />
            <mesh ref={(m) => void (screens.current[i] = m)} position={[0, 0, -0.045]}>
              <boxGeometry args={[width - 0.1, 0.5, 0.01]} />
              <meshStandardMaterial color="#111" emissive="#2f5d7c" emissiveIntensity={0.7} />
            </mesh>
          </group>
        )
      })}
    </>
  )
}

/** Fuse boxes with lights that blink green and amber; they all go red while the lights are out. */
function FuseBoxes() {
  const lights = useRef<(Mesh | null)[]>([])
  useFrame(() => {
    const t = performance.now()
    const out = useSim.getState().lightsOut
    lights.current.forEach((m, i) => {
      if (!m) return
      const material = m.material as MeshBasicMaterial
      const on = out ? Math.floor(t / 260) % 2 === 0 : Math.sin(t * 0.004 * (1 + i * 0.37) + i) > -0.2
      material.color.set(out ? (on ? '#ff3b2f' : '#5a1a14') : on ? (i % 3 ? '#4cff6a' : '#ffc83a') : '#1d3a22')
    })
  })
  return (
    <>
      <Box size={[1.8, 1.7, 0.4]} at={[0, 0.85, 0]} color="#d7dce3" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <mesh key={i} ref={(m) => void (lights.current[i] = m)} position={[-0.6 + (i % 3) * 0.6, 1.15 - Math.floor(i / 3) * 0.45, 0.22]}>
          <boxGeometry args={[0.18, 0.18, 0.04]} />
          <meshBasicMaterial color="#4cff6a" />
        </mesh>
      ))}
      <Box size={[0.08, 0.6, 0.06]} at={[0.75, 0.55, 0.22]} color="#e2412f" />
    </>
  )
}

/** A spinning centrifuge lid. */
function Spinner() {
  const g = useRef<Group>(null)
  useFrame((_, delta) => {
    if (g.current) g.current.rotation.y += delta * 6
  })
  return (
    <group ref={g} position={[0, 0.82, 0]}>
      <Cyl r={0.42} h={0.06} at={[0, 0, 0]} color="#9aa4b2" />
      <Box size={[0.7, 0.05, 0.08]} at={[0, 0.05, 0]} color="#3d58b8" />
    </group>
  )
}

/** A server rack with blinking status lights. */
function ServerRack() {
  const lights = useRef<(Mesh | null)[]>([])
  useFrame(() => {
    const t = performance.now()
    lights.current.forEach((m, i) => {
      if (m) (m.material as MeshBasicMaterial).color.set(Math.sin(t * 0.01 * (1 + (i % 4) * 0.6) + i * 2) > 0.3 ? '#4cff6a' : '#174a22')
    })
  })
  return (
    <>
      <Box size={[1, 2.1, 0.8]} at={[0, 1.05, 0]} color="#2b2f36" />
      {Array.from({ length: 8 }, (_, i) => (
        <mesh key={i} ref={(m) => void (lights.current[i] = m)} position={[-0.25 + (i % 2) * 0.5, 0.4 + Math.floor(i / 2) * 0.42, -0.41]}>
          <boxGeometry args={[0.1, 0.06, 0.02]} />
          <meshBasicMaterial color="#4cff6a" />
        </mesh>
      ))}
    </>
  )
}

/** Fruit riding the conveyor toward the press, one after another. */
function ConveyorFruit() {
  const g = useRef<Group>(null)
  useFrame(() => {
    if (!g.current) return
    const t = performance.now() / 1000
    g.current.children.forEach((c, i) => {
      c.position.x = (((t * 0.6 + i * 1.3) % 3.9) - 1.95)
    })
  })
  return (
    <group ref={g} position={[0, 0.82, 0]}>
      {[0, 1, 2].map((i) => (
        <Ball key={i} r={0.18} at={[0, 0, 0]} color={FRUIT_COLORS[i + 1]} />
      ))}
    </group>
  )
}

/** The Ripening Chamber's control panels, with needles that wobble (and swing wildly in a meltdown). */
function RipeningPanels() {
  const needles = useRef<(Group | null)[]>([])
  useFrame(() => {
    const t = performance.now() / 1000
    const melt = useSim.getState().meltdownAt !== null
    needles.current.forEach((n, i) => {
      if (n) n.rotation.z = melt ? Math.sin(t * 9 + i) * 1.2 : Math.sin(t * 0.8 + i * 2) * 0.35
    })
  })
  return (
    <>
      {[-0.8, 0.8].map((x, i) => (
        <group key={x} position={[x, 0, 0]}>
          <Box size={[1.2, 1.3, 0.6]} at={[0, 0.65, 0]} color="#e9edf2" />
          <Box size={[0.8, 0.5, 0.05]} at={[0, 1.0, -0.33]} color="#fff4dc" />
          <group ref={(g) => void (needles.current[i] = g)} position={[0, 0.85, -0.36]}>
            <Box size={[0.04, 0.35, 0.02]} at={[0, 0.17, 0]} color="#e2412f" />
          </group>
        </group>
      ))}
    </>
  )
}

/** The fruit press: its plunger pumps while someone juices a batch, and slams down on an ejection. */
function JuicerPress() {
  const plunger = useRef<Group>(null)
  useFrame(() => {
    if (!plunger.current) return
    const now = performance.now()
    const slam = now - useSim.getState().slamAt
    const working = currentGame().fruits.some((f) => f.working === 'juice' && f.role === 'crew')
    let y = 0
    // A slam: straight down, a shudder, then back up.
    if (slam >= 0 && slam < 1400) y = slam < 160 ? -(slam / 160) * 0.55 : slam < 700 ? -0.55 + Math.sin(slam * 0.08) * 0.03 : -0.55 * (1 - (slam - 700) / 700)
    else if (working) y = -Math.abs(Math.sin(now * 0.006)) * 0.35
    plunger.current.position.y = 1.65 + y
  })
  return (
    <>
      <Box size={[1.6, 1.3, 1]} at={[0, 0.65, 0]} color="#e9edf2" />
      {/* The hopper on top, where the fruit goes in. */}
      <mesh castShadow position={[0, 1.42, 0]}>
        <cylinderGeometry args={[0.7, 0.45, 0.25, 18, 1, true]} />
        <meshStandardMaterial color="#9aa4b2" side={DoubleSide} />
      </mesh>
      <group ref={plunger}>
        <Cyl r={0.55} h={0.25} at={[0, 0, 0]} color="#6b7480" />
        <Cyl r={0.08} h={1.2} at={[0, 0.6, 0]} color="#9aa4b2" />
      </group>
      {/* The spout, over the cup that fills while a batch is juiced. */}
      <Box size={[0.25, 0.08, 0.4]} at={[-0.85, 1.05, 0]} color="#9aa4b2" />
      <JuiceGlass />
    </>
  )
}

/** The Juicer's big glass: it fills a little more with every fruit that goes in. */
function JuiceGlass() {
  const juice = useSim((s) => s.juice)
  const level = Math.min(1, 0.15 + juice * 0.22)
  return (
    <group position={[1.15, 0, 0]}>
      <mesh position={[0, 0.4, 0]}>
        <cylinderGeometry args={[0.24, 0.2, 0.8, 16, 1, true]} />
        <meshStandardMaterial color="#ffffff" transparent opacity={0.35} side={DoubleSide} />
      </mesh>
      <mesh position={[0, (0.78 * level) / 2 + 0.01, 0]}>
        <cylinderGeometry args={[0.21, 0.19, 0.78 * level, 16]} />
        <meshStandardMaterial color="#ffb03a" />
      </mesh>
    </group>
  )
}

/** The microscope bench and the scanner arch over it. */
function ScanBench() {
  return (
    <>
      <Box size={[2, 0.9, 0.9]} at={[0, 0.45, 0]} color="#ffffff" />
      <Cyl r={0.18} top={0.12} h={0.7} at={[-0.5, 1.25, 0]} color="#3d58b8" />
      <Box size={[0.3, 0.06, 0.3]} at={[-0.5, 0.93, 0]} color="#2b2f36" />
      {/* The scanner arch. */}
      <Box size={[0.08, 1.5, 0.08]} at={[0.3, 1.65, 0.75]} color="#9aa4b2" />
      <Box size={[0.08, 1.5, 0.08]} at={[1.3, 1.65, 0.75]} color="#9aa4b2" />
      <Box size={[1.08, 0.12, 0.12]} at={[0.8, 2.4, 0.75]} color="#9aa4b2" />
    </>
  )
}

// ---------- Effects at the stations ----------

/** Glows under busy stations, the scanner beam, and the cup that fills while juicing. */
function StationEffects() {
  const glows = useRef<(Mesh | null)[]>([])
  const beam = useRef<Mesh>(null)
  const cup = useRef<Mesh>(null)
  const scan = station('scan').at
  const juice = station('juice').at

  useFrame(() => {
    const game = currentGame()
    const now = performance.now()
    const reveal = useSim.getState().revealRoles
    STATIONS.forEach((s, i) => {
      const m = glows.current[i]
      if (!m) return
      // Only real work makes a station glow (a faker's station stays dark, unless roles are revealed).
      const worker = game.fruits.find((f) => f.working === s.id && (f.role === 'crew' || reveal))
      m.visible = !!worker
      if (worker) {
        const material = m.material as MeshBasicMaterial
        material.color.set(worker.role === 'crew' ? '#8ff0a4' : '#b9b9b9')
        material.opacity = 0.35 + Math.sin(now * 0.008) * 0.15
      }
    })
    // The scanner beam sweeps the bench while a crew fruit scans: proof it's real.
    const scanner = game.fruits.find((f) => f.working === 'scan' && f.role === 'crew')
    if (beam.current) {
      beam.current.visible = !!scanner
      beam.current.position.x = scan[0] + 0.8 + Math.sin(now * 0.004) * 0.45
    }
    // The cup under the spout fills as the batch is juiced.
    const juicer = game.fruits.find((f) => f.working === 'juice' && f.role === 'crew')
    const task = juicer?.tasks.find((t) => t.station === 'juice')
    if (cup.current) {
      const level = task ? Math.max(0.05, task.progress / task.duration) : 0
      cup.current.visible = level > 0
      cup.current.scale.y = level
      cup.current.position.y = 0.55 + (0.4 * level) / 2
    }
  })

  const scanAt = behind(scan)
  const juiceAt = behind(juice)
  return (
    <>
      {STATIONS.map((s, i) => (
        <mesh key={s.id} ref={(m) => void (glows.current[i] = m)} rotation={[-Math.PI / 2, 0, 0]} position={[s.at[0], 0.025, s.at[1]]} visible={false}>
          <ringGeometry args={[0.55, 0.9, 32]} />
          <meshBasicMaterial color="#8ff0a4" transparent opacity={0.4} depthWrite={false} />
        </mesh>
      ))}
      <mesh ref={beam} position={[scanAt[0], 1.55, scanAt[1] + 0.75]} visible={false}>
        <boxGeometry args={[0.12, 1.6, 0.9]} />
        <meshBasicMaterial color="#7fd3ff" transparent opacity={0.45} depthWrite={false} />
      </mesh>
      <group position={[juiceAt[0] - 0.95, 0, juiceAt[1]]}>
        <mesh position={[0, 0.75, 0]}>
          <cylinderGeometry args={[0.15, 0.12, 0.42, 14, 1, true]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={0.4} side={DoubleSide} />
        </mesh>
        <mesh ref={cup} position={[0, 0.6, 0]} visible={false}>
          <cylinderGeometry args={[0.13, 0.11, 0.4, 14]} />
          <meshStandardMaterial color="#ffb03a" />
        </mesh>
      </group>
    </>
  )
}
