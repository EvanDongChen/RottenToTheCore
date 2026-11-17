import { areaAt, DOORS, dist } from './map'
import type { Door } from './map'
import type { Vec2 } from './types'

/**
 * Finding the way. Every area is a convex rectangle, so inside one area a fruit walks straight.
 * Between areas it goes door to door: the nav graph's nodes are the doors, joined when they share
 * an area, and A* finds the shortest chain. Each fruit has a lane (-1 to 1) that shifts it
 * sideways in every doorway, so a group walking the same way spreads out instead of stacking up.
 */

/** How far across a doorway a fruit in the outermost lane walks, as a share of the half-width. */
const LANE_SPREAD = 0.55

/** Doors grouped by the areas they open onto. */
const DOORS_IN = new Map<string, Door[]>()
for (const d of DOORS) for (const a of d.areas) DOORS_IN.set(a, [...(DOORS_IN.get(a) ?? []), d])

/** For each door, the doors reachable through one area, and how far. */
const LINKS = new Map<string, { door: Door; cost: number }[]>(
  DOORS.map((d) => [
    d.id,
    d.areas.flatMap((a) => (DOORS_IN.get(a) ?? []).filter((o) => o !== d).map((o) => ({ door: o, cost: dist(d.at, o.at) }))),
  ]),
)

/** A* from a point to a point. Returns the doors to pass through, in order. */
function doorChain(from: Vec2, to: Vec2): Door[] {
  const start = areaAt(from)
  const goal = areaAt(to)
  if (start === goal) return []
  const goalDoors = new Set(DOORS_IN.get(goal) ?? [])
  const g = new Map<Door, number>()
  const parent = new Map<Door, Door | null>()
  const open: Door[] = []
  for (const d of DOORS_IN.get(start) ?? []) {
    g.set(d, dist(from, d.at))
    parent.set(d, null)
    open.push(d)
  }
  const closed = new Set<Door>()
  let best: Door | null = null
  let bestCost = Infinity
  while (open.length) {
    // The open list is tiny (a couple of dozen doors), so a linear scan beats a heap.
    let i = 0
    let f = Infinity
    open.forEach((d, j) => {
      const score = g.get(d)! + dist(d.at, to)
      if (score < f) {
        f = score
        i = j
      }
    })
    if (f >= bestCost) break
    const d = open.splice(i, 1)[0]
    if (closed.has(d)) continue
    closed.add(d)
    if (goalDoors.has(d)) {
      const total = g.get(d)! + dist(d.at, to)
      if (total < bestCost) {
        bestCost = total
        best = d
      }
    }
    for (const { door, cost } of LINKS.get(d.id)!) {
      const next = g.get(d)! + cost
      if (next < (g.get(door) ?? Infinity)) {
        g.set(door, next)
        parent.set(door, d)
        open.push(door)
      }
    }
  }
  const chain: Door[] = []
  for (let d = best; d; d = parent.get(d) ?? null) chain.unshift(d)
  return chain
}

/** The points to walk through to get from `from` to `to`, ending at `to`. */
export function findPath(from: Vec2, to: Vec2, lane = 0): Vec2[] {
  const points: Vec2[] = doorChain(from, to).map((d) => {
    const shift = lane * d.half * LANE_SPREAD
    return [d.at[0] + d.along[0] * shift, d.at[1] + d.along[1] * shift]
  })
  points.push(to)
  return points
}

/** How far the walk from `from` to `to` is, along the nav graph. */
export function walkDistance(from: Vec2, to: Vec2): number {
  let total = 0
  let at = from
  for (const p of findPath(from, to)) {
    total += dist(at, p)
    at = p
  }
  return total
}
