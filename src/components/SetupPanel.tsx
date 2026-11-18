import { useRef, useState } from 'react'
import type { BrainKind } from '../sim/brains/types'
import { FREE_MODELS } from '../sim/brains/llm'
import { QUIRK_PRESETS, quirkLabel } from '../sim/quirks'
import { maxRotten, MAX_FRUITS, MIN_FRUITS } from '../sim/rules'
import { FRUIT_KINDS, TRAIT_KEYS } from '../sim/types'
import type { Rules } from '../sim/types'
import { replayFromText } from '../ui/replay'
import { unlockAudio } from '../ui/sfx'
import { randomSeed, useSim } from '../ui/store'
import { LOOKS } from './fruitLooks'

const BRAINS: { id: BrainKind; label: string; hint: string }[] = [
  { id: 'heuristic', label: 'Heuristic', hint: 'Rules of thumb. Free and fast.' },
  { id: 'bayesian', label: 'Bayesian', hint: 'Keeps odds for everyone and checks who could have reached each body.' },
  { id: 'llm', label: 'LLM', hint: 'Gemini speaks and votes in meetings. Needs an API key.' },
]

/** The tunable numbers, with their ranges from the plan. */
const NUMBERS: { key: keyof Rules; label: string; min: number; max: number; step?: number; unit?: string }[] = [
  { key: 'shortTasks', label: 'Short tasks each', min: 1, max: 6 },
  { key: 'longTasks', label: 'Long tasks each', min: 0, max: 4 },
  { key: 'killCooldown', label: 'Kill cooldown', min: 10, max: 60, unit: 's' },
  { key: 'crewVision', label: 'Crew vision', min: 3, max: 10, step: 0.5 },
  { key: 'rottenVision', label: 'Rotten vision', min: 3, max: 12, step: 0.5 },
  { key: 'emergencyMeetings', label: 'Emergency meetings each', min: 0, max: 3 },
  { key: 'discussionTurns', label: 'Discussion turns', min: 6, max: 24 },
]

const TRAIT_LABEL: Record<(typeof TRAIT_KEYS)[number], string> = {
  aggression: 'Aggression',
  honesty: 'Honesty',
  talkativeness: 'Talkative',
  suspicion: 'Suspicion',
  sharpness: 'Sharpness',
}

/**
 * The setup screen: who plays, with which brains, under which rules. Every fruit can be renamed,
 * re-kinded and given a personality. A log file from a headless run can be loaded as a replay.
 */
