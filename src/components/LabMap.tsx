import { useLayoutEffect, useMemo, useRef } from 'react'
import { Text } from '@react-three/drei'
import { Object3D } from 'three'
import type { InstancedMesh } from 'three'
import fontUrl from '@fontsource/lilita-one/files/lilita-one-latin-400-normal.woff?url'
import { AREAS, centre, doorsOf, MELTDOWN_PANELS, ROOMS, VENTS, WALL_HEIGHT, WALLS } from '../sim/map'
import { useSim } from '../ui/store'
import MeetingTable from './MeetingTable'
import TaskStations from './TaskStation'

const WALL_THICKNESS = 0.32
const WALL_COLOR = '#ffffff'
const FLOOR_COLOR = '#f7f8fa'
const HALL_COLOR = '#eef1f5'
const LABEL_COLOR = '#c9d0da'

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

      {/* Room names painted on the floor, readable from the default camera. */}
      {ROOMS.map((r) => {
        const [x0, z0, x1] = r.rect
        const at = centre(r.rect)
        // The Cafeteria's table sits in the middle, so its name goes along the top edge.
        const z = r.id === 'cafeteria' ? z0 + 1.6 : at[1]
        return (
          <Text
            key={r.id}
            font={fontUrl}
            position={[at[0], 0.02, z]}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={Math.min(2.2, (x1 - x0) / (r.name.length * 0.55))}
            color={LABEL_COLOR}
            anchorX="center"
            anchorY="middle"
            maxWidth={x1 - x0 - 1}
            textAlign="center"
          >
            {r.name.toUpperCase()}
          </Text>
        )
      })}

      {VENTS.map((v) => (
        <group key={v.id} position={[v.at[0], 0.02, v.at[1]]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[1.3, 0.9]} />
            <meshStandardMaterial color="#8a939f" />
          </mesh>
          {[-0.3, -0.1, 0.1, 0.3].map((x) => (
            <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, x * 0.9]}>
              <planeGeometry args={[1.1, 0.07]} />
              <meshBasicMaterial color="#3d434b" />
            </mesh>
          ))}
        </group>
      ))}

      <MeetingTable />
      <TaskStations />
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
