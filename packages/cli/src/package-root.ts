import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The directory of this package, found from this file. The sources sit in
 * src/ and the build in dist/, at different depths, so the nearest
 * package.json is the fixed point.
 */
export function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir)
    if (parent === dir) {
      throw new Error('No package.json found above the CLI sources.')
    }
    dir = parent
  }
  return dir
}

export function cliVersion(): string {
  const manifest = JSON.parse(
    readFileSync(join(packageRoot(), 'package.json'), 'utf8')
  ) as { version: string }
  return manifest.version
}

/**
 * The registry files that ship with the package. The build copies them into
 * the package. In a checkout that has not been built they are read from the
 * repository root.
 */
export function bundledRegistryDir(): string {
  const root = packageRoot()
  const packaged = join(root, 'starters')
  if (existsSync(join(packaged, 'index.json'))) return packaged
  return join(root, '..', '..', 'starters')
}
