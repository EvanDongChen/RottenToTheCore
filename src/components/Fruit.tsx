import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { BallCollider, RigidBody, useBeforePhysicsStep } from '@react-three/rapier'
import type { RapierRigidBody } from '@react-three/rapier'
import { Group, Quaternion, Vector3 } from 'three'
import type { Mesh } from 'three'
import { PARTY_BEAT_MS } from '../ui/sfx'
import { currentGame, fruitPositions, fruitSpeeds, ghostPositions, simTargets, useSim } from '../ui/store'
import { puff } from './Dust'
import Emote from './Emote'
import FruitFace from './FruitFace'
import { ROLE_TAG } from './fruitLooks'
import { anchors, FruitBody, FruitSlices, LIMB_COLOR, RADIUS } from './fruitShapes'
import RichText from './RichText'

// Body
const HOVER_HEIGHT = 1.0 // body centre above the ground; the legs fill the gap
const GRAVITY = 20

// Tuning. Low damping ratios are what make it wobble.
const HOVER_STIFFNESS = 120
const HOVER_DAMPING = 6
const UPRIGHT_STIFFNESS = 60
const UPRIGHT_DAMPING = 3.5
const YAW_STIFFNESS = 40
const YAW_DAMPING = 8
const WALK_SPEED = 2.6 // the sim's walking pace, for judging how hurried a stride looks
const WALK_GAIN = 6
const MAX_SPEED = 24 // fastest a body may go, however far the game is sped up
const FOLLOW_GAIN = 5 // how hard the body is pulled back onto the sim's position
const SNAP_DISTANCE = 3 // further than this from the sim's position, the body jumps back to it
const LEAN_GAIN = 1.5
const WADDLE_TORQUE = 9
const ARRIVE_DISTANCE = 0.2
const MOVING_SPEED = 0.05 // the sim is moving the fruit if it is going at least this fast

// Legs
const HIP_SPREAD = 0.22
const FOOT_SPREAD = 0.28
const STEP_TRIGGER = 0.35
const STEP_TIME = 0.16
const STEP_LIFT = 0.25
const FOOT_Y = 0.07

// Arms: two-segment floppy sticks, simulated as a damped verlet chain.
const ARM_SEGMENT = 0.3
const ARM_DRAG = 0.94
const ARM_GRAVITY = 12

const RUN_DUST = 3.2 // running faster than this, for the game speed, kicks up dust at every step
const STREAK_SPEED = 3 // the Rotten trails speed lines above this speed

const UP = new Vector3(0, 1, 0)
const DT = 1 / 60
const limbDir = new Vector3()

/** Stretch a unit-height cylinder so it spans from a to b. */
function placeLimb(mesh: Mesh | null, a: Vector3, b: Vector3) {
  if (!mesh) return
  limbDir.subVectors(b, a)
  const length = limbDir.length()
  mesh.position.copy(a).addScaledVector(limbDir, 0.5)
  mesh.quaternion.setFromUnitVectors(UP, limbDir.divideScalar(length || 1))
  mesh.scale.set(1, length, 1)
}

interface ArmPoint {
  pos: Vector3
  prev: Vector3
}

interface Foot {
  pos: Vector3
  from: Vector3
  to: Vector3
  t: number // 1 = planted, <1 = mid-step
}

function makeFoot(x: number, z: number): Foot {
  const pos = new Vector3(x, FOOT_Y, z)
  return { pos, from: pos.clone(), to: pos.clone(), t: 1 }
}

/**
 * One fruit on stilt legs. The sim decides where it is: every physics step the body is steered
 * toward the sim's position (led by the sim's velocity, so it keeps up), and physics only adds
 * the wobble, the waddle and the bumps. If it gets shoved too far off, it jumps back.
 */
