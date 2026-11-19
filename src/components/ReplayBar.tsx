import { useState } from 'react'
import { clock } from '../sim/describe'
import { seek } from '../ui/replay'
import { useSim } from '../ui/store'

const ICON = { kill: '🔪', meeting: '📢', eject: '🧃' }
/** How many seconds before each moment a jump lands, so you see it coming. */
const LEAD = { kill: 4, meeting: 2, eject: 6 }

/**
 * The scrubber for a replay, with a marker above it for every kill, meeting and ejection. Dragging re-plays the same game headless up to that moment (it is
 * fully decided by its setup), then carries on live from there. A replay loaded from a log file
 * says at the end whether it matched the file exactly.
 */
export default function ReplayBar() {
  const replay = useSim((s) => s.replay)
  const time = useSim((s) => s.time)
  const [drag, setDrag] = useState<number | null>(null)
  if (!replay) return null
  const length = Math.max(replay.length, time)
  return (
    <div className="panel replay-bar">
      <b>Replay</b>
      <div className="replay-track">
        <input
          type="range"
          min={0}
          max={Math.ceil(length)}
          step={1}
          value={drag ?? Math.floor(time)}
          onChange={(e) => setDrag(Number(e.target.value))}
          onPointerUp={() => {
            if (drag !== null) void seek(drag)
            setDrag(null)
          }}
          onKeyUp={() => {
            if (drag !== null) void seek(drag)
            setDrag(null)
          }}
          aria-label="Replay position"
        />
        {/* Kills, meetings and ejections, to jump straight to (a moment before, to see it happen). */}
        <div className="replay-marks">
          {replay.marks.map((m, i) => (
            <button
              key={i}
              className={`mark ${m.kind}`}
              style={{ left: `${(m.t / Math.ceil(length)) * 100}%` }}
              title={`${clock(m.t)} · ${m.label}`}
              aria-label={`Jump to ${clock(m.t)}: ${m.label}`}
              onClick={() => void seek(Math.max(0, Math.floor(m.t) - LEAD[m.kind]))}
            >
              {ICON[m.kind]}
            </button>
          ))}
        </div>
      </div>
      <span className="clock-text">
        {clock(drag ?? time)} / {clock(length)}
      </span>
      {replay.verified !== undefined && <span className={`badge ${replay.verified ? 'ok' : 'bad'}`}>{replay.verified ? 'Matches the log' : 'Differs from the log'}</span>}
      <button onClick={() => useSim.setState({ replay: null })}>Leave replay</button>
    </div>
  )
}
