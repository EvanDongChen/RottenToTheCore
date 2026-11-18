import { useMemo } from 'react'
import { clock } from '../sim/describe'
import { nameOf } from '../sim/engine'
import { placeName } from '../sim/map'
import { recall } from '../sim/memory'
import { replayThisGame } from '../ui/replay'
import { currentGame, shareLink, useSim } from '../ui/store'
import { LOOKS, ROLE_TAG } from './fruitLooks'
import RichText from './RichText'

/**
 * The end of the game: a timeline of kills, meetings and votes; each fruit's memories marked
 * right, wrong or bent; and the moment the crew came closest to the truth.
 */
export default function Recap() {
  const open = useSim((s) => s.recapOpen)
  const winner = useSim((s) => s.winner)
  const how = useSim((s) => s.how)

  const data = useMemo(() => {
    if (!open) return null
    const game = currentGame()
    const n = (id: string) => nameOf(game, id)
    const timeline: { t: number; text: string; kind: string }[] = []
    let meeting = 0
    let closest: { meeting: number; votes: number; who: string } | null = null
    let votesOnRotten = new Map<string, number>()
    for (const e of game.log) {
      if (e.kind === 'kill') timeline.push({ t: e.t, kind: 'kill', text: `${n(e.killer)} sliced ${n(e.victim)} in ${placeName(e.room)}${e.witnesses.length ? ` (seen by ${e.witnesses.map(n).join(', ')})` : ''}` })
      if (e.kind === 'meeting') {
        meeting++
        votesOnRotten = new Map()
        timeline.push({ t: e.t, kind: 'meeting', text: e.reason === 'body' ? `${n(e.caller)} reported ${n(e.victim!)}'s body` : `${n(e.caller)} called an emergency meeting` })
      }
      if (e.kind === 'vote' && e.target !== 'skip' && game.fruits.find((f) => f.id === e.target)?.role === 'rotten') {
        const v = (votesOnRotten.get(e.target) ?? 0) + 1
        votesOnRotten.set(e.target, v)
        if (!closest || v > closest.votes) closest = { meeting, votes: v, who: e.target }
      }
      if (e.kind === 'eject') timeline.push({ t: e.t, kind: 'eject', text: `${n(e.who)} was voted into the Juicer with ${e.votes} votes, and was ${e.role === 'rotten' ? '' : 'not '}Rotten` })
      if (e.kind === 'noEject') timeline.push({ t: e.t, kind: 'vote', text: e.tie ? 'The vote tied: nobody was ejected' : 'They skipped' })
      if (e.kind === 'vent' && e.seenBy.length) timeline.push({ t: e.t, kind: 'vent', text: `${n(e.who)} was seen using a vent` })
    }
    const memories = game.fruits.map((f) => {
      let right = 0
      let wrong = 0
      let bent = 0
      for (const m of f.memory) {
        if (m.recalled) bent++
        // A memory is "wrong" when it points the finger (or clears) the wrong way.
        const believed = recall(m)
        const subject = game.fruits.find((o) => o.id === believed.who)
        if (!subject) continue
        const accuses = ['nearBody', 'fakeTask', 'kill', 'vented'].includes(m.kind) || (m.kind === 'heard' && ['accuse', 'kill', 'vented', 'nearBody', 'fakeTask'].includes(m.told ?? ''))
        const clears = (m.kind === 'atTask' && m.sawEffect) || (m.kind === 'heard' && m.told === 'vouch')
        if (!accuses && !clears) continue
        if ((accuses && subject.role === 'rotten') || (clears && subject.role === 'crew')) right++
        else wrong++
      }
      return { id: f.id, name: f.def.name, kind: f.def.kind, role: f.role, alive: f.alive, right, wrong, bent }
    })
    return { timeline, memories, closest, meetings: meeting, link: shareLink(game.setup), llm: game.setup.brains.crew === 'llm' || game.setup.brains.rotten === 'llm' || useSim.getState().rosterEdited }
  }, [open])

  if (!open || !data) return null
  return (
    <div className="recap-wrap">
      <section className="panel recap-card">
        <h2>{winner === 'draw' ? 'A draw' : winner === 'crew' ? 'The crew win' : 'The Rotten win'}</h2>
        <p className="hint">{how === 'tasks' ? 'Every task was done.' : how === 'ejection' ? 'Every Rotten went into the Juicer.' : how === 'kills' ? 'Too few crew were left.' : 'Time ran out.'}</p>

        {data.closest && (
          <p className="closest">
            Closest to the truth: meeting {data.closest.meeting}, when <RichText text={nameOf(currentGame(), data.closest.who)} /> got {data.closest.votes} vote{data.closest.votes === 1 ? '' : 's'}.
          </p>
        )}

        <h3>What happened</h3>
        <ol className="timeline">
          {data.timeline.map((e, i) => (
            <li key={i} className={e.kind}>
              <small>{clock(e.t)}</small> <RichText text={e.text} />
            </li>
          ))}
        </ol>

        <h3>Whose memory held up</h3>
        <table className="memories">
          <thead>
            <tr>
              <th>Fruit</th>
              <th>Right</th>
              <th>Wrong</th>
              <th>Bent</th>
            </tr>
          </thead>
          <tbody>
            {data.memories.map((m) => (
              <tr key={m.id} className={m.alive ? '' : 'dead'}>
                <td>
                  <span className="dot" style={{ background: LOOKS[m.kind].color }} /> {m.name} <span className={`role ${m.role}`}>{ROLE_TAG[m.role]}</span>
                </td>
                <td>{m.right}</td>
                <td>{m.wrong}</td>
                <td>{m.bent}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">Right and wrong count the memories that point the finger at someone or clear them, judged against who really was Rotten.</p>

        <div className="row">
          <button
            onClick={() => {
              useSim.setState({ recapOpen: false })
              replayThisGame()
            }}
          >
            Watch the replay
          </button>
          {!data.llm && (
            <button onClick={() => void navigator.clipboard?.writeText(data.link)} title={data.link}>
              Copy link to this game
            </button>
          )}
          <button onClick={() => useSim.setState({ recapOpen: false })}>Close</button>
          <button className="primary" onClick={() => useSim.getState().toSetup()}>
            New game
          </button>
        </div>
      </section>
    </div>
  )
}
