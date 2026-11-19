import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { BufferAttribute, BufferGeometry, DoubleSide } from 'three'
import type { Group, Mesh } from 'three'
import { fruitPositions, useSim } from '../ui/store'
import { LOOKS } from './fruitLooks'

const CLEAR = 0.8 // how far from a fruit's middle an arrow starts and stops
const HEAD = 0.6
const HEIGHT = 0.05
/** Arrows below this are not drawn: just the prior, no real suspicion. */
const SHOW_ABOVE = 0.35

interface Edge {
  from: string
  to: string
  belief: number
  color: string
}

/**
 * Suspicion drawn on the floor: an arrow from each fruit to the one it suspects most (or, with a
 * fruit picked, to everyone it suspects), thicker the surer it is, with the percentage on a tag.
 * A Rotten's beliefs are the truth, so its arrows only show once roles are revealed.
 */
export default function SuspicionArrows() {
  const on = useSim((s) => s.arrows && s.screen === 'game' && !s.party)
  const fruits = useSim((s) => s.fruits)
  const picked = useSim((s) => s.selected)
  const reveal = useSim((s) => s.revealRoles)
  if (!on) return null
  const living = fruits.filter((f) => f.alive)
  const edges: Edge[] = []
  for (const a of living) {
    if (a.role === 'rotten' && !reveal) continue
    const others = living.filter((b) => b.id !== a.id && (a.beliefs[b.id] ?? 0) >= SHOW_ABOVE)
    const top = others.sort((x, y) => a.beliefs[y.id] - a.beliefs[x.id])
    const chosen = picked ? (a.id === picked ? top : top.filter((b) => b.id === picked)) : top.slice(0, 1)
    for (const b of chosen) edges.push({ from: a.id, to: b.id, belief: a.beliefs[b.id], color: LOOKS[a.kind].color })
  }
  return (
    <>
      {edges.map((e) => (
        <Arrow key={`${e.from}>${e.to}`} edge={e} />
      ))}
    </>
  )
}

function Arrow({ edge }: { edge: Edge }) {
  const mesh = useRef<Mesh>(null)
  const tag = useRef<Group>(null)
  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(7 * 3), 3))
    g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6])
    return g
  }, [])
  const width = 0.08 + edge.belief * 0.22

  useFrame(() => {
    const a = fruitPositions.get(edge.from)
    const b = fruitPositions.get(edge.to)
    if (!a || !b || !mesh.current) return
    const dx = b.x - a.x
    const dz = b.z - a.z
    const d = Math.hypot(dx, dz)
    mesh.current.visible = d > CLEAR * 2 + HEAD
    if (!mesh.current.visible) return
    const ux = dx / d
    const uz = dz / d
    const px = -uz
    const pz = ux
    const sx = a.x + ux * CLEAR
    const sz = a.z + uz * CLEAR
    const ex = b.x - ux * (CLEAR + HEAD)
    const ez = b.z - uz * (CLEAR + HEAD)
    const tipX = b.x - ux * CLEAR
    const tipZ = b.z - uz * CLEAR
    const pos = geometry.getAttribute('position') as BufferAttribute
    const w = width / 2
    pos.setXYZ(0, sx + px * w * 0.4, HEIGHT, sz + pz * w * 0.4)
    pos.setXYZ(1, ex + px * w, HEIGHT, ez + pz * w)
    pos.setXYZ(2, ex - px * w, HEIGHT, ez - pz * w)
    pos.setXYZ(3, sx - px * w * 0.4, HEIGHT, sz - pz * w * 0.4)
    pos.setXYZ(4, ex + px * w * 2.4, HEIGHT, ez + pz * w * 2.4)
    pos.setXYZ(5, tipX, HEIGHT, tipZ)
    pos.setXYZ(6, ex - px * w * 2.4, HEIGHT, ez - pz * w * 2.4)
    pos.needsUpdate = true
    geometry.computeBoundingSphere()
    tag.current?.position.set((sx + ex) / 2, 0.3, (sz + ez) / 2)
  })

  return (
    <>
      <mesh ref={mesh} geometry={geometry} renderOrder={3}>
        <meshBasicMaterial color={edge.color} transparent opacity={0.85} depthWrite={false} side={DoubleSide} />
      </mesh>
      <group ref={tag}>
        <Html center zIndexRange={[8, 0]}>
          <div className="arrow-tag">{Math.round(edge.belief * 100)}%</div>
        </Html>
      </group>
    </>
  )
}
