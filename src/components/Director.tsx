import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { MathUtils, Vector3 } from 'three'
import { AREAS, centre, ROOMS, TABLE } from '../sim/map'
import { currentGame, fruitPositions, useSim } from '../ui/store'

/** The Juicer's press, where ejected fruits go in. */
const JUICER_PRESS: [number, number] = [0, -17.6]

/** Distances from the camera to what it looks at, for each kind of shot. */
const WIDE = 62
const ROOM = 30
const CLOSE = 11
const TABLE_SHOT = 19
/** How long a kill, a body or a vent holds the camera, in real milliseconds at 1x. */
const HOLD_MS = { kill: 4200, body: 3500, vent: 2500 }
/** A kill: close in for this long, then pull back to show who might have seen it. */
const KILL_CLOSE_MS = 1500
/** Chats further than this from the current shot don't pull the camera over. */
const CHAT_PULL = 12

/**
 * The director: while it is on, the camera goes wherever the story is. In order of priority: a
 * kill (close in, then pull back to show who might have seen), a body being found, someone using
 * a vent, the meeting table and its speaker, a chat near the current shot, and otherwise a slow
 * drift over the busiest room. Turning it off gives free camera control.
 */
export default function Director() {
  const controls = useThree((s) => s.controls) as unknown as { target: Vector3; update(): void } | null
  const camera = useThree((s) => s.camera)
  const want = useMemo(() => new Vector3(), [])
  const offset = useMemo(() => new Vector3(), [])
  const busiest = useRef({ room: 'cafeteria', since: 0 })

  useFrame((_, delta) => {
    if (!controls) return
    const sim = useSim.getState()
    if (!sim.director || sim.screen !== 'game') return
    const now = performance.now()
    const speedUp = Math.sqrt(sim.speed)
    let distance = ROOM
    const game = currentGame()

    const shot = sim.shot
    const shotAge = shot ? (now - shot.since) * speedUp : Infinity
    if (shot && shotAge < HOLD_MS[shot.kind]) {
      want.set(shot.at[0], 1, shot.at[1])
      distance = shot.kind === 'kill' ? (shotAge < KILL_CLOSE_MS ? CLOSE * 0.8 : CLOSE * 1.6) : CLOSE
    } else if (sim.juicing) {
      // Into the Juicer: frame the press as it comes down.
      want.set(JUICER_PRESS[0], 1, JUICER_PRESS[1] + 2)
      distance = CLOSE * 1.2
    } else if (sim.party) {
      want.set(0, 1, 0)
      distance = 34
    } else if (game.phase === 'meeting' || sim.ejecting) {
      // The meeting: frame the table, leaning toward whoever is speaking (or being carried off).
      const who = sim.ejecting ?? sim.speaker
      const at = who ? fruitPositions.get(who) : undefined
      want.set(TABLE.at[0], 1, TABLE.at[1])
      if (at) want.lerp(at, sim.ejecting ? 0.8 : 0.35)
      distance = sim.ejecting ? CLOSE * 1.5 : TABLE_SHOT
      // Nearly there: settle on the press ahead of the jump.
      if (sim.ejecting && at && Math.hypot(at.x - JUICER_PRESS[0], at.z - JUICER_PRESS[1]) < 9) {
        want.set(JUICER_PRESS[0], 1, JUICER_PRESS[1] + 2)
        distance = CLOSE * 1.2
      }
    } else {
      // A chat close to the current shot draws the camera in.
      const speaking = Object.keys(sim.speech).filter((id) => sim.speech[id])
      const near = speaking
        .map((id) => fruitPositions.get(id))
        .filter((p): p is Vector3 => !!p && Math.hypot(p.x - controls.target.x, p.z - controls.target.z) < CHAT_PULL)[0]
      if (near) {
        want.set(near.x, 1, near.z)
        distance = CLOSE * 1.4
      } else {
        // Drift over the busiest room, switching rooms no more than every few seconds.
        const counts = new Map<string, number>()
        for (const f of game.fruits) if (f.alive) counts.set(f.area, (counts.get(f.area) ?? 0) + 1)
        const top = [...counts.entries()].filter(([id]) => ROOMS.some((r) => r.id === id)).sort((a, b) => b[1] - a[1])[0]
        if (top && top[0] !== busiest.current.room && now - busiest.current.since > 6000) busiest.current = { room: top[0], since: now }
        const room = AREAS.find((a) => a.id === busiest.current.room)!
        const c = centre(room.rect)
        want.set(c[0], 1, c[1])
        distance = ROOM
      }
    }
    if (game.phase === 'over' && !sim.party) distance = WIDE

    // Move what the camera looks at, and carry the camera along at the same angle.
    offset.subVectors(camera.position, controls.target)
    const length = MathUtils.damp(offset.length(), distance, 1.8, delta)
    controls.target.set(MathUtils.damp(controls.target.x, want.x, 2.2, delta), MathUtils.damp(controls.target.y, want.y, 2.2, delta), MathUtils.damp(controls.target.z, want.z, 2.2, delta))
    offset.normalize()
    camera.position.copy(controls.target).addScaledVector(offset, length)
    controls.update()
  })

  return null
}
