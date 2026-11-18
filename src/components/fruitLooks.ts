import type { FruitKind, Role } from '../sim/types'

/** Skin colour and inside (flesh) colour per fruit kind. Shared by the 3D fruit and the UI. */
export const LOOKS: Record<FruitKind, { color: string; flesh: string }> = {
  apple: { color: '#d8342c', flesh: '#fff3d6' },
  orange: { color: '#f08a1c', flesh: '#ffc266' },
  lemon: { color: '#f2d43a', flesh: '#fff6a8' },
  plum: { color: '#6b3fa0', flesh: '#f2c078' },
  pear: { color: '#a9c94a', flesh: '#fbf6d0' },
  lime: { color: '#58b033', flesh: '#d9f29a' },
  peach: { color: '#f7a072', flesh: '#ffd08a' },
  blueberry: { color: '#3d58b8', flesh: '#b9a3d9' },
  cherry: { color: '#a8102a', flesh: '#e0566f' },
  kiwi: { color: '#8a6a3b', flesh: '#9bd45a' },
  banana: { color: '#ffcb2e', flesh: '#fff4cf' },
  strawberry: { color: '#e8273f', flesh: '#ffc4c9' },
  watermelon: { color: '#3f9d4a', flesh: '#ff5c6c' },
}

export const ROLE_TAG: Record<Role, string> = {
  crew: 'Crew',
  rotten: 'Rotten',
}

/**
 * Tags and bubbles: full size up to this far from the camera, shrinking over the next stretch,
 * never below the least size, so a bubble keeps to the size of the fruits around it but stays readable.
 */
const TAG_NEAR = 22
const TAG_FALLOFF = 40
const TAG_MIN = 0.7

/** How big a tag is drawn this far from the camera. */
export const tagSize = (far: number) => Math.max(TAG_MIN, Math.min(1, 1 - (far - TAG_NEAR) / TAG_FALLOFF))
