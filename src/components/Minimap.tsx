import { useEffect, useState } from 'react'
import { AREAS, BOUNDS, centre, FUSE_BOX, MELTDOWN_PANELS, TABLE, VENTS } from '../sim/map'
import type { Vec2 } from '../sim/types'
import { currentGame, simTargets, useSim } from '../ui/store'
import { LOOKS } from './fruitLooks'

/** Shorter names for rooms whose full name doesn't fit on the map. */
const SHORT: Record<string, string> = { ripening: 'Ripening', cold: 'Cold Storage', electrical: 'Electrical', greenhouse: 'Greenhouse', cafeteria: 'Cafeteria' }

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
  const lockedId = useSim((s) => s.lockedRoom)
  const lightsOut = useSim((s) => s.lightsOut)
  const meltdown = useSim((s) => s.meltdownAt !== null)
  const meeting = useSim((s) => s.phase === 'meeting')
  const locked = lockedId ? AREAS.find((a) => a.id === lockedId) : undefined
  return (
    <svg className="minimap panel" viewBox={`${x0} ${z0} ${x1 - x0} ${z1 - z0}`} role="img" aria-label="Map of the lab">
      {AREAS.map((a) => (
        <rect key={a.id} x={a.rect[0]} y={a.rect[1]} width={a.rect[2] - a.rect[0]} height={a.rect[3] - a.rect[1]} className={a.hallway ? 'hall' : 'room'} />
      ))}
      {/* Room names, small enough to sit inside each room. */}
      {AREAS.filter((a) => !a.hallway).map((a) => (
        <text key={`label-${a.id}`} x={(a.rect[0] + a.rect[2]) / 2} y={a.rect[1] + 2.4} className="room-label" textAnchor="middle">
          {SHORT[a.id] ?? a.name}
        </text>
      ))}
      {VENTS.map((v) => (
        <rect key={v.id} x={v.at[0] - 0.6} y={v.at[1] - 0.4} width={1.2} height={0.8} className="vent" />
      ))}
      {/* A locked room is outlined until its doors open. */}
      {locked && <rect x={locked.rect[0]} y={locked.rect[1]} width={locked.rect[2] - locked.rect[0]} height={locked.rect[3] - locked.rect[1]} className="locked-room" />}
      {game.bodies.map((b) => (
        <text key={`body-${b.id}`} x={b.pos[0]} y={b.pos[1] + 1} className="body-mark" textAnchor="middle">
          ✕
        </text>
      ))}
      {/* Pings: rings that keep spreading out from wherever something needs attention. */}
      {game.bodies.map((b) => (
        <Ping key={`ping-body-${b.id}`} at={b.pos} kind="body" />
      ))}
      {lightsOut && <Ping at={FUSE_BOX} kind="sabotage" />}
      {meltdown && MELTDOWN_PANELS.map((p, i) => <Ping key={`melt-${i}`} at={p} kind="body" />)}
      {locked && <Ping at={centre(locked.rect)} kind="sabotage" />}
      {meeting && <Ping at={TABLE.at} kind="meeting" />}
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

/** Two rings spreading out from a spot, half a beat apart. */
function Ping({ at, kind }: { at: Vec2; kind: 'body' | 'sabotage' | 'meeting' }) {
  return (
    <g className={`ping ${kind}`}>
      <circle cx={at[0]} cy={at[1]} r={2.2} />
      <circle cx={at[0]} cy={at[1]} r={2.2} />
    </g>
  )
}
