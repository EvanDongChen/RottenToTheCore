import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, DoubleSide, Group, Quaternion, Vector3 } from 'three'
import type { Mesh, MeshStandardMaterial } from 'three'
import type { FruitKind } from '../sim/types'
import { fruitPositions, useSim } from '../ui/store'
import type { UiFruit } from '../ui/store'
import { stretching } from './idleLife'
import { anchors, radiusAt, EYE_SPREAD, LIMB_COLOR } from './fruitShapes'

// Tiny dot eyes and a flat 2D mouth that snaps between drawn shapes while talking, like
// animatic lip sync. Shape 0 is the resting line.
const EYE_RADIUS = 0.035
const MOUTH_SHAPES = 5 // shapes used for talking; one more, a frown, is kept for sulking
const FROWN = 5
const MOUTH_HOLD_MIN = 0.08 // seconds each shape is held
const MOUTH_HOLD_JITTER = 0.08

// Mood marks, drawn flat on the face like a cartoon: pink hatching on the cheeks, a red
// "popping vein" on the brow, and blue gloom lines hanging down the forehead.
const BLUSH_COLOR = '#ff6f8a'
const VEIN_COLOR = '#e2412f'
const GLOOM_COLOR = '#4a6fd0'
const FLUSH = new Color('#ff2a1a')
const PALE = new Color('#d8ecff')
const ANGER_FLARE_MS = 4000 // how long the angry flush shows after something makes a fruit angrier

/**
 * Where to stick a flat mark on the face: `x` across and `dy` up from the middle of the face,
 * pressed onto the skin of this particular fruit's shape and turned to face outward.
 */
function onSkin(kind: FruitKind, face: { y: number }, across: number, dy: number) {
  const y = face.y + dy
  // On a thin fruit, like the banana, marks are drawn in closer to the middle so they stay on the face.
  const x = Math.sign(across) * Math.min(Math.abs(across), radiusAt(kind, y) * 0.55)
  const r = Math.max(Math.abs(x) + 0.02, radiusAt(kind, y))
  // How much the skin leans back here, from how quickly the fruit narrows above this height.
  const slope = (radiusAt(kind, y - 0.03) - radiusAt(kind, y + 0.03)) / 0.06
  return {
    position: [x, y, Math.sqrt(r * r - x * x) + 0.014] as [number, number, number],
    rotation: [-Math.atan(slope), Math.asin(x / r), 0] as [number, number, number],
  }
}

/**
 * The face: eyes, brows, mouth and mood marks, drawn inside the fruit's body so it wobbles with it.
 * It has a life of its own: it blinks, steals glances at whoever it trusts least, and a Rotten
 * lets a smirk slip now and then when it thinks nobody is looking.
 */
