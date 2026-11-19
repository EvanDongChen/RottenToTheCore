import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { CanvasTexture, MathUtils, RepeatWrapping, SRGBColorSpace } from 'three'
import type { Group, Mesh, MeshStandardMaterial } from 'three'
import { DOORS, doorsOf, WALL_HEIGHT } from '../sim/map'
import type { Door } from '../sim/map'
import { useSim } from '../ui/store'
import { GLOW } from './Glows'

const FRAME_COLOR = '#a9b8ca'
const POST = 0.22
const DEPTH = 0.5
const LINTEL = 0.18
const PANEL_THICK = 0.12

/** Yellow and black hazard stripes, drawn once and shared by every door panel. */
function stripes(): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = '#f2c230'
  g.fillRect(0, 0, 64, 64)
  g.fillStyle = '#2b2f36'
  for (let i = -64; i < 128; i += 32) {
    g.beginPath()
    g.moveTo(i, 0)
    g.lineTo(i + 16, 0)
    g.lineTo(i + 16 + 64, 64)
    g.lineTo(i + 64, 64)
    g.fill()
  }
  const t = new CanvasTexture(c)
  t.wrapS = t.wrapT = RepeatWrapping
  t.colorSpace = SRGBColorSpace
  return t
}

/**
 * Every doorway gets a frame: a post either side and a beam across the top, with a little light
 * in the middle. When the Rotten lock a room, its doors slide shut from both posts, striped like
 * a hazard, and the light blinks red until they open again.
 */
export default function Doorways() {
  const texture = useMemo(stripes, [])
  return (
    <>
      {DOORS.map((d) => (
        <Doorway key={d.id} door={d} texture={texture} />
      ))}
    </>
  )
}

function Doorway({ door, texture }: { door: Door; texture: CanvasTexture }) {
  const left = useRef<Group>(null)
  const right = useRef<Group>(null)
  const light = useRef<Mesh>(null)
  const shut = useRef(0)
  const span = door.half * 2
  // Frames are drawn with their width along x; doors across a vertical wall turn a quarter.
  const turn = door.along[0] ? 0 : Math.PI / 2

  useFrame((_, delta) => {
    const room = useSim.getState().lockedRoom
    const locked = !!room && doorsOf(room).some((d) => d.id === door.id)
    shut.current = MathUtils.damp(shut.current, locked ? 1 : 0, locked ? 7 : 4, delta)
    const s = shut.current
    // Each half slides out from its post toward the middle.
    const offset = door.half / 2 + (1 - s) * door.half * 0.98
    if (left.current) {
      left.current.position.x = -offset
      left.current.visible = s > 0.02
    }
    if (right.current) {
      right.current.position.x = offset
      right.current.visible = s > 0.02
    }
    if (light.current) {
      const m = light.current.material as MeshStandardMaterial
      const blink = locked && Math.sin(performance.now() * 0.012) > 0
      m.color.set(locked ? (blink ? '#ff3b2f' : '#6b1a14') : '#7be08a')
      m.emissive.set(locked ? (blink ? '#ff3b2f' : '#000000') : '#4cc75e')
      m.emissiveIntensity = locked ? (blink ? 1.4 : 0) : 0.35
    }
  })

  return (
    <group position={[door.at[0], 0, door.at[1]]} rotation={[0, turn, 0]}>
      {[-1, 1].map((side) => (
        <mesh key={side} castShadow receiveShadow position={[side * (door.half + POST / 2), (WALL_HEIGHT + LINTEL) / 2, 0]}>
          <boxGeometry args={[POST, WALL_HEIGHT + LINTEL, DEPTH]} />
          <meshStandardMaterial color={FRAME_COLOR} roughness={0.7} />
        </mesh>
      ))}
      <mesh castShadow position={[0, WALL_HEIGHT + LINTEL / 2, 0]}>
        <boxGeometry args={[span + POST * 2, LINTEL, DEPTH]} />
        <meshStandardMaterial color={FRAME_COLOR} roughness={0.7} />
      </mesh>
      <mesh ref={light} position={[0, WALL_HEIGHT + LINTEL + 0.07, 0]} userData={GLOW}>
        <sphereGeometry args={[0.1, 12, 8]} />
        <meshStandardMaterial color="#7be08a" emissive="#4cc75e" emissiveIntensity={0.35} />
      </mesh>
      {[left, right].map((ref, i) => (
        <group key={i} ref={ref} visible={false}>
          <mesh castShadow position={[0, (WALL_HEIGHT * 0.96) / 2, 0]}>
            <boxGeometry args={[door.half, WALL_HEIGHT * 0.96, PANEL_THICK]} />
            <meshStandardMaterial map={texture} roughness={0.6} />
          </mesh>
        </group>
      ))}
    </group>
  )
}
