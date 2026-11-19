import type { Reaction } from '../sim/types'

const GLYPH: Record<Reaction, string> = { gasp: '!', shake: '', cheer: '♥', sulk: '', puzzle: '?', blush: '' }

/** A comic-book mark that pops up over a fruit's head so its reaction reads from far away. */
export default function Emote({ reaction, big }: { reaction: Reaction; big?: boolean }) {
  // The nervous shake gets a drawn sweat drop and the sulk three glum dots; the rest are single characters.
  return (
    <div className={`emote ${reaction}${big ? ' big' : ''}`}>
      {reaction === 'shake' ? (
        <i className="drop" />
      ) : reaction === 'sulk' ? (
        <span className="dots">
          <i />
          <i />
          <i />
        </span>
      ) : (
        GLYPH[reaction]
      )}
    </div>
  )
}
