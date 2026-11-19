import { useState } from 'react'
import { TEMPERS } from '../sim/mind'
import { ARCHETYPES, archetypeOf, STYLE_INFO } from '../sim/personality'
import { presetOf, QUIRK_PRESETS, quirkLabel, quirkText } from '../sim/quirks'
import { ROTTEN_STYLES, TRAIT_KEYS } from '../sim/types'
import type { FruitDef, RottenStyle, Temper } from '../sim/types'
import { useSim } from '../ui/store'

/** Most quirks one fruit can hold. */
export const MAX_QUIRKS = 3

const TRAIT_LABEL: Record<(typeof TRAIT_KEYS)[number], string> = {
  aggression: 'Aggression',
  honesty: 'Honesty',
  talkativeness: 'Talkative',
  suspicion: 'Suspicion',
  sharpness: 'Sharpness',
}

const TRAIT_HINT: Record<(typeof TRAIT_KEYS)[number], string> = {
  aggression: 'Bold: accuses, votes on a hunch, and (as Rotten) takes risks.',
  honesty: 'How straight its stories are. A dishonest Rotten improvises, and gets caught.',
  talkativeness: 'How often it speaks up in meetings and chats in the halls.',
  suspicion: 'How much it reads into the same evidence.',
  sharpness: 'Notices more, and its memories fade and bend less.',
}

/** What a dragged quirk carries: which quirk, and which fruit it came off, if any. */
export interface Carried {
  quirk: string
  from?: string
}

export function carried(event: React.DragEvent): Carried | null {
  try {
    const data = JSON.parse(event.dataTransfer.getData('text/plain'))
    return typeof data?.quirk === 'string' ? data : null
  } catch {
    return null
  }
}

/** Give a fruit a quirk. If it was dragged off another fruit, it moves rather than copies. */
export function giveQuirk(roster: FruitDef[], id: string, quirk: string, from?: string) {
  const { updateFruit } = useSim.getState()
  const fruit = roster.find((f) => f.id === id)
  if (!fruit || from === id || fruit.traits.quirks.includes(quirk) || fruit.traits.quirks.length >= MAX_QUIRKS) return
  updateFruit(id, { traits: { quirks: [...fruit.traits.quirks, quirk] } })
  const giver = from && roster.find((f) => f.id === from)
  if (giver) updateFruit(giver.id, { traits: { quirks: giver.traits.quirks.filter((q) => q !== quirk) } })
}

/** A quirk as a pill you can drag. In the tray it can also be tapped to pick it up; on a fruit it has a remove button. */
function Chip({ quirk, from, held, onPick, onRemove }: { quirk: string; from?: string; held?: boolean; onPick?(): void; onRemove?(): void }) {
  return (
    <span
      className={`chip${presetOf(quirk) ? '' : ' custom'}${held ? ' held' : ''}`}
      style={{ '--tint': presetOf(quirk)?.tint } as React.CSSProperties}
      title={quirkText(quirk)}
      draggable
      role={onPick ? 'button' : undefined}
      tabIndex={onPick ? 0 : undefined}
      aria-pressed={onPick ? !!held : undefined}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', JSON.stringify({ quirk, from }))
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={onPick}
      onKeyDown={(e) => {
        if (onPick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onPick()
        }
      }}
    >
      {quirkLabel(quirk)}
      {onRemove && (
        <button
          className="chip-x"
          aria-label={`Remove ${quirkLabel(quirk)}`}
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
        >
          ×
        </button>
      )}
    </span>
  )
}

/**
 * The quirk tray: every ready-made quirk, plus any the user writes. Drag one onto a fruit, or tap
 * it to pick it up and then tap a fruit.
 */
