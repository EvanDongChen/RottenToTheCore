import { useEffect } from 'react'

const GAP = 8 // pixels kept between two bubbles
const EASE = 0.2
const STICK = 14 // a bubble ignores changes smaller than this many pixels
const HOLD_MS = 600 // how long a lifted bubble must be clear before it comes back down

/**
 * Keeps speech and thought bubbles from covering each other. Every bubble is drawn over its
 * own fruit, so when fruits stand close together, or line up from where the camera is, their
 * bubbles land on the same patch of screen. This looks at where the bubbles actually are on
 * screen and lifts the overlapping ones up into a stack.
 * Because it works on screen positions, it follows the camera as it moves.
 */
export default function BubbleLayout() {
  useEffect(() => {
    let frame = 0
    const lifts = new WeakMap<HTMLElement, number>()
    const settled = new WeakMap<HTMLElement, { target: number; clearSince: number }>()

    const tick = () => {
      frame = requestAnimationFrame(tick)
      const boxes = [...document.querySelectorAll<HTMLElement>('.fruit-tag .bubble')].map((el) => {
        const lift = lifts.get(el) ?? 0
        const rect = el.getBoundingClientRect()
        // Where the bubble would be if it had not been lifted.
        return { el, left: rect.left, right: rect.right, top: rect.top + lift, bottom: rect.bottom + lift, lift, want: 0 }
      })
      // Other fruits' name tags and reaction marks never move, and a bubble should not sit under one either.
      const names = [...document.querySelectorAll<HTMLElement>('.fruit-tag .name, .fruit-tag .emote')].map((el) => {
        const rect = el.getBoundingClientRect()
        return { el, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, lift: 0, want: 0 }
      })
      // The lowest bubble on screen stays put; the ones above it make room.
      boxes.sort((a, b) => b.bottom - a.bottom)
      boxes.forEach((box, i) => {
        const tag = box.el.closest('.fruit-tag')
        const obstacles = [...names.filter((name) => name.el.closest('.fruit-tag') !== tag), ...boxes.slice(0, i)]
        for (let pass = 0; pass < obstacles.length; pass++) {
          let moved = false
          for (const other of obstacles) {
            const sideBySide = box.right + GAP < other.left || other.right + GAP < box.left
            const clear = box.bottom - box.want + GAP <= other.top - other.want || box.top - box.want >= other.bottom - other.want + GAP
            if (sideBySide || clear) continue
            box.want = box.bottom - (other.top - other.want) + GAP
            moved = true
          }
          if (!moved) break
        }
      })
      const now = performance.now()
      for (const box of boxes) {
        // Fruits wobble and shake, which makes the wanted position twitch from frame to frame.
        // So a bubble only changes where it is heading for a real difference, and only drops
        // back down once it has been clear of the others for a moment.
        const s = settled.get(box.el) ?? { target: 0, clearSince: 0 }
        if (box.want > 0) {
          s.clearSince = 0
          // Going up, leave a little spare room so the next twitch does not ask for more.
          if (box.want > s.target) s.target = box.want + STICK / 2
          else if (box.want < s.target - STICK * 1.5) s.target = box.want
        } else if (s.target > 0) {
          s.clearSince ||= now
          if (now - s.clearSince > HOLD_MS) s.target = 0
        }
        settled.set(box.el, s)

        const next = Math.abs(s.target - box.lift) < 0.5 ? s.target : box.lift + (s.target - box.lift) * EASE
        if (next === box.lift) continue
        lifts.set(box.el, next)
        box.el.style.transform = next ? `translateY(${-next}px)` : ''
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])
  return null
}
