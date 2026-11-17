import { SPEEDS, useSim } from '../ui/store'
import { unlockAudio } from '../ui/sfx'
import { LOOKS, ROLE_TAG } from './fruitLooks'
import MindPanel from './MindPanel'

const PHASE_LABEL = { setup: 'Setting up', roam: 'Roaming', meeting: 'Meeting', over: 'Game over' } as const

/** Sim seconds as m:ss. */
function clock(seconds: number) {
  const s = Math.floor(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * The heads-up display. Milestone 1 keeps it to the essentials: phase and sim clock, pause and
 * speed, a new seed, and the roster with roles hidden until you ask. Reworked in milestone 10.
 */
export default function Hud() {
  const phase = useSim((s) => s.phase)
  const time = useSim((s) => s.time)
  const seed = useSim((s) => s.seed)
  const paused = useSim((s) => s.paused)
  const speed = useSim((s) => s.speed)
  const revealRoles = useSim((s) => s.revealRoles)
  const fruits = useSim((s) => s.fruits)
  const muted = useSim((s) => s.settings.muted)
  const bar = useSim((s) => s.taskBar)
  const card = useSim((s) => s.card)
  const selected = useSim((s) => s.selected)
  const cones = useSim((s) => s.cones)

  return (
    <>
      <header className="sign">
        <div className="plank">
          <span className="phase">{PHASE_LABEL[phase]}</span>
          <span className="clock">{clock(time)}</span>
        </div>
        <div className="taskbar" title={`${bar.done} of ${bar.total} tasks done`}>
          <i style={{ width: `${(bar.done / Math.max(1, bar.total)) * 100}%` }} />
          <span>Tasks</span>
        </div>
        <div className="controls">
          <button onClick={() => useSim.setState({ paused: !paused })}>{paused ? 'Resume' : 'Pause'}</button>
          <button onClick={() => useSim.setState({ speed: SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] })}>Speed {speed}x</button>
          <button onClick={() => useSim.setState({ revealRoles: !revealRoles })}>{revealRoles ? 'Hide roles' : 'Reveal roles'}</button>
          <button className={cones ? 'on' : ''} onClick={() => useSim.setState({ cones: !cones })}>
            Vision cones
          </button>
          <button
            onClick={() => {
              unlockAudio()
              useSim.getState().setSettings({ muted: !muted })
            }}
          >
            {muted ? 'Sound on' : 'Sound off'}
          </button>
          <button onClick={() => useSim.getState().newGame()}>New game</button>
        </div>
      </header>

      {card && (
        <div key={card.key} className={`phase-card${card.dark ? ' dark' : ''}`} aria-hidden="true">
          <span>{card.sub}</span>
          <h1>{card.title}</h1>
        </div>
      )}

      <aside className="panel roster">
        <h2>Fruits</h2>
        {fruits.map((f) => (
          <button key={f.id} className={`roster-row${f.alive ? '' : ' dead'}${f.id === selected ? ' on' : ''}`} onClick={() => useSim.getState().select(f.id === selected ? null : f.id)}>
            <span className="dot" style={{ background: LOOKS[f.kind].color }} />
            <span className="who">{f.name}</span>
            {(revealRoles || !f.alive) && <span className={`role ${f.role}`}>{ROLE_TAG[f.role]}</span>}
          </button>
        ))}
        <p className="hint">Tap a fruit to read its mind. Seed {seed}</p>
        <MindPanel />
      </aside>
    </>
  )
}
