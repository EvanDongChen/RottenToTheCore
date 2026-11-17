import { useMemo } from 'react'
import { CylinderCollider, RigidBody } from '@react-three/rapier'
import { BufferAttribute, CatmullRomCurve3, Color, LatheGeometry, SplineCurve, TubeGeometry, Vector2, Vector3 } from 'three'
import type { FruitKind } from '../sim/types'
import { LOOKS } from './fruitLooks'

/** Nominal body radius. The physics collider is a ball of this size whatever the fruit's shape. */
export const RADIUS = 0.55
export const EYE_SPREAD = 0.085
export const LIMB_COLOR = '#151515'

type Topper = 'stem-leaf' | 'stem' | 'calyx' | 'crown' | 'cherry' | 'nub' | 'leaves' | 'none'

interface Shape {
  /**
   * Silhouette as [radius, height] pairs from the bottom tip to the top tip,
   * in units of RADIUS. It is smoothed and spun around the vertical axis.
   */
  profile: [number, number][]
  /** Height of the middle of the face, in units of RADIUS. */
  faceY: number
  /** Colour the skin fades to at the very bottom and the very top. */
  bottom: string
  top: string
  roughness: number
  topper: Topper
  /** Shiny fruits get a cartoon highlight. */
  glossy: boolean
  /** How far the fruit curves over to one side, like a banana. */
  bend?: number
  /** Colour of stripes running from top to bottom. */
  stripes?: string
  /** Colour of little seeds dotted over the skin. */
  seeds?: string
}

