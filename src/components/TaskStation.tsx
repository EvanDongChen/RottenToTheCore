import { FUSE_BOX, MONITORS, STATIONS } from '../sim/map'
import { useSim } from '../ui/store'
import type { Station } from '../sim/map'

/**
 * Props for every task station, built from simple shapes and set just behind the spot where a
 * fruit stands to work. Each room's prop says what the task is at a glance.
 */
export default function TaskStations() {
  return (
    <>
      {STATIONS.map((s) => (
        <StationProp key={s.id} station={s} />
      ))}
      <Prop at={behind(FUSE_BOX)} kind="fuse" />
      <Prop at={behind(MONITORS)} kind="monitors" />
    </>
  )
}

/** Props stand a little further from the room centre than the working spot. */
function behind(at: [number, number]): [number, number] {
  const dz = at[1] >= 0 ? 1 : -1
  return [at[0], at[1] + dz * 1.1]
}

function StationProp({ station }: { station: Station }) {
  // The table wipe happens at the meeting table itself, which is already drawn.
  if (station.id === 'wipe') return null
  return <Prop at={behind(station.at)} kind={station.id} />
}

const BOX = ({ size, at, color }: { size: [number, number, number]; at: [number, number, number]; color: string }) => (
  <mesh castShadow receiveShadow position={at}>
    <boxGeometry args={size} />
    <meshStandardMaterial color={color} roughness={0.7} />
  </mesh>
)

function Prop({ at, kind }: { at: [number, number]; kind: string }) {
  let body
  switch (kind) {
    case 'water':
    case 'prune':
      // Plant pots with round green tops.
      body = (
        <>
          {[-0.6, 0.6].map((x) => (
            <group key={x} position={[x, 0, 0]}>
              <mesh castShadow position={[0, 0.3, 0]}>
                <cylinderGeometry args={[0.35, 0.25, 0.6, 14]} />
                <meshStandardMaterial color="#c98b4a" />
              </mesh>
              <mesh castShadow position={[0, 0.85, 0]}>
                <sphereGeometry args={[0.45, 14, 10]} />
                <meshStandardMaterial color={kind === 'prune' ? '#3f8f3a' : '#6cc04a'} />
              </mesh>
            </group>
          ))}
        </>
      )
      break
    case 'juice':
      // The big fruit press, and the glass it fills.
      body = (
        <>
          <BOX size={[1.6, 1.4, 1]} at={[0, 0.7, 0]} color="#e9edf2" />
          <mesh castShadow position={[0, 1.6, 0]}>
            <cylinderGeometry args={[0.55, 0.7, 0.5, 18]} />
            <meshStandardMaterial color="#9aa4b2" />
          </mesh>
          <JuiceGlass />
        </>
      )
      break
    case 'wiring':
    case 'fuse':
      body = (
        <>
          <BOX size={[1.4, 1.6, 0.4]} at={[0, 0.8, 0]} color="#d7dce3" />
          <BOX size={[0.3, 0.3, 0.05]} at={[-0.35, 1.2, kind === 'fuse' ? -0.23 : 0.23]} color={kind === 'fuse' ? '#f6b62e' : '#4c9a3b'} />
          <BOX size={[0.3, 0.3, 0.05]} at={[0.35, 1.2, kind === 'fuse' ? -0.23 : 0.23]} color="#e2412f" />
        </>
      )
      break
    case 'swipe':
      body = <BOX size={[0.6, 1.2, 0.4]} at={[0, 0.6, 0]} color="#9aa4b2" />
      break
    case 'scan':
      // The microscope bench.
      body = (
        <>
          <BOX size={[2, 0.9, 0.9]} at={[0, 0.45, 0]} color="#ffffff" />
          <mesh castShadow position={[0, 1.2, 0]}>
            <cylinderGeometry args={[0.12, 0.18, 0.7, 12]} />
            <meshStandardMaterial color="#3d58b8" />
          </mesh>
        </>
      )
      break
    case 'calibrate':
      body = (
        <>
          <BOX size={[1.2, 1.3, 0.6]} at={[-0.8, 0.65, 0]} color="#e9edf2" />
          <BOX size={[1.2, 1.3, 0.6]} at={[0.8, 0.65, 0]} color="#e9edf2" />
          <BOX size={[0.8, 0.4, 0.05]} at={[-0.8, 1.0, 0.33]} color="#ff8a5c" />
          <BOX size={[0.8, 0.4, 0.05]} at={[0.8, 1.0, 0.33]} color="#ff8a5c" />
        </>
      )
      break
    case 'temps':
    case 'fridge':
      body = (
        <>
          <BOX size={[1.2, 2, 0.8]} at={[0, 1, 0]} color="#f2f6fb" />
          <BOX size={[0.08, 0.6, 0.05]} at={[0.45, 1.2, -0.43]} color="#9aa4b2" />
        </>
      )
      break
    case 'monitors':
      body = (
        <>
          <BOX size={[2.4, 0.8, 0.8]} at={[0, 0.4, 0]} color="#e9edf2" />
          {[-0.6, 0.6].map((x) => (
            <BOX key={x} size={[0.9, 0.6, 0.08]} at={[x, 1.15, 0]} color="#2b2f36" />
          ))}
        </>
      )
      break
    default:
      body = <BOX size={[1, 1, 1]} at={[0, 0.5, 0]} color="#e9edf2" />
  }
  return <group position={[at[0], 0, at[1]]}>{body}</group>
}

/** The Juicer's glass: it fills a little more with every fruit that goes in. */
function JuiceGlass() {
  const juice = useSim((s) => s.juice)
  const level = Math.min(1, 0.15 + juice * 0.22)
  return (
    <group position={[1.1, 0, 0]}>
      <mesh position={[0, 0.4, 0]}>
        <cylinderGeometry args={[0.24, 0.2, 0.8, 16, 1, true]} />
        <meshStandardMaterial color="#ffffff" transparent opacity={0.35} />
      </mesh>
      <mesh position={[0, (0.78 * level) / 2 + 0.01, 0]}>
        <cylinderGeometry args={[0.21, 0.19, 0.78 * level, 16]} />
        <meshStandardMaterial color="#ffb03a" />
      </mesh>
    </group>
  )
}