export default function Fruit({ id }: { id: string }) {
  // Keep the last known state so a fruit removed from the roster can still render its final frame.
  const live = useSim((s) => s.fruits.find((f) => f.id === id))
  const lastKnown = useRef(live)
  if (live) lastKnown.current = live
  const fruit = lastKnown.current!
  const speechText = useSim((s) => s.speech[id])
  const thinking = useSim((s) => s.thinking[id])
  const showRole = useSim((s) => s.revealRoles || !s.fruits.find((f) => f.id === id)?.alive)
  const showThought = useSim((s) => s.showThoughts)
  // During a meeting vote: who this fruit is pointing at, and how many are pointing at it.
  const pointAt = useSim((s) => s.votes[id])
  const votesAgainst = useSim((s) => Object.values(s.votes).filter((target) => target === id).length)
  const reaction = useSim((s) => s.reactions[id])
  const armed = useSim((s) => s.attack?.attackerId === id)
  const striking = useSim((s) => s.attack?.attackerId === id && s.attack.striking)
  // Set when the fruit is chopped: where the whole body was, so the slices can take its place.
  const [chop, setChop] = useState<{ position: [number, number, number]; quaternion: [number, number, number, number] } | null>(null)
  const knife = useRef<Group>(null)
  const streaks = useRef<Group>(null)
  /** Vertical speed last frame, for spotting the moment it lands. */
  const lastFall = useRef(0)
  const { alive, kind } = fruit
  // Where the arms sit on this fruit's particular shape.
  const face = useMemo(() => anchors(kind), [kind])

  // Spawn where the sim has it, fixed at mount.
  const [spawn] = useState<[number, number, number]>(() => {
    const pos = currentGame().fruits.find((f) => f.id === id)?.pos ?? [0, 0]
    return [pos[0], HOVER_HEIGHT, pos[1]]
  })

  const body = useRef<RapierRigidBody>(null)
  const visual = useRef<Group>(null)
  const overlay = useRef<Group>(null)
  const armMeshes = useRef<(Mesh | null)[]>([null, null, null, null])
  // Per arm: [elbow, hand]. Seeded on the first frame once the body position is known.
  const arms = useRef<ArmPoint[][] | null>(null)
  const legMeshes = useRef<(Mesh | null)[]>([null, null])
  const footMeshes = useRef<(Mesh | null)[]>([null, null])
  const feet = useRef<Foot[]>([makeFoot(spawn[0] - FOOT_SPREAD, spawn[2]), makeFoot(spawn[0] + FOOT_SPREAD, spawn[2])])
  const waddlePhase = useRef(Math.random() * Math.PI * 2)
  /** Last beat of the party music this fruit hopped on. */
  const lastBeat = useRef(-1)
  const lastHop = useRef(-1)
  /** Puts each fruit's cheering hops slightly out of step with its neighbours'. */
  const hopOffset = useRef(Math.random())
  /** Drama queens overreact: bigger jumps and bigger marks over their heads. */
  const dramatic = fruit.traits.quirks.includes('dramatic')

  // Scratch vectors, reused every frame to avoid allocation.
  const v = useMemo(
    () => ({
      pos: new Vector3(),
      vel: new Vector3(),
      up: new Vector3(),
      fwd: new Vector3(),
      right: new Vector3(),
      want: new Vector3(),
      accel: new Vector3(),
      torque: new Vector3(),
      tmp: new Vector3(),
      hip: new Vector3(),
      shoulder: new Vector3(),
      quat: new Quaternion(),
    }),
    [],
  )

  useEffect(() => {
    fruitPositions.set(id, new Vector3(spawn[0], spawn[1], spawn[2]))
    return () => {
      fruitPositions.delete(id)
      fruitSpeeds.delete(id)
    }
  }, [id, spawn])

  // A little hop when this fruit starts talking.
  useEffect(() => {
    const b = body.current
    if (!speechText || !b || !alive) return
    const m = b.mass()
    b.applyImpulse({ x: 0, y: m * 3.5, z: 0 }, true)
    b.applyTorqueImpulse({ x: (Math.random() - 0.5) * m * 0.5, y: 0, z: (Math.random() - 0.5) * m * 0.5 }, true)
  }, [speechText, alive])

  // A gasp: jump back from whatever everyone is staring at. Each fruit is a touch late or early.
  useEffect(() => {
    if (reaction !== 'gasp' || !alive) return
    const timer = setTimeout(() => {
      const b = body.current
      if (!b) return
      const m = b.mass()
      const r = b.rotation()
      v.tmp.set(0, 0, 1).applyQuaternion(v.quat.set(r.x, r.y, r.z, r.w))
      const flinch = dramatic ? 1.6 : 1
      b.applyImpulse({ x: -v.tmp.x * m * 1.8 * flinch, y: m * 3.6 * flinch, z: -v.tmp.z * m * 1.8 * flinch }, true)
      b.applyTorqueImpulse({ x: (Math.random() - 0.5) * m * 0.6, y: 0, z: (Math.random() - 0.5) * m * 0.6 }, true)
    }, Math.random() * 220)
    return () => clearTimeout(timer)
  }, [reaction, alive])

  // The Rotten lunges at its victim when it strikes.
  useEffect(() => {
    const b = body.current
    const victimId = useSim.getState().attack?.victimId
    const victim = victimId ? fruitPositions.get(victimId) : undefined
    if (!striking || !b || !victim) return
    const t = b.translation()
    const d = Math.hypot(victim.x - t.x, victim.z - t.z) || 1
    const m = b.mass()
    b.applyImpulse({ x: ((victim.x - t.x) / d) * m * 4, y: m * 3, z: ((victim.z - t.z) / d) * m * 4 }, true)
  }, [striking])

  // Death. Sliced: the body is swapped for a stack of slices that fall apart.
  // Otherwise (ejected): balance is switched off and the fruit is flung away as a ragdoll.
  useEffect(() => {
    const b = body.current
    if (!b) return
    if (alive) {
      b.setEnabled(true)
      b.setLinearDamping(0.1)
      b.setAngularDamping(0.2)
      setChop(null)
      return
    }
    if (useSim.getState().chopped[id]) {
      const p = b.translation()
      const q = b.rotation()
      setChop({ position: [p.x, p.y, p.z], quaternion: [q.x, q.y, q.z, q.w] })
      b.setEnabled(false)
      return
    }
    b.setLinearDamping(0.6)
    b.setAngularDamping(1.2)
    const m = b.mass()
    b.applyImpulse({ x: 0, y: m * 10, z: 0 }, true)
    b.applyTorqueImpulse({ x: (Math.random() - 0.5) * m * 3, y: (Math.random() - 0.5) * m, z: (Math.random() - 0.5) * m * 3 }, true)
  }, [alive])

  useBeforePhysicsStep(() => {
    const b = body.current
    if (!b) return
    const sim = useSim.getState()
    const moving = b.linvel()
    fruitSpeeds.set(id, Math.hypot(moving.x, moving.z))
    if (!sim.fruits.find((f) => f.id === id)?.alive) return // ragdoll: physics only

    const m = b.mass()
    const inertia = 0.4 * m * RADIUS * RADIUS
    const t = b.translation()
    const lv = b.linvel()
    const av = b.angvel()
    const r = b.rotation()
    v.quat.set(r.x, r.y, r.z, r.w)
    v.up.set(0, 1, 0).applyQuaternion(v.quat)
    v.fwd.set(0, 0, 1).applyQuaternion(v.quat).setY(0)
    if (v.fwd.lengthSq() < 1e-4) v.fwd.set(0, 0, 1)
    v.fwd.normalize()

    // Hover spring: holds the body up on its legs, with bounce. Only pushes, never pulls down.
    // A sulking fruit sags on its legs.
    const mood = sim.reactions[id]
    const heightError = HOVER_HEIGHT - (mood === 'sulk' ? 0.16 : 0) - t.y
    if (heightError > -0.2) {
      const lift = GRAVITY + HOVER_STIFFNESS * heightError - HOVER_DAMPING * lv.y
      if (lift > 0) b.applyImpulse({ x: 0, y: m * lift * DT, z: 0 }, true)
    }

    // Where to go: wherever the sim says, led by the sim's own velocity so the body keeps pace.
    const goal = simTargets.get(id)
    const ex = goal ? goal.x - t.x : 0
    const ez = goal ? goal.z - t.z : 0
    const off = Math.sqrt(ex * ex + ez * ez)
    if (goal && off > SNAP_DISTANCE) {
      // Shoved or stuck far from where it should be: the sim wins.
      b.setTranslation({ x: goal.x, y: t.y, z: goal.z }, true)
      b.setLinvel({ x: goal.vx, y: lv.y, z: goal.vz }, true)
    }
    const leading = goal ? Math.hypot(goal.vx, goal.vz) : 0
    const walking = leading > MOVING_SPEED || off > ARRIVE_DISTANCE
    if (goal && walking) {
      v.want.set(goal.vx + ex * FOLLOW_GAIN, 0, goal.vz + ez * FOLLOW_GAIN)
      if (v.want.length() > MAX_SPEED) v.want.setLength(MAX_SPEED)
    } else {
      v.want.set(0, 0, 0)
    }

    v.accel.set((v.want.x - lv.x) * WALK_GAIN, 0, (v.want.z - lv.z) * WALK_GAIN)
    b.applyImpulse({ x: m * v.accel.x * DT, y: 0, z: m * v.accel.z * DT }, true)

    // Upright spring (under-damped), plus a lean into acceleration.
    v.torque.crossVectors(v.up, UP).multiplyScalar(UPRIGHT_STIFFNESS)
    v.torque.x -= av.x * UPRIGHT_DAMPING
    v.torque.z -= av.z * UPRIGHT_DAMPING
    v.torque.add(v.tmp.crossVectors(UP, v.accel).multiplyScalar(LEAN_GAIN))

    // Side-to-side waddle while walking.
    if (walking) {
      waddlePhase.current += DT * 11 * Math.min(2, sim.speed)
      v.torque.addScaledVector(v.fwd, Math.sin(waddlePhase.current) * WADDLE_TORQUE)
    }

    // Body language. Shaking: a nervous rattle. Sulking: head hung forward. Cheering: quick hops.
    if (mood === 'shake') {
      v.torque.x += (Math.random() - 0.5) * 90
      v.torque.z += (Math.random() - 0.5) * 90
    } else if (mood === 'sulk') {
      v.torque.add(v.tmp.crossVectors(UP, v.fwd).multiplyScalar(20))
    } else if (mood === 'cheer') {
      const hop = Math.floor(performance.now() / 380 + hopOffset.current)
      if (hop !== lastHop.current) {
        lastHop.current = hop
        b.applyImpulse({ x: 0, y: m * 3.8, z: 0 }, true)
      }
    }

    // Face the direction of travel; when standing, face who it is talking to, else whoever is
    // talking, else keep facing the way it was.
    if (walking && v.want.lengthSq() > 0.01) {
      v.tmp.copy(v.want)
    } else {
      let lookId = sim.lookAt[id] ?? (sim.focusId !== id ? sim.focusId : null)
      // Crowd reactions. A fruit being accused draws every eye nearby...
      let nearest = 7
      let drawn = false
      for (const otherId in sim.reactions) {
        if (otherId === id || sim.reactions[otherId] !== 'shake') continue
        const p = fruitPositions.get(otherId)
        const d = p ? Math.hypot(p.x - t.x, p.z - t.z) : Infinity
        if (d < nearest) {
          nearest = d
          lookId = otherId
          drawn = true
        }
      }
      // ...and a fruit with nobody to talk to turns to watch anyone hurrying past.
      if (!drawn && !sim.lookAt[id]) {
        nearest = 4.5
        for (const [otherId, speed] of fruitSpeeds) {
          if (otherId === id || speed < 1.3 * Math.max(1, sim.speed)) continue
          const p = fruitPositions.get(otherId)
          const d = p ? Math.hypot(p.x - t.x, p.z - t.z) : Infinity
          if (d < nearest) {
            nearest = d
            lookId = otherId
          }
        }
      }
      const focus = lookId ? (lookId.startsWith('ghost:') ? ghostPositions.get(lookId.slice(6)) : fruitPositions.get(lookId)) : undefined
      if (focus) v.tmp.set(focus.x - t.x, 0, focus.z - t.z)
      else v.tmp.set(0, 0, 0)
    }
    // Dance party: hop on every beat, rock from side to side, and spin on the spot.
    const party = sim.party
    if (party && !walking && party.dancers.includes(id)) {
      const beat = (performance.now() - party.at) / PARTY_BEAT_MS
      const index = Math.floor(beat)
      if (index !== lastBeat.current) {
        lastBeat.current = index
        b.applyImpulse({ x: 0, y: m * 4.2, z: 0 }, true)
        v.torque.addScaledVector(v.fwd, (index % 2 ? 1 : -1) * 28)
      }
      const turn = beat * 1.3 + waddlePhase.current
      v.tmp.set(Math.sin(turn), 0, Math.cos(turn))
    }

    if (v.tmp.lengthSq() > 1e-4) {
      v.tmp.normalize()
      const yawError = Math.atan2(v.fwd.z * v.tmp.x - v.fwd.x * v.tmp.z, v.fwd.dot(v.tmp))
      v.torque.y += yawError * YAW_STIFFNESS - av.y * YAW_DAMPING
    } else {
      v.torque.y -= av.y * YAW_DAMPING
    }

    b.applyTorqueImpulse({ x: inertia * v.torque.x * DT, y: inertia * v.torque.y * DT, z: inertia * v.torque.z * DT }, true)
  })

  useFrame((_, delta) => {
    const b = body.current
    if (!b) return
    const t = b.translation()
    const lv = b.linvel()
    const r = b.rotation()
    v.pos.set(t.x, t.y, t.z)
    v.vel.set(lv.x, 0, lv.z)
    v.quat.set(r.x, r.y, r.z, r.w)
    fruitPositions.get(id)?.copy(v.pos)
    const party = useSim.getState().party
    const dancing = alive && !!party && party.dancers.includes(id)
    const beat = party ? (performance.now() - party.at) / PARTY_BEAT_MS : performance.now() / 190
    const mood = alive && !dancing ? reaction : undefined

    // Squash and stretch from vertical speed.
    if (visual.current) {
      const stretch = Math.max(-0.2, Math.min(0.2, lv.y * 0.05))
      visual.current.scale.set(1 - stretch * 0.5, 1 + stretch, 1 - stretch * 0.5)
      // Shaking fruits also judder from side to side.
      visual.current.position.x = mood === 'shake' ? Math.sin(performance.now() * 0.09) * 0.035 : 0
    }

    if (overlay.current) overlay.current.position.set(t.x, t.y + 1.15, t.z)

    // Landing: a fall that has just stopped kicks up a puff of dust.
    if (!chop && lastFall.current < -2.5 && lv.y > lastFall.current + 1.5 && t.y < HOVER_HEIGHT + 0.35) {
      puff(t.x, t.z, Math.min(1.5, -lastFall.current / 5))
    }
    lastFall.current = lv.y

    // Speed lines streaming out behind a Rotten as it rushes in for the kill.
    if (streaks.current) {
      const speed = Math.hypot(lv.x, lv.z)
      const show = armed && alive && speed > STREAK_SPEED
      streaks.current.visible = show
      if (show) {
        streaks.current.position.set(t.x, t.y, t.z)
        streaks.current.rotation.set(0, Math.atan2(lv.x, lv.z), 0)
        streaks.current.children.forEach((line, i) => {
          // Each line flickers in length so they read as rushing air.
          const length = (0.5 + speed * 0.14) * (0.6 + Math.random() * 0.6)
          line.scale.set(1, 1, length)
          line.position.z = -0.95 - length / 2 - (i % 2) * 0.2
        })
      }
    }

    // Floppy arms: verlet points hanging off each shoulder, dragged around by the body.
    const dt = Math.min(delta, 1 / 30)
    if (!arms.current) {
      arms.current = [-1, 1].map(() =>
        [1, 2].map((n) => {
          const pos = v.pos.clone().setY(v.pos.y - ARM_SEGMENT * n)
          return { pos, prev: pos.clone() }
        }),
      )
    }
    arms.current.forEach((arm, i) => {
      const side = i === 0 ? -1 : 1
      v.shoulder.set(side * face.shoulderX * 0.93, face.y, 0).applyQuaternion(v.quat).add(v.pos)
      for (const point of arm) {
        v.tmp.subVectors(point.pos, point.prev).multiplyScalar(ARM_DRAG)
        point.prev.copy(point.pos)
        point.pos.add(v.tmp)
        point.pos.y -= ARM_GRAVITY * dt * dt
      }
      // The knife arm is held up and forward instead of dangling.
      if (armed && i === 1) {
        v.fwd.set(0, 0, 1).applyQuaternion(v.quat)
        arm[0].pos.lerp(v.tmp.copy(v.shoulder).addScaledVector(v.fwd, 0.26).addScaledVector(UP, 0.05), 0.5)
        arm[1].pos.lerp(v.tmp.copy(v.shoulder).addScaledVector(v.fwd, striking ? 0.6 : 0.4).addScaledVector(UP, striking ? 0.05 : 0.5), 0.5)
      }
      // Dancing, cheering or gasping: both arms in the air, pumping in turn with the beat.
      if (dancing || mood === 'cheer' || mood === 'gasp') {
        const pump = Math.sin(beat * Math.PI + i * Math.PI)
        v.tmp.set(side, 0, 0).applyQuaternion(v.quat)
        arm[0].pos.lerp(v.hip.copy(v.shoulder).addScaledVector(v.tmp, 0.22).addScaledVector(UP, 0.16), 0.5)
        arm[1].pos.lerp(v.hip.copy(v.shoulder).addScaledVector(v.tmp, 0.26 + pump * 0.1).addScaledVector(UP, 0.5 + pump * 0.12), 0.5)
      }
      // Voting: the right arm points straight at the chosen fruit.
      const pointed = alive && i === 1 && pointAt ? fruitPositions.get(pointAt) : undefined
      if (pointed) {
        v.tmp.subVectors(pointed, v.shoulder).setY(0).normalize()
        arm[0].pos.lerp(v.hip.copy(v.shoulder).addScaledVector(v.tmp, ARM_SEGMENT).addScaledVector(UP, 0.06), 0.6)
        arm[1].pos.lerp(v.hip.copy(v.shoulder).addScaledVector(v.tmp, ARM_SEGMENT * 2).addScaledVector(UP, 0.12), 0.6)
      }
      for (let pass = 0; pass < 3; pass++) {
        arm.forEach((point, n) => {
          const anchor = n === 0 ? v.shoulder : arm[0].pos
          v.tmp.subVectors(point.pos, anchor)
          if (v.tmp.lengthSq() < 1e-8) v.tmp.set(side, -1, 0)
          point.pos.copy(anchor).addScaledVector(v.tmp.normalize(), ARM_SEGMENT)
          // Keep the arm outside the body and above the ground.
          v.tmp.subVectors(point.pos, v.pos)
          if (v.tmp.length() < RADIUS * 1.06) point.pos.copy(v.pos).addScaledVector(v.tmp.normalize(), RADIUS * 1.06)
          if (point.pos.y < 0.03) point.pos.y = 0.03
        })
      }
      placeLimb(armMeshes.current[i * 2], v.shoulder, arm[0].pos)
      placeLimb(armMeshes.current[i * 2 + 1], arm[0].pos, arm[1].pos)
    })

    // Knife sits in the right hand, blade up (tipped forward on the strike).
    if (knife.current) {
      knife.current.visible = armed
      if (armed) {
        v.fwd.set(0, 0, 1).applyQuaternion(v.quat)
        knife.current.position.copy(arms.current[1][1].pos)
        knife.current.quaternion.setFromUnitVectors(UP, v.tmp.copy(UP).multiplyScalar(striking ? 0.2 : 1).addScaledVector(v.fwd, striking ? 1 : 0.35).normalize())
      }
    }

    // Legs. Alive: procedural stepping, a foot stays planted until the body drifts away
    // from it. Dead: the legs just stick out limply from the body.
    v.fwd.set(0, 0, 1).applyQuaternion(v.quat).setY(0)
    if (v.fwd.lengthSq() < 1e-4) v.fwd.set(0, 0, 1)
    v.fwd.normalize()
    v.right.set(v.fwd.z, 0, -v.fwd.x)

    // Legs step quicker when the fruit is hurrying.
    const stride = Math.max(1, v.vel.length() / WALK_SPEED)
    feet.current.forEach((foot, i) => {
      const side = i === 0 ? -1 : 1
      const other = feet.current[1 - i]
      v.hip.set(side * HIP_SPREAD, -RADIUS * 0.75, 0).applyQuaternion(v.quat).add(v.pos)

      if (!alive) {
        foot.pos.set(side * HIP_SPREAD * 1.4, -RADIUS - 0.4, 0).applyQuaternion(v.quat).add(v.pos)
        foot.pos.y = Math.max(FOOT_Y, foot.pos.y)
        foot.t = 1
      } else if (foot.t >= 1) {
        v.tmp.copy(v.pos).addScaledVector(v.right, side * FOOT_SPREAD).addScaledVector(v.vel, 0.12).setY(FOOT_Y)
        const drift = foot.pos.distanceTo(v.tmp)
        if (drift > STEP_TRIGGER * 2.5 || (drift > STEP_TRIGGER && other.t >= 1)) {
          foot.from.copy(foot.pos)
          foot.to.copy(v.tmp).addScaledVector(v.vel, 0.12)
          foot.t = 0
        }
      } else {
        foot.t = Math.min(1, foot.t + (delta / STEP_TIME) * stride)
        // A running foot lands in a little puff of dust.
        if (foot.t >= 1 && v.vel.length() > RUN_DUST * useSim.getState().speed) puff(foot.to.x, foot.to.z, 0.35)
        foot.pos.lerpVectors(foot.from, foot.to, foot.t)
        foot.pos.y = FOOT_Y + Math.sin(foot.t * Math.PI) * STEP_LIFT
      }

      footMeshes.current[i]?.position.copy(foot.pos)
      placeLimb(legMeshes.current[i], v.hip, foot.pos)
    })
  })

  return (
    <>
      <RigidBody ref={body} colliders={false} position={spawn} linearDamping={0.1} angularDamping={0.2}>
        <BallCollider args={[RADIUS]} friction={0.6} restitution={0.4} />
        <group ref={visual} visible={!chop}>
          <FruitBody kind={kind} />
          <FruitFace fruit={fruit} />
        </group>
      </RigidBody>

      {chop && <FruitSlices kind={kind} position={chop.position} quaternion={chop.quaternion} />}

      <group ref={knife} visible={false} scale={1.7}>
        <mesh castShadow position={[0, 0.02, 0]}>
          <boxGeometry args={[0.06, 0.16, 0.06]} />
          <meshStandardMaterial color="#5a3a1c" />
        </mesh>
        <mesh castShadow position={[0, 0.11, 0]}>
          <boxGeometry args={[0.04, 0.03, 0.16]} />
          <meshStandardMaterial color="#3a3a3a" />
        </mesh>
        <mesh castShadow position={[0, 0.32, 0.01]}>
          <boxGeometry args={[0.02, 0.4, 0.11]} />
          <meshStandardMaterial color="#eef2f5" emissive="#aeb8c2" emissiveIntensity={0.7} roughness={0.3} />
        </mesh>
      </group>

      {/* Speed lines behind a rushing Rotten. Each is a thin stick, stretched along its length each frame. */}
      <group ref={streaks} visible={false}>
        {(
          [
            [-0.32, 0.18],
            [0.3, 0.05],
            [-0.12, -0.2],
            [0.18, 0.32],
            [0.02, -0.02],
          ] as const
        ).map(([x, y]) => (
          <mesh key={x} position={[x, y, -1]}>
            <boxGeometry args={[0.035, 0.035, 1]} />
            <meshBasicMaterial color="#f4f6ff" transparent opacity={0.6} depthWrite={false} />
          </mesh>
        ))}
      </group>

      <group visible={!chop}>
        {[0, 1].map((i) => (
          <group key={i}>
            <mesh ref={(m) => void (legMeshes.current[i] = m)} castShadow>
              <cylinderGeometry args={[0.028, 0.028, 1, 8]} />
              <meshStandardMaterial color={LIMB_COLOR} />
            </mesh>
            <mesh ref={(m) => void (footMeshes.current[i] = m)} castShadow scale={[1, 0.6, 1.4]}>
              <sphereGeometry args={[0.06, 12, 10]} />
              <meshStandardMaterial color={LIMB_COLOR} />
            </mesh>
          </group>
        ))}
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} ref={(m) => void (armMeshes.current[i] = m)} castShadow>
            <cylinderGeometry args={[0.024, 0.024, 1, 8]} />
            <meshStandardMaterial color={LIMB_COLOR} />
          </mesh>
        ))}
      </group>

      <group ref={overlay}>
        {/* Once a fruit is dead its ghost carries the name tag instead. */}
        {alive && (
          <Html center zIndexRange={[10, 0]}>
            <div className="fruit-tag">
              {speechText && (
                <div className="bubble">
                  <RichText text={speechText} />
                </div>
              )}
              {thinking && !speechText && (
                <div className="bubble thinking">
                  <i />
                  <i />
                  <i />
                </div>
              )}
              {showThought && fruit.thought && !speechText && !thinking && (
                <div className="bubble thought">
                  <RichText text={fruit.thought} />
                </div>
              )}
              {votesAgainst > 0 && <div className="tally">{'✗'.repeat(votesAgainst)}</div>}
              <div className="name">
                {fruit.name}
                {showRole && <span className={`role ${fruit.role}`}>{ROLE_TAG[fruit.role]}</span>}
                {/* Blushing and nervous shaking already show on the face, so they get no mark here. */}
                {reaction && reaction !== 'blush' && reaction !== 'shake' && <Emote reaction={reaction} big={dramatic} />}
              </div>
            </div>
          </Html>
        )}
      </group>
    </>
  )
}