const SHAPES: Record<FruitKind, Shape> = {
  apple: {
    profile: [[0, -0.84], [0.32, -0.95], [0.7, -0.84], [1, -0.32], [1.05, 0.2], [0.88, 0.68], [0.52, 0.9], [0.2, 0.82], [0, 0.7]],
    faceY: 0,
    bottom: '#a81f1a',
    top: '#e7a13a',
    roughness: 0.3,
    topper: 'stem-leaf',
    glossy: true,
  },
  orange: {
    profile: [[0, -0.93], [0.5, -0.86], [0.9, -0.46], [1.03, 0], [0.9, 0.46], [0.5, 0.86], [0.14, 0.95], [0, 0.9]],
    faceY: 0,
    bottom: '#d9700f',
    top: '#f6a02c',
    roughness: 0.7,
    topper: 'calyx',
    glossy: false,
  },
  lemon: {
    profile: [[0, -1.14], [0.12, -1.04], [0.46, -0.8], [0.8, -0.36], [0.87, 0.04], [0.76, 0.45], [0.46, 0.8], [0.17, 1], [0.1, 1.12], [0, 1.15]],
    faceY: 0,
    bottom: '#c9cf3a',
    top: '#d8d843',
    roughness: 0.6,
    topper: 'none',
    glossy: false,
  },
  plum: {
    profile: [[0, -1], [0.46, -0.92], [0.8, -0.5], [0.9, 0], [0.82, 0.5], [0.5, 0.9], [0.16, 1], [0, 0.95]],
    faceY: 0,
    bottom: '#4a2a78',
    top: '#8a62c0',
    roughness: 0.35,
    topper: 'stem',
    glossy: true,
  },
  pear: {
    profile: [[0, -0.95], [0.5, -0.93], [0.93, -0.6], [1, -0.2], [0.82, 0.2], [0.54, 0.58], [0.42, 0.92], [0.3, 1.18], [0.12, 1.3], [0, 1.3]],
    faceY: -0.27,
    bottom: '#dccb62',
    top: '#8fb63c',
    roughness: 0.5,
    topper: 'stem-leaf',
    glossy: false,
  },
  lime: {
    profile: [[0, -1], [0.1, -0.95], [0.5, -0.8], [0.85, -0.36], [0.93, 0], [0.83, 0.4], [0.5, 0.8], [0.15, 0.96], [0, 1]],
    faceY: 0,
    bottom: '#3d8f24',
    top: '#7cc63f',
    roughness: 0.5,
    topper: 'calyx',
    glossy: true,
  },
  peach: {
    profile: [[0, -0.88], [0.4, -0.92], [0.86, -0.6], [1.04, -0.05], [0.96, 0.45], [0.6, 0.83], [0.22, 0.88], [0, 0.76]],
    faceY: 0,
    bottom: '#ffc77c',
    top: '#e2553f',
    roughness: 0.95,
    topper: 'stem-leaf',
    glossy: false,
  },
  blueberry: {
    profile: [[0, -0.9], [0.5, -0.82], [0.9, -0.4], [0.98, 0.05], [0.86, 0.5], [0.52, 0.8], [0.34, 0.86], [0.3, 0.96], [0.2, 0.88], [0, 0.84]],
    faceY: -0.05,
    bottom: '#2a3f94',
    top: '#6f86d6',
    roughness: 0.7,
    topper: 'crown',
    glossy: false,
  },
  cherry: {
    profile: [[0, -0.92], [0.46, -0.86], [0.88, -0.45], [1, 0.05], [0.88, 0.5], [0.56, 0.8], [0.22, 0.78], [0, 0.66]],
    faceY: -0.05,
    bottom: '#6e0a1c',
    top: '#c8203c',
    roughness: 0.2,
    topper: 'cherry',
    glossy: true,
  },
  kiwi: {
    profile: [[0, -1.06], [0.4, -0.98], [0.76, -0.6], [0.85, 0], [0.76, 0.6], [0.4, 0.98], [0, 1.06]],
    faceY: 0,
    bottom: '#6f5530',
    top: '#a5855a',
    roughness: 1,
    topper: 'nub',
    glossy: false,
  },
  banana: {
    profile: [[0, -1.5], [0.14, -1.42], [0.4, -1.1], [0.53, -0.45], [0.55, 0.15], [0.47, 0.85], [0.27, 1.3], [0.13, 1.5], [0.1, 1.66], [0, 1.68]],
    faceY: 0,
    bottom: '#6b4a1e',
    top: '#b5bd45',
    roughness: 0.5,
    topper: 'none',
    glossy: false,
    bend: 0.13,
  },
  strawberry: {
    profile: [[0, -1.18], [0.2, -1.05], [0.55, -0.58], [0.86, -0.02], [0.97, 0.42], [0.84, 0.76], [0.46, 0.92], [0, 0.9]],
    faceY: 0.25,
    bottom: '#c4132c',
    top: '#f2504a',
    roughness: 0.45,
    topper: 'leaves',
    glossy: true,
    seeds: '#ffe28a',
  },
  watermelon: {
    profile: [[0, -1.02], [0.5, -0.95], [0.97, -0.6], [1.13, 0], [0.97, 0.6], [0.5, 0.95], [0, 1.02]],
    faceY: 0,
    bottom: '#8fc66a',
    top: '#3f9d4a',
    roughness: 0.4,
    topper: 'nub',
    glossy: true,
    stripes: '#1c5a2b',
  },
}

/** Sideways shift of a bent fruit's centre line at a given height. */
function lean(kind: FruitKind, y: number): number {
  return ((SHAPES[kind].bend ?? 0) * y * y) / RADIUS
}

// ---------- Geometry (built once per fruit kind and shared) ----------

const outlines = new Map<FruitKind, Vector2[]>()

/** The smoothed silhouette in world units, bottom tip to top tip. */
function outline(kind: FruitKind): Vector2[] {
  let points = outlines.get(kind)
  if (!points) {
    const curve = new SplineCurve(SHAPES[kind].profile.map(([r, y]) => new Vector2(r * RADIUS, y * RADIUS)))
    points = curve.getPoints(56).map((p) => new Vector2(Math.max(0, p.x), p.y))
    points[0].x = 0
    points[points.length - 1].x = 0
    outlines.set(kind, points)
  }
  return points
}

/** How wide the fruit is at a given height. */
export function radiusAt(kind: FruitKind, y: number): number {
  const points = outline(kind)
  let widest = 0
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    if ((y - a.y) * (y - b.y) > 0 || a.y === b.y) continue
    widest = Math.max(widest, a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x))
  }
  return widest
}

