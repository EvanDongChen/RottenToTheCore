import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferAttribute, BufferGeometry, Color, DoubleSide } from 'three'
import type { Mesh, MeshBasicMaterial } from 'three'
import { castRay } from '../sim/geom'
import { WALLS } from '../sim/map'
import { visionRadius } from '../sim/perception'
import { currentGame, simTargets, useSim } from '../ui/store'
import { LOOKS } from './fruitLooks'

/** Rays cast per fruit to find where its view is cut off by walls. */
const RAYS = 48
const HEIGHT = 0.03

/**
 * What each fruit can see, drawn on the floor: a fan of rays cut short by the walls. Shows only
 * the picked fruit if one is picked, otherwise every living fruit.
 */
export default function VisionCones() {
  const on = useSim((s) => s.cones && s.screen === 'game')
  const selected = useSim((s) => s.selected)
  const ids = useSim((s) => s.fruits.filter((f) => f.alive && (!s.selected || f.id === s.selected)).map((f) => f.id).join(','))
  if (!on) return null
  return (
    <>
      {ids
        .split(',')
        .filter(Boolean)
        .map((id) => (
          <Cone key={id} id={id} strong={!!selected} />
        ))}
    </>
  )
}

function Cone({ id, strong }: { id: string; strong: boolean }) {
  const mesh = useRef<Mesh>(null)
  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array((RAYS + 2) * 3), 3))
    const index: number[] = []
    for (let i = 1; i <= RAYS; i++) index.push(0, i, i + 1)
    g.setIndex(index)
    return g
  }, [])
  const kind = currentGame().fruits.find((f) => f.id === id)?.def.kind ?? 'apple'
  const color = useMemo(() => new Color(LOOKS[kind].color), [kind])
  const frame = useRef(0)

  useFrame(() => {
    // Every other frame is plenty for something this soft.
    if (frame.current++ % 2) return
    const game = currentGame()
    const f = game.fruits.find((x) => x.id === id)
    const at = simTargets.get(id)
    if (!f || !at || !mesh.current) return
    const radius = visionRadius(game, f)
    const pos = geometry.getAttribute('position') as BufferAttribute
    pos.setXYZ(0, at.x, HEIGHT, at.z)
    for (let i = 0; i <= RAYS; i++) {
      const angle = (i / RAYS) * Math.PI * 2
      const dx = Math.cos(angle)
      const dz = Math.sin(angle)
      const reach = castRay([at.x, at.z], dx, dz, radius, WALLS)
      pos.setXYZ(i + 1, at.x + dx * reach, HEIGHT, at.z + dz * reach)
    }
    pos.needsUpdate = true
    geometry.computeBoundingSphere()
    ;(mesh.current.material as MeshBasicMaterial).opacity = strong ? 0.22 : 0.1
  })

  return (
    <mesh ref={mesh} geometry={geometry} renderOrder={2}>
      <meshBasicMaterial color={color} transparent opacity={0.1} depthWrite={false} side={DoubleSide} />
    </mesh>
  )
}
