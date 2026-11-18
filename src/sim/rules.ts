import type { Rules } from './types'

export const MIN_FRUITS = 4
export const MAX_FRUITS = 10

/** Starting defaults, the same as the plan's settings table. */
export const DEFAULT_RULES: Rules = {
  fruits: 8,
  rotten: 1,
  shortTasks: 3,
  longTasks: 2,
  shortTaskTime: 4,
  longTaskTime: 12,
  killCooldown: 20,
  killRange: 1.5,
  crewVision: 6,
  rottenVision: 8,
  lightsOutVision: 2.5,
  emergencyMeetings: 1,
  discussionTurns: 12,
  confirmEjects: true,
  ghostTasks: false,
  meltdown: false,
  doors: false,
  engineers: 0,
  scientists: 0,
}

/** Most Rotten a game of this size can hold while still being outnumbered at the start. */
export function maxRotten(fruitCount: number) {
  return Math.max(1, Math.min(2, Math.floor((fruitCount - 1) / 3)))
}