function heightRange(kind: FruitKind): [number, number] {
  const ys = outline(kind).map((p) => p.y)
  return [Math.min(...ys), Math.max(...ys)]
}

/** Spin part of the silhouette into a surface and paint the skin gradient onto its vertices. */
function lathe(kind: FruitKind, lo: number, hi: number): LatheGeometry {
  const [min, max] = heightRange(kind)
  const points = outline(kind).filter((p) => p.y >= lo && p.y <= hi)
  if (lo > min) points.unshift(new Vector2(radiusAt(kind, lo), lo))
  if (hi < max) points.push(new Vector2(radiusAt(kind, hi), hi))
  const shape = SHAPES[kind]
  // Striped fruits need more facets around, or the stripes come out jagged.
  const geometry = new LatheGeometry(points, shape.stripes ? 72 : 30)

  const skin = new Color(LOOKS[kind].color)
  const bottom = new Color(shape.bottom)
  const top = new Color(shape.top)
  const stripe = shape.stripes ? new Color(shape.stripes) : null
  const smooth = (edge0: number, edge1: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)
  }
  const position = geometry.getAttribute('position')
  const colors = new Float32Array(position.count * 3)
  const c = new Color()
  for (let i = 0; i < position.count; i++) {
    const t = (position.getY(i) - min) / (max - min)
    c.copy(bottom).lerp(skin, smooth(0, 0.45, t)).lerp(top, smooth(0.6, 1, t) * 0.85)
    if (stripe) {
      // Wobbly dark bands running from pole to pole.
      const around = Math.atan2(position.getZ(i), position.getX(i))
      c.lerp(stripe, smooth(0.25, 0.6, Math.sin(around * 9 + Math.sin(position.getY(i) * 13) * 0.6)))
    }
    colors.set([c.r, c.g, c.b], i * 3)
    // Curve the whole thing over, for the banana.
    position.setX(i, position.getX(i) + lean(kind, position.getY(i)))
  }
  if (shape.bend) geometry.computeVertexNormals()
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  return geometry
}

const geometries = new Map<string, LatheGeometry>()

function cached(kind: FruitKind, lo: number, hi: number): LatheGeometry {
  const key = `${kind}:${lo.toFixed(3)}:${hi.toFixed(3)}`
  let geometry = geometries.get(key)
  if (!geometry) geometries.set(key, (geometry = lathe(kind, lo, hi)))
  return geometry
}

const cherryStem = new TubeGeometry(
  new CatmullRomCurve3([new Vector3(0, 0, 0), new Vector3(0.02, 0.2, 0), new Vector3(0.1, 0.4, 0), new Vector3(0.25, 0.52, 0)]),
  12,
  0.016,
  6,
)

/** Where the face and arms attach on a given fruit. */
export function anchors(kind: FruitKind) {
  const y = SHAPES[kind].faceY * RADIUS
  return {
    /** Height of the middle of the face. */
    y,
    /** Distance from the centre line to the skin at eye, mouth and shoulder height. */
    eyeZ: radiusAt(kind, y + 0.08),
    mouthZ: radiusAt(kind, y - 0.06),
    shoulderX: radiusAt(kind, y),
  }
}

// ---------- Pieces ----------

function Leaf({ position }: { position: [number, number, number] }) {
  return (
    <mesh castShadow position={position} rotation={[0, 0, -0.9]} scale={[1, 0.22, 0.55]}>
      <sphereGeometry args={[0.15, 12, 8]} />
      <meshStandardMaterial color="#3f9b3a" roughness={0.7} />
    </mesh>
  )
}