export default function SetupPanel() {
  const settings = useSim((s) => s.settings)
  const roster = useSim((s) => s.roster)
  const seed = useSim((s) => s.seed)
  const edited = useSim((s) => s.rosterEdited)
  const [open, setOpen] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const { setSettings, setRules, updateFruit, addFruit, removeFruit, reseed, startGame } = useSim.getState()
  const rules = settings.rules
  const needsKey = (settings.crewBrain === 'llm' || settings.rottenBrain === 'llm') && !settings.apiKey

  return (
    <aside className="panel setup">
      <div className="brand">
        <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" />
        <h1>
          Rotten to
          <br />
          the Core
        </h1>
      </div>
      <p className="tagline">Set up the lab, then watch.</p>

      <h3>Brains</h3>
      {(['crewBrain', 'rottenBrain'] as const).map((side) => (
        <div key={side} className="row">
          <span className="label">{side === 'crewBrain' ? 'Crew' : 'Rotten'}</span>
          <div className="segmented">
            {BRAINS.map((b) => (
              <button key={b.id} className={settings[side] === b.id ? 'on' : ''} title={b.hint} onClick={() => setSettings({ [side]: b.id })}>
                {b.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      {(settings.crewBrain === 'llm' || settings.rottenBrain === 'llm') && (
        <div className="llm-box">
          <label>
            Gemini API key
            <input type="password" value={settings.apiKey} placeholder="Paste your key" onChange={(e) => setSettings({ apiKey: e.target.value.trim() })} />
          </label>
          <label>
            Model
            <select value={settings.model} onChange={(e) => setSettings({ model: e.target.value })}>
              {FREE_MODELS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <p className="hint">The key stays in this browser. Without one, the LLM brain plays as the Bayesian brain.</p>
        </div>
      )}

      <h3>Rules</h3>
      <div className="rules">
        <label>
          Rotten
          <select value={rules.rotten} onChange={(e) => setRules({ rotten: Number(e.target.value) })}>
            {[1, 2].map((n) => (
              <option key={n} value={n} disabled={n > maxRotten(roster.length)}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {NUMBERS.map((n) => (
          <label key={n.key}>
            {n.label}
            {n.unit ? ` (${n.unit})` : ''}
            <input
              type="number"
              min={n.min}
              max={n.max}
              step={n.step ?? 1}
              value={rules[n.key] as number}
              onChange={(e) => {
                const v = Math.max(n.min, Math.min(n.max, Number(e.target.value)))
                if (Number.isFinite(v)) setRules({ [n.key]: v } as Partial<Rules>)
              }}
            />
          </label>
        ))}
        <label className="check">
          <input type="checkbox" checked={rules.confirmEjects} onChange={(e) => setRules({ confirmEjects: e.target.checked })} /> Confirm ejects
        </label>
        <label className="check">
          <input type="checkbox" checked={rules.ghostTasks} onChange={(e) => setRules({ ghostTasks: e.target.checked })} /> Ghosts finish tasks
        </label>
        <label className="check">
          <input type="checkbox" checked={rules.meltdown} onChange={(e) => setRules({ meltdown: e.target.checked })} /> Meltdown sabotage
        </label>
        <label className="check">
          <input type="checkbox" checked={rules.doors} onChange={(e) => setRules({ doors: e.target.checked })} /> Door sabotage
        </label>
        <label>
          Engineers (can vent)
          <input type="number" min={0} max={2} value={rules.engineers} onChange={(e) => setRules({ engineers: Math.max(0, Math.min(2, Number(e.target.value) || 0)) })} />
        </label>
        <label>
          Scientists (see deaths)
          <input type="number" min={0} max={2} value={rules.scientists} onChange={(e) => setRules({ scientists: Math.max(0, Math.min(2, Number(e.target.value) || 0)) })} />
        </label>
        <label>
          Ejected fruits go
          <select value={settings.ejectStyle} onChange={(e) => setSettings({ ejectStyle: e.target.value as 'juicer' | 'compost' })}>
            <option value="juicer">into the Juicer</option>
            <option value="compost">down the compost chute</option>
          </select>
        </label>
      </div>

      <h3>
        Fruits <small>({roster.length})</small>
      </h3>
      <div className="row">
        <label>
          Seed <input type="number" value={seed} onChange={(e) => reseed(Math.max(1, Number(e.target.value) || 1))} />
        </label>
        <button onClick={() => reseed(randomSeed())}>New roster</button>
        <button onClick={addFruit} disabled={roster.length >= MAX_FRUITS}>
          Add
        </button>
      </div>
      {edited && <p className="hint">Edited by hand: the seed alone won't reproduce this game in a shared link.</p>}
      <ul className="roster-cards">
        {roster.map((f) => (
          <li key={f.id} className={open === f.id ? 'open' : ''}>
            <div className="roster-card-head">
              <span className="dot" style={{ background: LOOKS[f.kind].color }} />
              <input value={f.name} aria-label="Name" onChange={(e) => updateFruit(f.id, { name: e.target.value.slice(0, 16) })} />
              <select value={f.kind} aria-label="Kind of fruit" onChange={(e) => updateFruit(f.id, { kind: e.target.value as (typeof FRUIT_KINDS)[number] })}>
                {FRUIT_KINDS.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
              <button onClick={() => setOpen(open === f.id ? null : f.id)} aria-expanded={open === f.id}>
                {open === f.id ? 'Less' : 'More'}
              </button>
              <button className="danger" onClick={() => removeFruit(f.id)} disabled={roster.length <= MIN_FRUITS} aria-label={`Remove ${f.name}`}>
                ×
              </button>
            </div>
            {open === f.id && (
              <div className="roster-card-body">
                {TRAIT_KEYS.map((k) => (
                  <label key={k} className="slider">
                    <span>{TRAIT_LABEL[k]}</span>
                    <input type="range" min={0} max={1} step={0.1} value={f.traits[k]} onChange={(e) => updateFruit(f.id, { traits: { [k]: Number(e.target.value) } })} />
                  </label>
                ))}
                <div className="chips">
                  {QUIRK_PRESETS.map((q) => {
                    const on = f.traits.quirks.includes(q.id)
                    return (
                      <button
                        key={q.id}
                        className={`chip${on ? ' on' : ''}`}
                        style={{ background: on ? q.tint : undefined }}
                        onClick={() => updateFruit(f.id, { traits: { quirks: on ? f.traits.quirks.filter((x) => x !== q.id) : [...f.traits.quirks, q.id].slice(-3) } })}
                      >
                        {quirkLabel(q.id)}
                      </button>
                    )
                  })}
                </div>
                <p className="hint">"{f.traits.backstory}"</p>
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="row start">
        <button
          className="primary"
          title={needsKey ? 'No API key: the LLM brain will play as the Bayesian brain' : ''}
          onClick={() => {
            unlockAudio()
            startGame()
          }}
        >
          Start the game
        </button>
        <button onClick={() => file.current?.click()}>Load a replay</button>
        <input
          ref={file}
          type="file"
          accept=".jsonl,.json,.txt"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            setFileError(replayFromText(await f.text()))
            e.target.value = ''
          }}
        />
      </div>
      {fileError && <p className="hint error">{fileError}</p>}
    </aside>
  )
}
