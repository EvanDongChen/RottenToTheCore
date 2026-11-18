import { useEffect, useState } from 'react'
import { AREAS, BOUNDS, VENTS } from '../sim/map'
import { currentGame, simTargets, useSim } from '../ui/store'
import { LOOKS } from './fruitLooks'

/** How often the dots move, in real milliseconds. Smooth enough for a map this small. */
const REFRESH_MS = 120

/**
 * The lab from above as a flat map, with a dot for every fruit. A spectator sees everyone:
 * the Rotten are outlined once roles are revealed, the dead are crosses. Click a dot to pick it.
 */
export default function Minimap() {
  const fruits = useSim((s) => s.fruits)
  const selected = useSim((s) => s.selected)
  const reveal = useSim((s) => s.revealRoles)
  const [, setTick] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), REFRESH_MS)
    return () => clearInterval(timer)
  }, [])

  const [x0, z0, x1, z1] = BOUNDS
  const game = currentGame()
  return (
    <svg className="minimap panel" viewBox={`${x0} ${z0} ${x1 - x0} ${z1 - z0}`} role="img" aria-label="Map of the lab">
      {AREAS.map((a) => (
        <rect key={a.id} x={a.rect[0]} y={a.rect[1]} width={a.rect[2] - a.rect[0]} height={a.rect[3] - a.rect[1]} className={a.hallway ? 'hall' : 'room'} />
      ))}
      {VENTS.map((v) => (
        <rect key={v.id} x={v.at[0] - 0.6} y={v.at[1] - 0.4} width={1.2} height={0.8} className="vent" />
      ))}
      {game.bodies.map((b) => (
        <text key={`body-${b.id}`} x={b.pos[0]} y={b.pos[1] + 1} className="body-mark" textAnchor="middle">
          ✕
        </text>
      ))}
      {fruits.map((f) => {
        const at = simTargets.get(f.id)
        if (!at || !f.alive) return null
        return (
          <circle
            key={f.id}
            cx={at.x}
            cy={at.z}
            r={f.id === selected ? 1.5 : 1.1}
            fill={LOOKS[f.kind].color}
            className={`dot-mark${reveal && f.role === 'rotten' ? ' rotten' : ''}${f.id === selected ? ' on' : ''}`}
            onClick={() => useSim.getState().select(f.id === selected ? null : f.id)}
          >
            <title>{f.name}</title>
          </circle>
        )
      })}
    </svg>
  )
}
