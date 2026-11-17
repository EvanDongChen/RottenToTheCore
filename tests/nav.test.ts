import { describe, expect, it } from 'vitest'
import { crossesWall } from '../src/sim/geom'
import { areaAt, centre, DOORS, randomSpot, ROOMS, STATIONS, WALLS } from '../src/sim/map'
import { findPath } from '../src/sim/nav'
import { makeRng } from '../src/sim/rng'
import type { Vec2 } from '../src/sim/types'

/** Every leg of a walk, as segments, starting from `from`. */
function legs(from: Vec2, path: Vec2[]): [Vec2, Vec2][] {
  const out: [Vec2, Vec2][] = []
  let at = from
  for (const p of path) {
    out.push([at, p])
    at = p
  }
  return out
}

describe('map', () => {
  it('has nine rooms, eleven hallways and a door at each end of every hallway', () => {
    expect(ROOMS).toHaveLength(9)
    expect(DOORS).toHaveLength(22)
  })

  it('puts every station inside its room', () => {
    for (const s of STATIONS) expect(areaAt(s.at)).toBe(s.room)
  })

  it('keeps Electrical quiet: only two ways in', () => {
    expect(DOORS.filter((d) => d.areas[0] === 'electrical')).toHaveLength(2)
  })
})

describe('nav', () => {
  it('finds a path between every pair of rooms that never crosses a wall', () => {
    for (const a of ROOMS) {
      for (const b of ROOMS) {
        for (const lane of [-1, 0, 1]) {
          const from = centre(a.rect)
          const to = centre(b.rect)
          const path = findPath(from, to, lane)
          expect(path.at(-1)).toEqual(to)
          for (const [p, q] of legs(from, path)) {
            for (const w of WALLS) expect(crossesWall(p, q, w), `${a.id}→${b.id} lane ${lane}`).toBe(false)
          }
        }
      }
    }
  })

  it('reaches every station from random spots without clipping a wall', () => {
    const rng = makeRng(4)
    for (let i = 0; i < 300; i++) {
      const from = randomSpot(rng, rng.pick(ROOMS).id)
      const to = rng.pick(STATIONS).at
      const path = findPath(from, to, rng.range(-1, 1))
      for (const [p, q] of legs(from, path)) for (const w of WALLS) expect(crossesWall(p, q, w)).toBe(false)
    }
  })

  it('walks straight inside one room', () => {
    expect(findPath([-26, -16], [-20, -12])).toEqual([[-20, -12]])
  })
})
