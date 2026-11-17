import { BUTTON, TABLE } from '../sim/map'

const TABLE_HEIGHT = 0.75

/** The round Cafeteria table with the big red emergency button in the middle. */
export default function MeetingTable() {
  return (
    <group position={[TABLE.at[0], 0, TABLE.at[1]]}>
      <mesh castShadow receiveShadow position={[0, TABLE_HEIGHT, 0]}>
        <cylinderGeometry args={[TABLE.radius, TABLE.radius, 0.12, 40]} />
        <meshStandardMaterial color="#ffffff" roughness={0.6} />
      </mesh>
      <mesh castShadow position={[0, TABLE_HEIGHT / 2, 0]}>
        <cylinderGeometry args={[0.25, 0.4, TABLE_HEIGHT, 16]} />
        <meshStandardMaterial color="#d7dce3" />
      </mesh>
      <group position={[BUTTON[0] - TABLE.at[0], TABLE_HEIGHT + 0.06, BUTTON[1] - TABLE.at[1]]}>
        <mesh castShadow position={[0, 0.06, 0]}>
          <cylinderGeometry args={[0.45, 0.5, 0.12, 24]} />
          <meshStandardMaterial color="#2b2f36" />
        </mesh>
        <mesh castShadow position={[0, 0.18, 0]}>
          <sphereGeometry args={[0.32, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#e2412f" emissive="#e2412f" emissiveIntensity={0.25} />
        </mesh>
      </group>
    </group>
  )
}
