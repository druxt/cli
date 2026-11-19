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

/** How much of a failed install's output is repeated in the error. */
const OUTPUT_LINES = 40

/**
 * Runs the install of the directory's package manager.
 *
 * What it prints is kept, not shown: a starter's own install messages would
 * sit in the middle of this command's. When the install fails, the end of
 * its output is in the error.
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
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })
    let printed = ''
    for (const stream of [child.stdout, child.stderr]) {
      stream?.setEncoding('utf8')
      stream?.on('data', (chunk: string) => (printed += chunk))
    }
    child.on('error', (error) =>
      reject(new Error(`${manager} install could not start: ${error.message}`))
    )
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              [
                `${manager} install exited with code ${code}`,
                ...printed.trimEnd().split('\n').slice(-OUTPUT_LINES),
              ].join('\n')
            )
          )
    )
  })
}