/** Whatever grows out of the top: stem, leaf, calyx, crown. */
function Top({ kind }: { kind: FruitKind }) {
  const points = outline(kind)
  const y = points[points.length - 1].y
  const topper = SHAPES[kind].topper
  if (topper === 'none') return null
  if (topper === 'leaves') {
    return (
      <group position={[0, y + 0.01, 0]}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <group key={i} rotation={[0, (i / 6) * Math.PI * 2, 0]}>
            <mesh castShadow position={[0.15, -0.015, 0]} rotation={[0, 0, -0.3]} scale={[1, 0.2, 0.5]}>
              <sphereGeometry args={[0.16, 10, 8]} />
              <meshStandardMaterial color="#3f9b3a" roughness={0.7} />
            </mesh>
          </group>
        ))}
        <mesh castShadow position={[0, 0.07, 0]}>
          <cylinderGeometry args={[0.02, 0.03, 0.14, 6]} />
          <meshStandardMaterial color="#4f7d2a" roughness={0.9} />
        </mesh>
      </group>
    )
  }
  if (topper === 'cherry') {
    return (
      <group position={[0, y - 0.02, 0]}>
        <mesh castShadow geometry={cherryStem}>
          <meshStandardMaterial color="#6a8a2c" roughness={0.8} />
        </mesh>
        <Leaf position={[0.36, 0.55, 0]} />
      </group>
    )
  }
  if (topper === 'crown') {
    return (
      <group position={[0, y + 0.03, 0]}>
        {[0, 1, 2, 3, 4].map((i) => {
          const a = (i / 5) * Math.PI * 2
          return (
            <mesh key={i} position={[Math.cos(a) * 0.13, 0.04, Math.sin(a) * 0.13]} rotation={[Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6]}>
              <coneGeometry args={[0.05, 0.12, 4]} />
              <meshStandardMaterial color="#1f2f73" roughness={0.8} />
            </mesh>
          )
        })}
      </group>
    )
  }
  if (topper === 'calyx' || topper === 'nub') {
    return (
      <mesh position={[0, y + 0.005, 0]}>
        <cylinderGeometry args={[0.035, 0.07, 0.04, 8]} />
        <meshStandardMaterial color={topper === 'calyx' ? '#2f6b2a' : '#3b2a17'} roughness={0.9} />
      </mesh>
    )
  }
  return (
    <>
      <mesh castShadow position={[0.015, y + 0.1, 0]} rotation={[0, 0, -0.2]}>
        <cylinderGeometry args={[0.022, 0.034, 0.26, 6]} />
        <meshStandardMaterial color="#5a3a1c" roughness={0.9} />
      </mesh>
      {topper === 'stem-leaf' && <Leaf position={[0.14, y + 0.17, 0]} />}
    </>
  )
}

/** The whole fruit: shaped, shaded body plus whatever grows on top. Drawn inside the fruit's rigid body. */
export function FruitBody({ kind }: { kind: FruitKind }) {
  const shape = SHAPES[kind]
  const [min, max] = heightRange(kind)
  // Seeds spiral evenly over the skin, leaving the face clear.
  const seeds = useMemo(() => {
    if (!shape.seeds) return []
    const spots: { position: [number, number, number]; turn: number }[] = []
    for (let i = 0; i < 34; i++) {
      const y = min * 0.82 + ((max * 0.72 - min * 0.82) * (i + 0.5)) / 34
      const turn = i * 2.4
      const r = radiusAt(kind, y) + 0.004
      const onFace = Math.cos(turn) > 0.55 && Math.abs(y - shape.faceY * RADIUS) < 0.2
      if (!onFace) spots.push({ position: [Math.sin(turn) * r, y, Math.cos(turn) * r], turn })
    }
    return spots
  }, [kind, shape, min, max])
  const shineY = shape.faceY * RADIUS + 0.26
  return (
    <>
      <mesh castShadow geometry={cached(kind, min, max)}>
        <meshStandardMaterial vertexColors roughness={shape.roughness} />
      </mesh>
      <group position={[lean(kind, max), 0, 0]}>
        <Top kind={kind} />
      </group>
      {seeds.map((seed, i) => (
        <mesh key={i} position={seed.position} rotation={[0, seed.turn, 0]} scale={[1, 1.5, 0.5]}>
          <sphereGeometry args={[0.017, 6, 6]} />
          <meshStandardMaterial color={shape.seeds} roughness={0.6} />
        </mesh>
      ))}
      {shape.glossy && (
        <group rotation={[0, -0.75, 0]}>
          <mesh position={[0, shineY, radiusAt(kind, shineY) + 0.012]} rotation={[-0.45, 0, 0.5]} scale={[1, 1.7, 1]}>
            <circleGeometry args={[0.05, 12]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.5} />
          </mesh>
        </group>
      )}
    </>
  )
}

