import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { clock } from '../sim/describe'
import { unlockAudio } from '../ui/sfx'
import { SPEEDS, useSim } from '../ui/store'
import type { SimState } from '../ui/store'
import { LOOKS, ROLE_TAG } from './fruitLooks'
import LogPanel from './LogPanel'
import MindPanel from './MindPanel'
import Minimap from './Minimap'
import Recap from './Recap'
import ReplayBar from './ReplayBar'

const PHASE_LABEL = { setup: 'Setting up', roam: 'Roaming', meeting: 'Meeting', over: 'Game over' } as const

type Toggle = 'director' | 'cones' | 'arrows' | 'showThoughts' | 'revealRoles'
const VIEWS: { key: Toggle; label: string; hint: string }[] = [
  { key: 'director', label: 'Director camera', hint: 'The camera follows the story by itself' },
  { key: 'cones', label: 'Vision cones', hint: 'What each fruit can see, cut off by walls' },
  { key: 'arrows', label: 'Suspicion arrows', hint: 'Who suspects whom, drawn on the floor' },
  { key: 'showThoughts', label: 'Thoughts', hint: "Every fruit's private thought over its head" },
  { key: 'revealRoles', label: 'Reveal roles', hint: 'Spoilers: show who is Rotten' },
]

/**
 * The heads-up display: phase, sim clock and task bar at the top with pause, speed and the View
 * menu; the minimap, the roster and the picked fruit's mind on the right; the log at the bottom
 * left; the replay scrubber; and the recap when the game ends.
 */
export default function Hud() {
  const phase = useSim((s) => s.phase)
  const time = useSim((s) => s.time)
  const paused = useSim((s) => s.paused)
  const speed = useSim((s) => s.speed)
  const fruits = useSim((s) => s.fruits)
  const muted = useSim((s) => s.settings.muted)
  const bar = useSim((s) => s.taskBar)
  const card = useSim((s) => s.card)
  const selected = useSim((s) => s.selected)
  const revealRoles = useSim((s) => s.revealRoles)
  const votes = useSim((s) => s.votes)
  const problem = useSim((s) => s.problem)
  const views = useSim(useShallow((s) => Object.fromEntries(VIEWS.map((v) => [v.key, s[v.key]])) as Record<Toggle, boolean>))
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close the View menu on a click anywhere else.
  useEffect(() => {
    if (!menu) return
    const close = (e: PointerEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menu])

  // Space pauses, number keys pick a speed.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return
      if (e.code === 'Space') {
        e.preventDefault()
        useSim.setState((s) => ({ paused: !s.paused }))
      }
      const n = Number(e.key)
      if (n >= 1 && n <= SPEEDS.length) useSim.setState({ speed: SPEEDS[n - 1] })
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  const voteCount = (id: string) => Object.values(votes).filter((v) => v === id).length

  return (
    <>
      <header className="sign">
        <div className="plank">
          <span className="phase">{PHASE_LABEL[phase]}</span>
          <span className="clock">{clock(time)}</span>
        </div>
        <div className="taskbar" title={`${bar.done} of ${bar.total} tasks done`}>
          <i style={{ width: `${(bar.done / Math.max(1, bar.total)) * 100}%` }} />
          <span>
            Tasks {bar.done}/{bar.total}
          </span>
        </div>
        <div className="controls">
          <button onClick={() => useSim.setState({ paused: !paused })}>{paused ? 'Resume' : 'Pause'}</button>
          <div className="segmented speeds">
            {SPEEDS.map((n) => (
              <button key={n} className={speed === n ? 'on' : ''} onClick={() => useSim.setState({ speed: n })}>
                {n}x
              </button>
            ))}
          </div>
          <div className="menu" ref={menuRef}>
            <button className={menu ? 'on' : ''} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
              View
              <span className="count">{Object.values(views).filter(Boolean).length}</span>
            </button>
            {menu && (
              <div className="menu-list" role="menu">
                {VIEWS.map((v) => (
                  <button key={v.key} role="menuitemcheckbox" aria-checked={views[v.key]} className={`menu-item${views[v.key] ? ' on' : ''}`} onClick={() => useSim.setState({ [v.key]: !views[v.key] } as Partial<SimState>)}>
                    <i className="tick" />
                    <span>
                      <b>{v.label}</b>
                      <small>{v.hint}</small>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => {
              unlockAudio()
              useSim.getState().setSettings({ muted: !muted })
            }}
          >
            {muted ? 'Sound on' : 'Sound off'}
          </button>
          <button className="danger" onClick={() => useSim.getState().toSetup()}>
            Setup
          </button>
        </div>
      </header>

      {card && (
        <div key={card.key} className={`phase-card${card.dark ? ' dark' : ''}`} aria-hidden="true">
          <span>{card.sub}</span>
          <h1>{card.title}</h1>
        </div>
      )}

      <div className="right-column">
        <Minimap />
        <aside className="panel roster">
          <h2>Fruits</h2>
          {fruits.map((f) => (
            <button key={f.id} className={`roster-row${f.alive ? '' : ' dead'}${f.id === selected ? ' on' : ''}`} onClick={() => useSim.getState().select(f.id === selected ? null : f.id)}>
              <span className="dot" style={{ background: LOOKS[f.kind].color }} />
              <span className="who">{f.name}</span>
              {(revealRoles || !f.alive) && <span className={`role ${f.role}`}>{ROLE_TAG[f.role]}</span>}
              {voteCount(f.id) > 0 && <span className="votes">{'✗'.repeat(voteCount(f.id))}</span>}
            </button>
          ))}
          <p className="hint">Tap a fruit to read its mind. Space pauses; 1 to 4 set the speed.</p>
          <MindPanel />
        </aside>
      </div>

      <LogPanel />
      <ReplayBar />
      {problem && (
        <div className="panel toast" role="status">
          {problem}
          <button onClick={() => useSim.setState({ problem: null })} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      <Recap />
    </>
  )
}