export default function FruitFace({ fruit }: { fruit: UiFruit }) {
  const { id, kind, alive } = fruit
  const speechText = useSim((s) => s.speech[id])
  const reaction = useSim((s) => s.reactions[id])
  const pointAt = useSim((s) => s.votes[id])
  const armed = useSim((s) => s.attack?.attackerId === id)
  const face = useMemo(() => anchors(kind), [kind])

  const root = useRef<Group>(null)
  const blushMarks = useRef<Group>(null)
  const veinMark = useRef<Group>(null)
  const gloomMarks = useRef<Group>(null)
  const mouthMeshes = useRef<(Mesh | null)[]>([])
  const eyeMeshes = useRef<(Mesh | null)[]>([])
  const browMeshes = useRef<(Mesh | null)[]>([])
  /** The body's material, found once, for tinting the skin with mood. */
  const skin = useRef<MeshStandardMaterial | null>(null)
  const tint = useRef(0)
  /** Anger last frame, and until when the angry flush shows after it last went up. */
  const lastAnger = useRef(fruit.mood.anger)
  const angerUntil = useRef(0)
  const mouthShape = useRef(0)
  const mouthTimer = useRef(0)
  /** When this fruit next blinks, glances at its suspect, or (if it is Rotten) lets a smirk slip. */
  const tics = useRef({ blinkAt: 0, blinkEnd: 0, glanceAt: 3000 + Math.random() * 5000, glanceEnd: 0, smirkAt: 6000 + Math.random() * 9000, smirkEnd: 0 })
  // Slightly uneven eyes make the face derpier.
  const eyeOffsets = useMemo(() => [(Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.04], [])
  const v = useMemo(() => ({ pos: new Vector3(), side: new Vector3(), to: new Vector3(), quat: new Quaternion() }), [])

  useFrame((_, delta) => {
    const party = useSim.getState().party
    const dancing = alive && !!party && party.dancers.includes(id)
    const mood = alive && !dancing ? reaction : undefined

    // Mouth: resting line when quiet; while talking, snap to a new shape every few frames.
    let shape = 0
    if (speechText && alive) {
      mouthTimer.current -= delta
      shape = mouthShape.current
      if (mouthTimer.current <= 0) {
        // Pick any shape other than the current one.
        shape = (shape + 1 + Math.floor(Math.random() * (MOUTH_SHAPES - 1))) % MOUTH_SHAPES
        mouthTimer.current = MOUTH_HOLD_MIN + Math.random() * MOUTH_HOLD_JITTER
      }
    } else {
      mouthTimer.current = 0
    }
    // Dancers and cheerers grin, gaspers gape, sulkers frown, and the accused's lip wobbles.
    if (!speechText) {
      if (dancing || mood === 'cheer') shape = 4
      else if (mood === 'gasp') shape = 3
      else if (mood === 'sulk') shape = FROWN
      else if (mood === 'shake') shape = Math.floor(performance.now() / 70) % 2
      else if (mood === 'puzzle' || mood === 'blush') shape = 1
      // A grieving fruit's mouth stays turned down.
      else if (alive && !dancing && fruit.mood.grief > 0.5) shape = FROWN
    }

    const now = performance.now()
    const tic = tics.current
    if (now > tic.blinkAt) {
      tic.blinkEnd = now + 110
      tic.blinkAt = now + 1800 + Math.random() * 4200
    }
    if (now > tic.glanceAt) {
      tic.glanceEnd = now + 750
      tic.glanceAt = now + 3000 + Math.random() * 5000
    }
    if (now > tic.smirkAt) {
      tic.smirkEnd = now + 700
      tic.smirkAt = now + 7000 + Math.random() * 8000
    }
    const calm = alive && !mood && !dancing
    const smirking = calm && !speechText && fruit.role === 'rotten' && now < tic.smirkEnd
    let glance = 0
    const suspect = calm && now < tic.glanceEnd && fruit.suspect ? fruitPositions.get(fruit.suspect) : undefined
    if (suspect && root.current) {
      // Which side of this fruit the suspect is standing on.
      root.current.getWorldPosition(v.pos)
      root.current.getWorldQuaternion(v.quat)
      glance = Math.sign(v.side.set(1, 0, 0).applyQuaternion(v.quat).dot(v.to.subVectors(suspect, v.pos)))
    }

    // Mood on the face, cartoon style. Anger: a red flush and a popping vein. Fear, grief and
    // guilt: blue gloom lines down the forehead (and a pale face with fear). Flattered, smug
    // or delighted: pink hatching on the cheeks.
    const feel = fruit.mood
    // Anger lingers in the mood, so the flush and vein only show in the moment: for a few
    // seconds after something makes it angrier, or while it speaks its mind angrily.
    if (feel.anger > lastAnger.current + 0.05) angerUntil.current = now + ANGER_FLARE_MS
    lastAnger.current = feel.anger
    const angry = alive && (now < angerUntil.current || (feel.anger > 0.45 && !!speechText))
    const gloomy = alive && !angry && (mood === 'shake' || mood === 'sulk' || feel.fear > 0.5 || feel.grief > 0.45 || feel.guilt > 0.45)
    // Likewise the face only goes pale at the moment of a fright, not for as long as the fear lasts.
    const pale = alive && !angry && (mood === 'shake' || mood === 'gasp')
    const blushing = alive && !angry && (mood === 'blush' || mood === 'cheer' || dancing || feel.smug > 0.45)
    if (blushMarks.current) blushMarks.current.visible = blushing
    if (veinMark.current) {
      veinMark.current.visible = angry
      veinMark.current.scale.setScalar(1 + Math.max(0, Math.sin(now * 0.012)) * 0.25)
    }
    if (gloomMarks.current) {
      gloomMarks.current.visible = gloomy
      gloomMarks.current.position.y = Math.sin(now * 0.003) * 0.006
    }
    if (!skin.current && root.current?.parent) {
      root.current.parent.traverse((o) => {
        const material = (o as Mesh).material as MeshStandardMaterial | undefined
        if (!skin.current && material?.vertexColors) skin.current = material
      })
    }
    if (skin.current) {
      const want = angry ? 0.32 : pale ? 0.28 : blushing ? 0.1 : 0
      tint.current += (want - tint.current) * Math.min(1, delta * 4)
      skin.current.emissive.copy(angry ? FLUSH : pale ? PALE : FLUSH)
      skin.current.emissiveIntensity = tint.current
    }

    // Eyes go wide with shock or fear, droop when sulking, and close for a blink.
    eyeMeshes.current.forEach((mesh) => {
      if (!mesh) return
      if (mood === 'sulk') mesh.scale.set(1.1, 0.4, 1)
      // Shut tight for a blink, or squeezed shut at the top of a big stretch.
      else if ((calm && now < tic.blinkEnd) || (stretching.get(id) ?? 0) > 0.5) mesh.scale.set(1.1, 0.12, 1)
      else mesh.scale.setScalar(mood === 'gasp' ? 1.8 : mood === 'shake' ? 1.35 : 1)
      mesh.position.x = glance * 0.026
    })
    // Eyebrows only show when there is a feeling to show: a scowl, worry, surprise, or the smirk.
    const brow =
      alive && (armed || (pointAt && speechText))
        ? 'angry'
        : mood === 'shake' || mood === 'sulk'
          ? 'worried'
          : mood === 'gasp' || mood === 'cheer' || mood === 'puzzle'
            ? 'raised'
            : smirking
              ? 'smirk'
              : // No reaction going on: whatever it has been feeling lately shows instead.
                calm && feel.anger > 0.5
                ? 'angry'
                : calm && (feel.fear > 0.5 || feel.guilt > 0.5 || feel.grief > 0.5)
                  ? 'worried'
                  : null
    browMeshes.current.forEach((mesh, i) => {
      if (!mesh) return
      const side = i === 0 ? -1 : 1
      mesh.visible = !!brow
      mesh.rotation.z = brow === 'angry' ? side * 0.5 : brow === 'worried' ? -side * 0.4 : brow === 'smirk' ? (i === 1 ? -0.25 : 0.35) : 0
      mesh.position.y = 0.078 + (brow === 'raised' || (brow === 'smirk' && i === 1) ? 0.03 : brow === 'angry' ? -0.012 : 0)
    })
    // The smirk: the resting mouth tips up at one end.
    if (mouthMeshes.current[0]) mouthMeshes.current[0].rotation.z = smirking ? 0.38 : 0
    mouthShape.current = shape
    mouthMeshes.current.forEach((mesh, i) => {
      if (mesh) mesh.visible = i === shape
    })
  })

  return (
    <group ref={root}>
      {/* Eyes: dots while alive, little crosses once dead. */}
      {[-1, 1].map((side, i) => (
        <group key={side} position={[side * EYE_SPREAD, face.y + 0.08 + eyeOffsets[i], face.eyeZ * 0.985]}>
          <mesh visible={alive} ref={(m) => void (eyeMeshes.current[i] = m)}>
            <sphereGeometry args={[EYE_RADIUS, 12, 12]} />
            <meshBasicMaterial color={LIMB_COLOR} />
          </mesh>
          <mesh visible={false} ref={(m) => void (browMeshes.current[i] = m)} position={[0, 0.078, 0.014]}>
            <planeGeometry args={[0.09, 0.02]} />
            <meshBasicMaterial color={LIMB_COLOR} />
          </mesh>
          {[1, -1].map((tilt) => (
            <mesh key={tilt} visible={!alive} position={[0, 0, 0.03]} rotation={[0, 0, (tilt * Math.PI) / 4]}>
              <planeGeometry args={[0.1, 0.02]} />
              <meshBasicMaterial color={LIMB_COLOR} />
            </mesh>
          ))}
        </group>
      ))}

      {/* Mood marks, drawn flat on the skin. */}
      <group ref={blushMarks} visible={false}>
        {[-1, 1].map((side) => (
          <group key={side} {...onSkin(kind, face, side * 0.17, -0.03)}>
            {[-1, 0, 1].map((n) => (
              <mesh key={n} position={[n * 0.04, 0, 0]} rotation={[0, 0, 0.5]}>
                <planeGeometry args={[0.022, 0.09]} />
                <meshBasicMaterial color={BLUSH_COLOR} side={DoubleSide} />
              </mesh>
            ))}
          </group>
        ))}
      </group>
      <group {...onSkin(kind, face, 0.2, 0.27)}>
        <group ref={veinMark} visible={false}>
          {/* Four little arcs bowing in toward each other: the cartoon popping vein. */}
          {(
            [
              [1, 1, Math.PI],
              [-1, 1, Math.PI * 1.5],
              [-1, -1, 0],
              [1, -1, Math.PI / 2],
            ] as const
          ).map(([x, y, start]) => (
            <mesh key={start} position={[x * 0.065, y * 0.065, 0]}>
              <ringGeometry args={[0.04, 0.065, 12, 1, start, Math.PI / 2]} />
              <meshBasicMaterial color={VEIN_COLOR} side={DoubleSide} />
            </mesh>
          ))}
        </group>
      </group>
      <group ref={gloomMarks} visible={false}>
        {[-0.16, -0.08, 0, 0.08, 0.16].map((x, i) => (
          <group key={x} {...onSkin(kind, face, x, 0.26)}>
            <mesh position={[0, -0.04 - (i % 2) * 0.02, 0]}>
              <planeGeometry args={[0.024, 0.17 + (i % 2) * 0.05]} />
              <meshBasicMaterial color={GLOOM_COLOR} side={DoubleSide} />
            </mesh>
          </group>
        ))}
      </group>

      {/* Flat mouth shapes, one visible at a time: line, short line, "o", open oval, open grin, frown. */}
      <group position={[0, face.y - 0.06, face.mouthZ + 0.008]}>
        {[
          <planeGeometry args={[0.15, 0.022]} />,
          <planeGeometry args={[0.08, 0.022]} />,
          <ringGeometry args={[0.028, 0.05, 20]} />,
          <circleGeometry args={[0.055, 20]} />,
          <circleGeometry args={[0.08, 20, Math.PI, Math.PI]} />,
          <ringGeometry args={[0.05, 0.072, 20, 1, 0, Math.PI]} />,
        ].map((geometry, i) => (
          <mesh
            key={i}
            ref={(m) => void (mouthMeshes.current[i] = m)}
            visible={i === 0}
            scale={i === 3 ? [0.8, 1.1, 1] : 1}
            position={[0, i === 4 ? 0.03 : i === FROWN ? -0.045 : 0, 0]}
          >
            {geometry}
            <meshBasicMaterial color={LIMB_COLOR} />
          </mesh>
        ))}
      </group>
    </group>
  )
}
