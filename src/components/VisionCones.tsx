import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferAttribute, BufferGeometry, Color, DoubleSide } from 'three'
import type { Mesh } from 'three'
import { castRay } from '../sim/geom'
import { WALLS } from '../sim/map'
import { visionRadius } from '../sim/perception'
import { currentGame, simTargets, useSim } from '../ui/store'
import { LOOKS } from './fruitLooks'

/** Rays cast per fruit to find where its view is cut off by walls. */
const RAYS = 48
const HEIGHT = 0.03

/**
 * What each fruit can see, drawn on the floor: a fan of rays cut short by the walls, fading out
 * toward the edge of sight. It turns red while the fruit can see a body, and amber while it has
 * its top suspect in view. Shows only the picked fruit if one is picked, otherwise every living fruit.
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
  // A centre point, then for every ray a point part-way out and one at the end of the ray.
  // Each vertex has its own alpha, so the view fades out toward the edge of sight.
  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    const count = 1 + (RAYS + 1) * 2
    g.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3))
    g.setAttribute('color', new BufferAttribute(new Float32Array(count * 4), 4))
    const index: number[] = []
    for (let i = 0; i < RAYS; i++) {
      const [m, o, m2, o2] = [1 + i * 2, 2 + i * 2, 3 + i * 2, 4 + i * 2]
      index.push(0, m, m2, m, o, o2, m, o2, m2)
    }
    g.setIndex(index)
    return g
  }, [])
  const kind = currentGame().fruits.find((f) => f.id === id)?.def.kind ?? 'apple'
  const own = useMemo(() => new Color(LOOKS[kind].color), [kind])
  const tint = useMemo(() => new Color(), [])
  const frame = useRef(0)

  useFrame(() => {
    // Every other frame is plenty for something this soft.
    if (frame.current++ % 2) return
    const game = currentGame()
    const f = game.fruits.find((x) => x.id === id)
    const at = simTargets.get(id)
    if (!f || !at || !mesh.current) return
    const radius = visionRadius(game, f)

    // What's in view decides the colour: a body is an alarm, the fruit's top suspect a warning.
    const now = performance.now()
    const body = (game.vision.bodies.get(id)?.length ?? 0) > 0
    const suspect = useSim.getState().fruits.find((x) => x.id === id)?.suspect
    const watching = !!suspect && game.vision.sees.get(id)?.has(suspect)
    const pulse = 0.5 + Math.sin(now * 0.012) * 0.5
    if (body) tint.set(ALARM).lerp(own, 0.15 * pulse)
    else if (watching) tint.set(WARY)
    else tint.copy(own)
    const peak = (strong ? 0.26 : 0.12) * (body ? 1.6 + pulse * 0.6 : watching ? 1.4 : 1)

    const pos = geometry.getAttribute('position') as BufferAttribute
    const col = geometry.getAttribute('color') as BufferAttribute
    pos.setXYZ(0, at.x, HEIGHT, at.z)
    col.setXYZW(0, tint.r, tint.g, tint.b, peak)
    for (let i = 0; i <= RAYS; i++) {
      const angle = (i / RAYS) * Math.PI * 2
      const dx = Math.cos(angle)
      const dz = Math.sin(angle)
      const reach = castRay([at.x, at.z], dx, dz, radius, WALLS)
      const mid = Math.min(reach, radius * FADE_FROM)
      pos.setXYZ(1 + i * 2, at.x + dx * mid, HEIGHT, at.z + dz * mid)
      pos.setXYZ(2 + i * 2, at.x + dx * reach, HEIGHT, at.z + dz * reach)
      // Out in the open the view fades to nothing; stopped by a wall it ends with a firmer edge.
      const edge = reach >= radius - 0.01 ? 0 : peak * (0.35 + 0.65 * (1 - reach / radius))
      col.setXYZW(1 + i * 2, tint.r, tint.g, tint.b, peak)
      col.setXYZW(2 + i * 2, tint.r, tint.g, tint.b, edge)
    }
    pos.needsUpdate = true
    col.needsUpdate = true
    geometry.computeBoundingSphere()
  })

  return (
    <mesh ref={mesh} geometry={geometry} renderOrder={2}>
      <meshBasicMaterial vertexColors transparent depthWrite={false} side={DoubleSide} />
    </mesh>
  )
}

/** Share of the way out at which the view starts to fade. */
const FADE_FROM = 0.55
/** Seeing a body, and seeing the fruit it suspects most. */
const ALARM = '#ff3b2f'
const WARY = '#ffb03a'
