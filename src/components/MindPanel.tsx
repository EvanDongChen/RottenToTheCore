import { useMemo } from 'react'
import { clock, describeSighting, SIGHTING_ICON } from '../sim/describe'
import { nameOf } from '../sim/engine'
import { placeName, station } from '../sim/map'
import { confidence, recall } from '../sim/memory'
import { MOODS, TEMPERS } from '../sim/mind'
import { currentGame, useSim } from '../ui/store'
import { LOOKS, ROLE_TAG } from './fruitLooks'
import RichText from './RichText'

/** How many memories the reel shows, newest first. */
const REEL_LENGTH = 40

/**
 * The selected fruit's mind: what it is thinking, who it suspects, how it feels, its tasks, and
 * the memory reel. The reel shows its memories as it believes them, fading as confidence drops,
 * with bent ones marked so the viewer can see when a fruit is about to be wrong.
 */
export default function MindPanel() {
  const id = useSim((s) => s.selected)
  // Re-read the game a couple of times a sim second.
  const time = useSim((s) => s.time)
  const reveal = useSim((s) => s.revealRoles)
  const fruit = useSim((s) => s.fruits.find((f) => f.id === id))

  const data = useMemo(() => {
    const game = currentGame()
    const f = game.fruits.find((x) => x.id === id)
    if (!f) return null
    const n = (other: string) => nameOf(game, other)
    const reel = [...f.memory]
      .sort((a, b) => b.to - a.to)
      .slice(0, REEL_LENGTH)
      .map((m) => {
        const believed = recall(m)
        return {
          id: m.id,
          icon: SIGHTING_ICON[m.kind],
          text: describeSighting(believed, n),
          c: confidence(m, game.time),
          truth: m.recalled ? describeSighting(m, n) : null,
        }
      })
    const beliefs = Object.entries(f.mind.beliefs)
      .filter(([other]) => game.fruits.find((o) => o.id === other)?.alive)
      .sort((a, b) => b[1] - a[1])
    return {
      reel,
      beliefs,
      tasks: f.tasks.map((t) => ({ name: station(t.station).name, room: placeName(station(t.station).room), done: t.done, progress: t.progress / t.duration })),
      where: placeName(f.area),
      goal: f.mind.goal,
      n,
    }
    // time is the refresh signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, time])

  if (!fruit || !data) return null
  const showRole = reveal || !fruit.alive
  const goal =
    data.goal.kind === 'protect' ? `Keep ${data.n(data.goal.target)} safe` : data.goal.kind === 'revenge' ? `Get rid of ${data.n(data.goal.target)}` : data.goal.kind === 'survive' ? 'Stay alive' : 'Find the truth'

  return (
    <div className="mind">
      <div className="mind-head">
        <span className="dot" style={{ background: LOOKS[fruit.kind].color }} />
        <b>{fruit.name}</b>
        {showRole && <span className={`role ${fruit.role}`}>{ROLE_TAG[fruit.role]}</span>}
        <button className="close" onClick={() => useSim.getState().select(null)} aria-label="Close">
          ×
        </button>
      </div>
      <p className="thought">{fruit.thought ? <RichText text={fruit.thought} /> : 'Nothing on its mind yet.'}</p>
      <p className="hint">
        {fruit.alive ? `In ${data.where}` : 'Dead'} · {TEMPERS[fruit.traits.temper].label} · {goal}
      </p>
      <div className="moods">
        {MOODS.map((m) => (
          <span key={m} className={`mood ${m}`} style={{ '--level': fruit.mood[m] } as React.CSSProperties} title={`${m} ${Math.round(fruit.mood[m] * 10)}/10`}>
            {m}
          </span>
        ))}
      </div>

      {data.beliefs.length > 0 && (
        <>
          <h3>Suspects</h3>
          {data.beliefs.slice(0, 6).map(([other, p]) => (
            <div key={other} className="belief">
              <span>{data.n(other)}</span>
              <i style={{ width: `${Math.round(p * 100)}%` }} />
              <b>{Math.round(p * 100)}%</b>
            </div>
          ))}
        </>
      )}

      <h3>Tasks</h3>
      <ul className="tasks">
        {data.tasks.map((t, i) => (
          <li key={i} className={t.done ? 'done' : ''}>
            {t.name} <small>({t.room})</small>
            {fruit.role === 'crew' && !t.done && t.progress > 0 && <i style={{ width: `${Math.round(t.progress * 100)}%` }} />}
          </li>
        ))}
        {fruit.role === 'rotten' && <li className="hint">A fake list: the bar never moves.</li>}
      </ul>

      <h3>Memory reel</h3>
      <ol className="reel">
        {data.reel.map((m) => (
          <li key={m.id} style={{ opacity: 0.25 + m.c * 0.75 }} className={m.truth ? 'bent' : ''}>
            <span className="icon">{m.icon}</span>
            <span>
              <RichText text={m.text} />
              {m.truth && <small className="truth">Bent. Really: {m.truth}</small>}
            </span>
            <small className="conf">{Math.round(m.c * 100)}%</small>
          </li>
        ))}
        {!data.reel.length && <li className="hint">Nothing remembered yet.</li>}
      </ol>
      <p className="hint">Sim time {clock(time)}. Faded memories are pale; bent ones are striped.</p>
    </div>
  )
}