/**
 * A chopped fruit: four horizontal slices of its real shape, each its own rigid body,
 * with skin on the outside and pale flesh on the cut faces. They start stacked where
 * the whole fruit stood and are nudged apart so they topple onto the ground.
 */
export function FruitSlices({
  kind,
  position,
  quaternion,
}: {
  kind: FruitKind
  position: [number, number, number]
  quaternion: [number, number, number, number]
}) {
  const face = anchors(kind)
  const bands = useMemo(() => {
    const [min, max] = heightRange(kind)
    // Cut heights, top to bottom. The second band is the one carrying the face.
    const cuts = [max, face.y + 0.2, face.y - 0.15, face.y - 0.36, min].map((y) => Math.max(min, Math.min(max, y)))
    return cuts.slice(1).map((lo, i) => ({
      lo,
      hi: cuts[i],
      widest: Math.max(...outline(kind).filter((p) => p.y >= lo && p.y <= cuts[i]).map((p) => p.x), radiusAt(kind, lo), radiusAt(kind, cuts[i])),
      // Random shove, fixed for the life of the piece.
      linear: [(Math.random() - 0.5) * 3, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 3] as [number, number, number],
      angular: [(Math.random() - 0.5) * 6, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 6] as [number, number, number],
    }))
  }, [kind, face.y])
  const [min, max] = heightRange(kind)
  const flesh = LOOKS[kind].flesh

  return (
    <>
      {bands.map((band, i) => (
        <RigidBody
          key={i}
          colliders={false}
          position={position}
          quaternion={quaternion}
          linearVelocity={band.linear}
          angularVelocity={band.angular}
          linearDamping={0.3}
          angularDamping={0.8}
        >
          <CylinderCollider args={[Math.max(0.02, (band.hi - band.lo) / 2), band.widest * 0.92]} position={[lean(kind, (band.hi + band.lo) / 2), (band.hi + band.lo) / 2, 0]} friction={0.9} restitution={0.2} />
          <mesh castShadow geometry={cached(kind, band.lo, band.hi)}>
            <meshStandardMaterial vertexColors roughness={SHAPES[kind].roughness} />
          </mesh>
          {band.hi < max && (
            <mesh position={[lean(kind, band.hi), band.hi, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[radiusAt(kind, band.hi), 30]} />
              <meshStandardMaterial color={flesh} roughness={0.6} />
            </mesh>
          )}
          {band.lo > min && (
            <mesh position={[lean(kind, band.lo), band.lo, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <circleGeometry args={[radiusAt(kind, band.lo), 30]} />
              <meshStandardMaterial color={flesh} roughness={0.6} />
            </mesh>
          )}
          {i === 0 && (
            <group position={[lean(kind, max), 0, 0]}>
              <Top kind={kind} />
            </group>
          )}
          {/* The dead face, crosses for eyes, stays on its slice. */}
          {i === 1 && (
            <>
              {[-1, 1].map((side) =>
                [1, -1].map((tilt) => (
                  <mesh key={`${side}${tilt}`} position={[side * EYE_SPREAD, face.y + 0.08, face.eyeZ + 0.012]} rotation={[0, 0, (tilt * Math.PI) / 4]}>
                    <planeGeometry args={[0.1, 0.02]} />
                    <meshBasicMaterial color={LIMB_COLOR} />
                  </mesh>
                )),
              )}
              <mesh position={[0, face.y - 0.06, face.mouthZ + 0.008]}>
                <planeGeometry args={[0.13, 0.022]} />
                <meshBasicMaterial color={LIMB_COLOR} />
              </mesh>
            </>
          )}
        </RigidBody>
      ))}
    </>
  )
}