export function QuirkTray({ held, setHeld }: { held: string | null; setHeld(q: string | null): void }) {
  const [custom, setCustom] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const make = () => {
    const text = draft.trim().slice(0, 80)
    if (!text) return
    if (!presetOf(text) && !custom.includes(text)) setCustom([...custom, text])
    setHeld(text)
    setDraft('')
  }
  return (
    <div className="quirk-tray">
      <p className="hint">{held ? `Holding "${quirkLabel(held)}": tap a fruit to give it.` : 'Quirks: drag one onto a fruit, or tap it, then tap a fruit.'}</p>
      <div className="chips">
        {[...QUIRK_PRESETS.map((q) => q.id), ...custom].map((q) => (
          <Chip key={q} quirk={q} held={held === q} onPick={() => setHeld(held === q ? null : q)} />
        ))}
      </div>
      <div className="row">
        <input value={draft} placeholder="Write your own quirk" aria-label="New quirk" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && make()} />
        <button onClick={make} disabled={!draft.trim()}>
          Make
        </button>
      </div>
    </div>
  )
}

/** The quirks a fruit has, as chips that can be dragged to another fruit or removed. */
export function FruitQuirks({ fruit }: { fruit: FruitDef }) {
  const { updateFruit } = useSim.getState()
  if (!fruit.traits.quirks.length) return null
  return (
    <span className="chips mine">
      {fruit.traits.quirks.map((q) => (
        <Chip key={q} quirk={q} from={fruit.id} onRemove={() => updateFruit(fruit.id, { traits: { quirks: fruit.traits.quirks.filter((x) => x !== q) } })} />
      ))}
    </span>
  )
}

/**
 * One fruit's personality, in full: an archetype to start from, the sliders, its temper, how it
 * plays if it turns out Rotten, and its backstory.
 */
export default function PersonalityEditor({ fruit }: { fruit: FruitDef }) {
  const { updateFruit } = useSim.getState()
  const t = fruit.traits
  const type = archetypeOf(t)
  return (
    <div className="personality">
      <label className="row-label">
        <span>Personality</span>
        <select
          value={type?.id ?? 'custom'}
          onChange={(e) => {
            const a = ARCHETYPES.find((x) => x.id === e.target.value)
            if (a) updateFruit(fruit.id, { traits: { ...a.traits, temper: a.temper } })
          }}
        >
          <option value="custom" disabled>
            Custom
          </option>
          {ARCHETYPES.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      {type && <p className="hint">{type.blurb}</p>}
      {TRAIT_KEYS.map((k) => (
        <label key={k} className="slider" title={TRAIT_HINT[k]}>
          <span>{TRAIT_LABEL[k]}</span>
          <input type="range" min={0} max={1} step={0.1} value={t[k]} onChange={(e) => updateFruit(fruit.id, { traits: { [k]: Number(e.target.value) } })} />
          <span className="num">{Math.round(t[k] * 10)}</span>
        </label>
      ))}
      <label className="row-label" title={TEMPERS[t.temper].text}>
        <span>Temper</span>
        <select value={t.temper} onChange={(e) => updateFruit(fruit.id, { traits: { temper: e.target.value as Temper } })}>
          {(Object.keys(TEMPERS) as Temper[]).map((k) => (
            <option key={k} value={k}>
              {TEMPERS[k].label}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">{TEMPERS[t.temper].text}</p>
      <label className="row-label" title={t.style ? STYLE_INFO[t.style].blurb : 'Plays as its sliders say.'}>
        <span>If Rotten</span>
        <select value={t.style ?? ''} onChange={(e) => updateFruit(fruit.id, { traits: { style: (e.target.value || undefined) as RottenStyle | undefined } })}>
          <option value="">As its sliders say</option>
          {ROTTEN_STYLES.map((s) => (
            <option key={s} value={s}>
              {STYLE_INFO[s].label}: {STYLE_INFO[s].blurb.toLowerCase()}
            </option>
          ))}
        </select>
      </label>
      <label className="backstory">
        <span>Backstory</span>
        <textarea value={t.backstory} rows={2} maxLength={160} onChange={(e) => updateFruit(fruit.id, { traits: { backstory: e.target.value } })} />
      </label>
    </div>
  )
}
