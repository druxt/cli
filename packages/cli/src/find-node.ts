// Read by the binary on any Node, so it uses only what an old Node has.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, realpathSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { nodeTooOld } from './node-version.js'

export interface NodeSearch {
  env: Record<string, string | undefined>
  /** The path this binary was started as. */
  script: string
  /** The user's home directory, where version managers keep their installs. */
  home: string
  /** The path of the Node that is running, which is not worth trying again. */
  current: string
  /** Directories of binaries that a system install puts Node in. */
  system?: string[]
}

/** Where a system install, or Homebrew, puts Node. */
const SYSTEM = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']

const NAME = process.platform === 'win32' ? 'node.exe' : 'node'

/** The version a Node at this path reports, or undefined when it is not one. */
function versionOf(path: string): string | undefined {
  if (!existsSync(path)) return undefined
  const result = spawnSync(path, ['--version'], {
    encoding: 'utf8',
    timeout: 5000,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (result.status !== 0 || typeof result.stdout !== 'string') return undefined
  const match = /^v(\d+\.\d+\.\d+)/.exec(result.stdout.trim())
  return match ? match[1] : undefined
}

/** The directories of a version manager's installs, the newest version first. */
function installs(root: string, bin: string): string[] {
  let names: string[]
  try {
    names = readdirSync(root)
  } catch {
    return []
  }
  const numbers = (name: string) =>
    name
      .replace(/^v/, '')
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0)
  return names
    .slice()
    .sort((a, b) => {
      const x = numbers(a)
      const y = numbers(b)
      for (let index = 0; index < 3; index++) {
        const difference = (y[index] || 0) - (x[index] || 0)
        if (difference !== 0) return difference
      }
      return 0
    })
    .map((name) => join(root, name, bin, NAME))
}

/** Where a newer Node may be, in the order they are tried. */
function candidates(search: NodeSearch): string[] {
  const { env, script, home } = search
  const list: string[] = []
  if (env.DRX_NODE) list.push(env.DRX_NODE)

  // The Node this binary was installed with sits beside it, in the same
  // directory of binaries. A version manager that switched to an older Node
  // for the site has left this one in place.
  list.push(join(dirname(script), NAME))
  try {
    list.push(join(dirname(realpathSync(script)), NAME))
  } catch {
    // The script path is not a file, as when the module is run directly.
  }

  for (const dir of (env.PATH || env.Path || '').split(delimiter)) {
    if (dir) list.push(join(dir, NAME))
  }

  const data = env.XDG_DATA_HOME || join(home, '.local', 'share')
  list.push(
    ...installs(join(data, 'mise', 'installs', 'node'), 'bin'),
    ...installs(
      join(env.NVM_DIR || join(home, '.nvm'), 'versions', 'node'),
      'bin'
    ),
    ...(env.FNM_DIR
      ? installs(
          join(env.FNM_DIR, 'node-versions'),
          join('installation', 'bin')
        )
      : []),
    ...installs(
      join(data, 'fnm', 'node-versions'),
      join('installation', 'bin')
    ),
    ...installs(
      join(home, '.fnm', 'node-versions'),
      join('installation', 'bin')
    ),
    ...installs(join(home, '.volta', 'tools', 'image', 'node'), 'bin'),
    ...installs(join(home, '.asdf', 'installs', 'nodejs'), 'bin'),
    ...(search.system ?? SYSTEM).map((dir) => join(dir, NAME))
  )
  if (env.ProgramFiles) list.push(join(env.ProgramFiles, 'nodejs', NAME))
  return list
}

/**
 * The path of a Node on this machine that is new enough for drx, or undefined
 * when there is none.
 */
export function findNewerNode(search: NodeSearch): string | undefined {
  const tried = new Set<string>([search.current])
  for (const path of candidates(search)) {
    if (tried.has(path)) continue
    tried.add(path)
    const version = versionOf(path)
    if (version && !nodeTooOld(version)) return path
  }
  return undefined
}
