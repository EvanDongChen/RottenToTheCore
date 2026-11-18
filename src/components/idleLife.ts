/**
 * Idle life for a fruit standing about with nothing to do: every few seconds it glances off in
 * some direction, and now and then it has a big stretch, arms up and eyes shut. Screen only:
 * it never touches the sim, so plain Math.random is fine here.
 */
export interface Idle {
  /** When the next fidget starts. */
  nextAt: number
  kind: 'look' | 'stretch' | null
  since: number
  until: number
  /** Which way it glances, as a unit direction on the floor. */
  dir: [number, number]
}

const LOOK_MS = [900, 1800]
const STRETCH_MS = 1500
/** Gap between fidgets, and the share of them that are stretches. */
const GAP_MS = [2200, 5200]
const STRETCH_SHARE = 0.14

/** How far into a stretch each fruit is (0 none, 1 at full stretch), for the face to shut its eyes. */
export const stretching = new Map<string, number>()

export function makeIdle(): Idle {
  return { nextAt: performance.now() + rand(GAP_MS), kind: null, since: 0, until: 0, dir: [0, 1] }
}

/**
 * Move the idle clock on. `free` is whether the fruit is standing about with nothing better to
 * do, and `calm` whether it is quiet enough to stretch (not in a meeting, not upset).
 * Returns the way to glance, if any, and how far into a stretch it is.
 */
export function idleTick(idle: Idle, id: string, now: number, free: boolean, calm: boolean): { look: [number, number] | null; stretch: number } {
  if (!free) {
    // Interrupted: drop whatever it was doing and wait a moment before fidgeting again.
    if (idle.kind) idle.kind = null
    idle.nextAt = Math.max(idle.nextAt, now + 1200)
    stretching.delete(id)
    return { look: null, stretch: 0 }
  }
  if (idle.kind && now > idle.until) {
    idle.kind = null
    idle.nextAt = now + rand(GAP_MS)
  }
  if (!idle.kind && now > idle.nextAt) {
    idle.kind = calm && Math.random() < STRETCH_SHARE ? 'stretch' : 'look'
    idle.since = now
    idle.until = now + (idle.kind === 'stretch' ? STRETCH_MS : rand(LOOK_MS))
    const a = Math.random() * Math.PI * 2
    idle.dir = [Math.sin(a), Math.cos(a)]
  }
  const p = idle.kind === 'stretch' ? Math.min(1, (now - idle.since) / STRETCH_MS) : 0
  // Up quickly, hold, and slump back down.
  const stretch = p <= 0 ? 0 : p < 0.3 ? p / 0.3 : p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3
  if (stretch > 0) stretching.set(id, stretch)
  else stretching.delete(id)
  return { look: idle.kind === 'look' ? idle.dir : null, stretch }
}

function rand([lo, hi]: number[]) {
  return lo + Math.random() * (hi - lo)
}
