// Runs Vitest from a working directory with an upper-case drive letter. Some Windows shells
// (VS Code's among them) report "c:\..." and Vitest then loads two copies of itself and fails
// before any test runs. Elsewhere this is just `vitest run`.
import { spawnSync } from 'node:child_process'

const cwd = process.cwd().replace(/^[a-z]:/, (drive) => drive.toUpperCase())
const result = spawnSync('npx', ['vitest', 'run', '--testTimeout=60000', ...process.argv.slice(2)], { cwd, stdio: 'inherit', shell: true })
process.exit(result.status ?? 1)
