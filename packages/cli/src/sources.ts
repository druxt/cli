import { DrxError } from './errors.js'
import type { UserConfig } from './user-config.js'

/**
 * Where the Druxt packages of a new site are taken from: a tag on the npm
 * registry, or a git repository at a ref.
 */
export type SourceDefinition =
  { type: 'npm'; tag?: string } | { type: 'git'; url: string; ref?: string }

export type Source =
  | { name: string; type: 'npm'; tag: string }
  | { name: string; type: 'git'; url: string; ref?: string }

export const SOURCE_TYPES = ['npm', 'git'] as const

/** The source every site gets unless another is asked for. */
export const DEFAULT_SOURCE = 'npm'

const GIT_PREFIX = 'git:'

/**
 * Turns a `--source` value into a source: the built-in `npm`, a
 * `git:<url>#<ref>` reference, or a name the user configuration defines.
 */
export function resolveSource(name: string, config: UserConfig): Source {
  if (name === DEFAULT_SOURCE) {
    return { name, type: 'npm', tag: 'latest' }
  }

  if (name.startsWith(GIT_PREFIX) && name.length > GIT_PREFIX.length) {
    const reference = name.slice(GIT_PREFIX.length)
    const hash = reference.lastIndexOf('#')
    return hash === -1
      ? { name, type: 'git', url: reference }
      : {
          name,
          type: 'git',
          url: reference.slice(0, hash),
          ref: reference.slice(hash + 1),
        }
  }

  const defined = config.sources[name]
  if (defined?.type === 'npm') {
    return { name, type: 'npm', tag: defined.tag ?? 'latest' }
  }
  if (defined?.type === 'git') {
    return defined.ref === undefined
      ? { name, type: 'git', url: defined.url }
      : { name, type: 'git', url: defined.url, ref: defined.ref }
  }

  const names = Object.keys(config.sources).sort()
  const known = names.length > 0 ? ` (${names.join(', ')})` : ''
  throw new DrxError(
    'unknown-source',
    `Unknown source "${name}". Use npm, git:<url>#<ref>, or a name defined in ${config.path}${known}.`
  )
}

/** Fails for a source this version can name but cannot yet install from. */
export function assertSourceAvailable(source: Source): void {
  if (source.name !== DEFAULT_SOURCE) {
    throw new DrxError(
      'not-available',
      `The source "${source.name}" is not available yet. Only the npm source works in this version.`
    )
  }
}
