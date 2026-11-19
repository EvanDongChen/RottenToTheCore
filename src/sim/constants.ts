// Fixed numbers shared across the sim. Tunable game settings live in `Rules` instead.

export const TICKS_PER_SECOND = 10
/** One sim step, in sim seconds. */
export const TICK = 1 / TICKS_PER_SECOND
/** How far a fruit walks in one sim second. */
export const WALK_SPEED = 2.6
/** Brains decide at most this often per fruit, in sim seconds (plus whenever an action finishes). */
export const DECIDE_EVERY = 1
/** A game still going after this long ends as a draw. */
export const MAX_GAME_TIME = 25 * 60
/** After a meeting (and at the start), the emergency button is locked this long. */
export const BUTTON_COOLDOWN = 15
/** The Rotten may sabotage again this long after the lights come back on. */
export const SABOTAGE_COOLDOWN = 35
/** How long fixing the lights takes at the fuse box. */
export const FIX_TIME = 2.5
/** A fruit standing within this of a station is working at it. */
export const STATION_REACH = 0.6
/** How close a fruit must be to a vent to climb in. */
export const VENT_REACH = 1
/** How close to a body a fruit must be to report it (it must also see it). */
export const REPORT_REACH = 6
