import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { AdditiveBlending, CanvasTexture, Color, Vector3 } from 'three'
import type { Material, Mesh, Object3D, Sprite } from 'three'
import { useSim } from '../ui/store'

/** Put this on a mesh's `userData` to give it a soft glow. */
export const GLOW = { glow: true }

/** Most glowing things at once. */
const MOST = 96
/** How often to look for glowing meshes that came or went, in real ms. */
const RESCAN_MS = 1000

/** A soft white dot fading out to nothing, shared by every glow. */
function haloTexture(): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return new CanvasTexture(c)
}

/** Is this object, and everything above it, shown? */
function shown(o: Object3D): boolean {
  for (let x: Object3D | null = o; x; x = x.parent) if (!x.visible) return false
  return true
}

/**
 * A cheap bloom: every mesh marked with `GLOW` gets a soft additive halo in its own light's
 * colour, as bright as the light is right now (screens flicker, fuse lights blink, the door
 * lights go red). No post-processing pass, so it costs almost nothing; it can still be turned off.
 */
export default function Glows() {
  const scene = useThree((s) => s.scene)
  const texture = useMemo(haloTexture, [])
  const sprites = useRef<(Sprite | null)[]>([])
  const found = useRef<Mesh[]>([])
  const scanned = useRef(-Infinity)
  const at = useMemo(() => new Vector3(), [])
  const size = useMemo(() => new Vector3(), [])
  const color = useMemo(() => new Color(), [])

  useFrame(() => {
    const on = useSim.getState().glow
    const now = performance.now()
    if (on && now - scanned.current > RESCAN_MS) {
      scanned.current = now
      const list: Mesh[] = []
      scene.traverse((o) => {
        if ((o as Mesh).isMesh && o.userData.glow && list.length < MOST) list.push(o as Mesh)
      })
      found.current = list
    }
    sprites.current.forEach((s, i) => {
      if (!s) return
      const mesh = on ? found.current[i] : undefined
      if (!mesh || !shown(mesh)) {
        s.visible = false
        return
      }
      // Its light right now: the emissive colour for lit materials, the plain colour for unlit ones.
      const m = mesh.material as Material & { emissive?: Color; emissiveIntensity?: number; color?: Color }
      if (m.emissive && m.emissiveIntensity !== undefined) color.copy(m.emissive).multiplyScalar(m.emissiveIntensity)
      else if (m.color) color.copy(m.color)
      const bright = Math.max(color.r, color.g, color.b)
      s.visible = bright > 0.08
      if (!s.visible) return
      mesh.getWorldPosition(at)
      mesh.getWorldScale(size)
      if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere()
      const r = (mesh.geometry.boundingSphere?.radius ?? 0.2) * Math.max(size.x, size.y, size.z)
      s.position.copy(at)
      s.scale.setScalar(0.5 + r * 2.6)
      const mat = s.material
      mat.color.copy(color).multiplyScalar(1 / Math.max(bright, 0.001))
      mat.opacity = Math.min(0.75, bright * 0.8)
    })
  })

  return (
    <>
      {Array.from({ length: MOST }, (_, i) => (
        <sprite key={i} ref={(s) => void (sprites.current[i] = s)} visible={false} renderOrder={5}>
          <spriteMaterial map={texture} blending={AdditiveBlending} transparent depthWrite={false} toneMapped={false} />
        </sprite>
      ))}
    </>
  )
}
