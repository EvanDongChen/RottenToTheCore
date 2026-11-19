import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { MathUtils, Vector3 } from 'three'
import { currentGame, fruitPositions, useSim } from '../ui/store'

/** How dark the lab gets outside every fruit's light, 0..1. */
const DARK = 0.84
/** The mask is drawn at this share of screen resolution: it is all soft edges anyway. */
const SCALE = 0.5

/**
 * Lights out: darkness everywhere except a soft pool of light round each fruit, as far as it can
 * see. Crew see only a little way. With roles revealed, the Rotten's pools stay wide, because the
 * dark doesn't slow them down. It is a flat 2D layer over the 3D lab, under the name tags, faded
 * in and out with the lights.
 */
export default function LightsOutMask() {
  const gl = useThree((s) => s.gl)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const level = useRef(0)
  const p = useRef(new Vector3())
  const q = useRef(new Vector3())
  const right = useRef(new Vector3())

  useEffect(() => {
    const el = document.createElement('canvas')
    el.className = 'lights-mask'
    gl.domElement.insertAdjacentElement('afterend', el)
    canvas.current = el
    return () => el.remove()
  }, [gl])

  useFrame(({ camera, size }, delta) => {
    const el = canvas.current
    if (!el) return
    const st = useSim.getState()
    const on = st.lightsOut && st.screen === 'game'
    level.current = MathUtils.damp(level.current, on ? 1 : 0, on ? 2.5 : 4, delta)
    if (level.current < 0.01) {
      if (el.style.display !== 'none') el.style.display = 'none'
      return
    }
    el.style.display = ''
    const w = Math.round(size.width * SCALE)
    const h = Math.round(size.height * SCALE)
    if (el.width !== w || el.height !== h) {
      el.width = w
      el.height = h
    }
    const ctx = el.getContext('2d')!
    ctx.globalCompositeOperation = 'source-over'
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = `rgba(8, 10, 26, ${DARK * level.current})`
    ctx.fillRect(0, 0, w, h)
    // Cut a soft hole of light round every living fruit.
    ctx.globalCompositeOperation = 'destination-out'
    const game = currentGame()
    right.current.setFromMatrixColumn(camera.matrixWorld, 0)
    for (const f of game.fruits) {
      if (!f.alive) continue
      const at = fruitPositions.get(f.id)
      if (!at) continue
      const rotten = f.role === 'rotten' && st.revealRoles
      const reach = rotten ? game.rules.rottenVision : game.rules.lightsOutVision
      // Screen position, and how many pixels the fruit's vision covers at that distance.
      p.current.copy(at).setY(0.5).project(camera)
      q.current.copy(at).setY(0.5).addScaledVector(right.current, reach).project(camera)
      const x = ((p.current.x + 1) / 2) * w
      const y = ((1 - p.current.y) / 2) * h
      const r = Math.hypot(((q.current.x - p.current.x) / 2) * w, ((q.current.y - p.current.y) / 2) * h)
      if (p.current.z > 1 || r < 1) continue
      const g = ctx.createRadialGradient(x, y, r * 0.35, x, y, r)
      g.addColorStop(0, 'rgba(0,0,0,1)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
  })

  return null
}
