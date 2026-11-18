import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { Text } from '@react-three/drei'
import { Object3D } from 'three'
import type { InstancedMesh } from 'three'
import fontUrl from '@fontsource/lilita-one/files/lilita-one-latin-400-normal.woff?url'
import { AREAS, centre, doorsOf, MELTDOWN_PANELS, ROOMS, TABLE, VENTS, WALL_HEIGHT, WALLS } from '../sim/map'
import type { Vec2 } from '../sim/types'
import { puff } from './Dust'
import { useSim } from '../ui/store'
import MeetingTable from './MeetingTable'
import Ballots from './Ballots'
import BodyFlies from './BodyFlies'
import TaskStations, { PROP_SPOTS } from './TaskStation'
import TaskTools from './TaskTools'

const WALL_THICKNESS = 0.32
const WALL_COLOR = '#ffffff'
const FLOOR_COLOR = '#f7f8fa'
const HALL_COLOR = '#eef1f5'
const LABEL_COLOR = '#8f9aab'

/**
 * The lab drawn from the map data: one instanced mesh of white wall boxes, a pale floor tile per
 * room and hallway, room names painted big on the floor, and the vents. Walls are drawn only:
 * the sim keeps fruits out of them, not physics.
 */
export default function LabMap() {
  const walls = useRef<InstancedMesh>(null)

  useLayoutEffect(() => {
    const mesh = walls.current
    if (!mesh) return
    const dummy = new Object3D()
    WALLS.forEach(([x0, z0, x1, z1], i) => {
      const length = Math.hypot(x1 - x0, z1 - z0)
      dummy.position.set((x0 + x1) / 2, WALL_HEIGHT / 2, (z0 + z1) / 2)
      dummy.rotation.set(0, -Math.atan2(z1 - z0, x1 - x0), 0)
      // A little longer than the segment so corners close up.
      dummy.scale.set(length + WALL_THICKNESS, WALL_HEIGHT, WALL_THICKNESS)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
  }, [])

  const labels = useMemo(placeLabels, [])

  const tiles = useMemo(
    () =>
      AREAS.map((a) => {
        const [x0, z0, x1, z1] = a.rect
        return { id: a.id, hall: !!a.hallway, at: centre(a.rect), size: [x1 - x0, z1 - z0] as [number, number] }
      }),
    [],
  )

  return (
    <group>
      <instancedMesh ref={walls} args={[undefined, undefined, WALLS.length]} castShadow receiveShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={WALL_COLOR} roughness={0.85} />
      </instancedMesh>

      {tiles.map((t) => (
        <mesh key={t.id} rotation={[-Math.PI / 2, 0, 0]} position={[t.at[0], 0.004, t.at[1]]} receiveShadow>
          <planeGeometry args={t.size} />
          <meshStandardMaterial color={t.hall ? HALL_COLOR : FLOOR_COLOR} roughness={1} />
        </mesh>
      ))}

      {/* Room names painted on the floor, sized to fit and placed clear of the props. */}
      {labels.map((l) => (
        <Text
          key={l.id}
          font={fontUrl}
          position={[l.at[0], 0.02, l.at[1]]}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={l.size}
          color={LABEL_COLOR}
          outlineWidth={l.size * 0.04}
          outlineColor="#ffffff"
          anchorX="center"
          anchorY="middle"
          textAlign="center"
          letterSpacing={0.02}
        >
          {l.text}
        </Text>
      ))}

      {VENTS.map((v) => (
        <VentHatch key={v.id} id={v.id} at={v.at} />
      ))}

      <MeetingTable />
      <Ballots />
      <BodyFlies />
      <TaskStations />
      <TaskTools />
      <LockedDoors />
      <MeltdownPanels />
    </group>
  )
}

/** Red bars across the doorways of a room the Rotten have locked. */
function LockedDoors() {
  const room = useSim((s) => s.lockedRoom)
  if (!room) return null
  return (
    <>
      {doorsOf(room).map((d) => (
        <mesh key={d.id} position={[d.at[0], WALL_HEIGHT / 2, d.at[1]]} rotation={[0, d.along[0] ? 0 : Math.PI / 2, 0]} castShadow>
          <boxGeometry args={[d.half * 2, WALL_HEIGHT * 0.9, 0.25]} />
          <meshStandardMaterial color="#e2412f" />
        </mesh>
      ))}
    </>
  )
}

/** The two meltdown panels in the Ripening Chamber, glowing red while a meltdown is on. Shown only with the rule. */
function MeltdownPanels() {
  const on = useSim((s) => s.settings.rules.meltdown || s.meltdownAt !== null)
  const hot = useSim((s) => s.meltdownAt !== null)
  if (!on) return null
  return (
    <>
      {MELTDOWN_PANELS.map((p, i) => (
        <mesh key={i} position={[p[0], 0.03, p[1]]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.8, 24]} />
          <meshBasicMaterial color={hot ? '#ff3b2f' : '#f6b62e'} transparent opacity={hot ? 0.85 : 0.5} />
        </mesh>
      ))}
    </>
  )
}

/** Roughly how wide each letter of the label font is, as a share of its size. */
const LETTER = 0.62

/**
 * Where each room's name goes: of a few spots in the room (the middle, toward each wall), the one
 * furthest from every prop, station and vent, so nothing covers it. Sized to fit the room's width.
 */
function placeLabels() {
  const obstacles: Vec2[] = [...PROP_SPOTS, ...VENTS.map((v) => v.at), TABLE.at]
  return ROOMS.map((r) => {
    const [x0, z0, x1, z1] = r.rect
    const [cx, cz] = centre(r.rect)
    const text = r.name.toUpperCase()
    // Two lines for long names (Ripening Chamber, Cold Storage) so they can be bigger.
    const words = text.split(' ')
    const lines = words.length > 1 && text.length > 11 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : [text]
    const longest = Math.max(...lines.map((l) => l.length))
    const size = Math.min(2, (x1 - x0 - 2) / (longest * LETTER), (z1 - z0 - 3) / (lines.length * 1.25))
    const halfH = (lines.length * size * 1.2) / 2
    const candidates: Vec2[] = [
      [cx, cz],
      [cx, z0 + halfH + 1],
      [cx, z1 - halfH - 1],
      [cx, cz - (z1 - z0) / 5],
      [cx, cz + (z1 - z0) / 5],
    ]
    // Score a spot by its clearance from the nearest thing, measured over the label's width.
    const halfW = (longest * size * LETTER) / 2
    const clearance = (p: Vec2) =>
      Math.min(...obstacles.filter((o) => o[0] >= x0 && o[0] <= x1 && o[1] >= z0 && o[1] <= z1).map((o) => {
        const dx = Math.max(0, Math.abs(o[0] - p[0]) - halfW)
        const dz = Math.max(0, Math.abs(o[1] - p[1]) - halfH)
        return Math.hypot(dx, dz)
      }), 99)
    const best = candidates.reduce((a, b) => (clearance(b) > clearance(a) + 0.3 ? b : a))
    return { id: r.id, text: lines.join('\n'), at: best, size }
  })
}

/** How long a hatch stays open, in real milliseconds. */
const HATCH_OPEN_MS = 900

/** A vent hatch in the floor. Its lid pops open (with a puff of dust) when someone goes in or comes out. */
function VentHatch({ id, at }: { id: string; at: Vec2 }) {
  const lid = useRef<Group>(null)
  const puffed = useRef(0)
  useFrame(() => {
    const when = useSim.getState().vents[id]
    if (!lid.current) return
    const age = when === undefined ? Infinity : performance.now() - when
    const open = age >= 0 && age < HATCH_OPEN_MS
    if (open && puffed.current !== when) {
      puffed.current = when!
      puff(at[0], at[1], 1.1)
    }
    // Flip up fast, hang open, then drop shut with a little bounce.
    const t = open ? age / HATCH_OPEN_MS : 1
    const angle = t < 0.15 ? (t / 0.15) * 1.9 : t < 0.7 ? 1.9 : Math.max(0, 1.9 * (1 - (t - 0.7) / 0.3)) + (t > 0.95 ? Math.sin(t * 60) * 0.05 : 0)
    lid.current.rotation.x = -angle
  })
  return (
    <group position={[at[0], 0.02, at[1]]}>
      {/* The dark hole under the lid. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.3, 0.9]} />
        <meshBasicMaterial color="#1d2126" />
      </mesh>
      {/* The lid, hinged along its far edge. */}
      <group ref={lid} position={[0, 0.01, -0.45]}>
        <group position={[0, 0, 0.45]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} castShadow>
            <boxGeometry args={[1.3, 0.9, 0.06]} />
            <meshStandardMaterial color="#8a939f" />
          </mesh>
          {[-0.3, -0.1, 0.1, 0.3].map((x) => (
            <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.035, x * 0.9]}>
              <planeGeometry args={[1.1, 0.07]} />
              <meshBasicMaterial color="#3d434b" />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  )
}

