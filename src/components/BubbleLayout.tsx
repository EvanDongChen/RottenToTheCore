import { useEffect } from 'react'

const GAP = 6 // pixels kept between two bubbles or tags
const EASE = 0.2
const STICK = 14 // a bubble ignores changes smaller than this many pixels
const HOLD_MS = 600 // how long a lifted bubble must be clear before it comes back down
const MOST_NAME_LIFT = 44 // name tags fan out at most about two rows (at full size; less far off)
const MOST_BUBBLE_LIFT = 90 // a bubble climbs at most about two short bubbles; past that it overlaps, faded

/** How much a tag is scaled down for distance: a lift inside it moves that much less on screen. */
const sizeOf = (el: Element) => parseFloat((el.closest<HTMLElement>('.fruit-tag')?.style.getPropertyValue('--tag-size') ?? '') || '1')

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
    // A name is measured, but its whole tag moves, so the work bar, votes and bubble go with it.
    const names = stacker(MOST_NAME_LIFT, (el, lift) => {
      const tag = el.closest<HTMLElement>('.fruit-tag')
      if (tag) tag.style.translate = lift ? `0 ${-lift}px` : ''
    })
    // A bubble sits inside its scaled tag, so its lift is scaled back up to move the right distance on screen.
    const bubbles = stacker(MOST_BUBBLE_LIFT, (el, lift, crowded) => {
      el.style.transform = lift ? `translateY(${-lift / sizeOf(el)}px)` : ''
      el.style.opacity = crowded ? '0.6' : ''
    })

    const tick = () => {
      frame = requestAnimationFrame(tick)
      // First the name tags of fruits standing close together fan out upward into a little stack…
      names([...document.querySelectorAll<HTMLElement>('.fruit-tag .name')], () => [])
      // …then the bubbles make room for each other and for every other fruit's tag and reaction mark.
      bubbles([...document.querySelectorAll<HTMLElement>('.fruit-tag .bubble')], (el) => {
        const tag = el.closest('.fruit-tag')
        return [...document.querySelectorAll<HTMLElement>('.fruit-tag .name, .fruit-tag .emote')]
          .filter((name) => name.closest('.fruit-tag') !== tag)
          .map((name) => ({ ...rectOf(name), lift: 0, want: 0, el: name }))
      })
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])
  return null
}

interface Box {
  el: HTMLElement
  left: number
  right: number
  top: number
  bottom: number
  lift: number
  want: number
}

function rectOf(el: HTMLElement) {
  const r = el.getBoundingClientRect()
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
}

/**
 * One layer of the layout: given the elements, it lifts overlapping ones into a stack, lowest on
 * screen staying put, and eases each toward its spot. `fixed` gives what else an element must not
 * sit on. `apply` moves an element up by so many pixels.
 */
function stacker(most: number, apply: (el: HTMLElement, lift: number, crowded: boolean) => void) {
  const lifts = new WeakMap<HTMLElement, number>()
  const settled = new WeakMap<HTMLElement, { target: number; clearSince: number }>()
  return (els: HTMLElement[], fixed: (el: HTMLElement) => Box[]) => {
    const boxes: Box[] = els
      .filter((el) => el.offsetParent !== null && el.closest<HTMLElement>('.fruit-tag')?.style.visibility !== 'hidden')
      .map((el) => {
        const lift = lifts.get(el) ?? 0
        const r = rectOf(el)
        // Where it would be if it had not been lifted.
        return { el, left: r.left, right: r.right, top: r.top + lift, bottom: r.bottom + lift, lift, want: 0 }
      })
    boxes.sort((a, b) => b.bottom - a.bottom)
    boxes.forEach((box, i) => {
      const obstacles = [...fixed(box.el), ...boxes.slice(0, i)]
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
      // So an element only changes where it is heading for a real difference, and only drops
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

      // Never climb past the most: in a big crowd it is better to overlap a little than to float far off.
      const cap = most * sizeOf(box.el)
      const crowded = s.target > cap
      if (crowded) s.target = cap
      if (crowded !== box.el.classList.contains('crowded')) {
        box.el.classList.toggle('crowded', crowded)
        apply(box.el, box.lift, crowded)
      }
      const next = Math.abs(s.target - box.lift) < 0.5 ? s.target : box.lift + (s.target - box.lift) * EASE
      if (next === box.lift) continue
      lifts.set(box.el, next)
      apply(box.el, next, crowded)
    }
  }
}
