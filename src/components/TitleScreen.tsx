import { useEffect, useState } from 'react'
import { unlockAudio } from '../ui/sfx'
import { useSim } from '../ui/store'

const SKY_HOLD_MS = 1300 // how long the logo hangs in the sky before the lab shows

/**
 * The opening: the logo in a blue sky, which slides away to show the lab with fruits going about
 * their chores, and a button leading in.
 */
export default function TitleScreen() {
  const [down, setDown] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setDown(true), SKY_HOLD_MS)
    return () => clearTimeout(timer)
  }, [])

  function enter() {
    // The first click is also what lets the browser play sound later.
    unlockAudio()
    useSim.getState().toSetup()
  }

  return (
    <div className={`title${down ? ' down' : ''}`}>
      <div className="sky">
        <i className="cloud a" />
        <i className="cloud b" />
        <i className="cloud c" />
      </div>
      <div className="title-card">
        <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" />
        <h1>
          Rotten to
          <br />
          the Core
        </h1>
      </div>
      <div className="title-foot">
        <p>Fruits do chores in a lab. One of them is Rotten, and slices the others when nobody is looking.</p>
        <button className="primary" onClick={enter}>
          Meet the fruits
        </button>
        <p className="muted">Nobody plays. You watch, read their minds, and see the meetings fall apart.</p>
      </div>
    </div>
  )
}
