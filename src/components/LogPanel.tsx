import { useEffect, useRef } from 'react'
import { clock } from '../sim/describe'
import { useSim } from '../ui/store'
import type { SimState } from '../ui/store'
import RichText from './RichText'

const TABS: { id: SimState['logTab']; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'chat', label: 'Chats' },
  { id: 'meeting', label: 'Meetings' },
  { id: 'sighting', label: 'Sightings' },
]
/** Lines shown at once; older ones are still kept in the store. */
const SHOWN = 120

/** Everything that happened, newest at the bottom, with tabs to narrow it down. */
export default function LogPanel() {
  const feed = useSim((s) => s.feed)
  const tab = useSim((s) => s.logTab)
  const list = useRef<HTMLOListElement>(null)
  const lines = (tab === 'all' ? feed : feed.filter((f) => f.tab === tab)).slice(-SHOWN)

  // Stay scrolled to the bottom, unless the viewer has scrolled up to read.
  useEffect(() => {
    const el = list.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight
  }, [lines.length, tab])

  return (
    <section className="panel log">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => useSim.setState({ logTab: t.id })}>
            {t.label}
          </button>
        ))}
      </div>
      <ol className="log-lines" ref={list}>
        {lines.map((l) => (
          <li key={l.key} className={l.tab}>
            <small>{clock(l.t)}</small> <RichText text={l.text} />
          </li>
        ))}
        {!lines.length && <li className="hint">Nothing yet.</li>}
      </ol>
    </section>
  )
}
