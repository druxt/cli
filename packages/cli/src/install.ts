import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'] as const
type Manager = (typeof MANAGERS)[number]

/**
 * The package manager a directory declares in the `packageManager` field of
 * its package.json, or npm when it declares none. Undefined when there is no
 * package.json to install from.
 */
export async function packageManagerOf(
  dir: string
): Promise<Manager | undefined> {
  let manifest: { packageManager?: unknown }
  try {
    manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  } catch {
    return undefined
  }
  const declared = String(manifest.packageManager ?? '').split('@')[0]
  return MANAGERS.find((manager) => manager === declared) ?? 'npm'
}

/**
 * Runs the install of the directory's package manager. Its output goes to
 * stderr, so the stdout of the CLI stays the result of the command.
 */
export async function installDependencies(
  dir: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const manager = await packageManagerOf(dir)
  if (!manager) {
    throw new Error(`${dir} has no package.json to install from`)
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(manager, ['install'], {
      cwd: dir,
      env,
      stdio: ['ignore', process.stderr, process.stderr],
      shell: process.platform === 'win32',
    })
    child.on('error', (error) =>
      reject(new Error(`${manager} install could not start: ${error.message}`))
    )
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${manager} install exited with code ${code}`))
    )
  })
}
