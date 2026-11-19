import { existsSync, lstatSync, realpathSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import { DrxError } from '../errors.js'
import { isInsidePath } from '../validate.js'

/** A relative path with forward slashes and no `.` segments. */
function normalise(path: string): string {
  return path
    .split(/[\\/]/)
    .filter((segment) => segment !== '' && segment !== '.')
    .join('/')
}

/**
 * Fails unless the path names something inside the site, by its spelling
 * and by where the directory holding it is on disk. The second check is for
 * a link in the starter that points out of the site.
 */
function assertInsideSite(root: string, path: string): void {
  const refuse = () =>
    new DrxError(
      'invalid-entry',
      `Refusing to remove ${path}: it is not inside the site.`
    )
  if (!isInsidePath(path)) throw refuse()

  const realRoot = realpathSync(root)
  let holder = dirname(join(root, normalise(path)))
  while (!existsSync(holder)) holder = dirname(holder)
  const realHolder = realpathSync(holder)
  if (realHolder !== realRoot && !realHolder.startsWith(realRoot + sep)) {
    throw refuse()
  }
}

/**
 * Removes the paths of the engines that were not chosen, and returns what it
 * removed. A path in `keep`, or inside one, stays. A directory that holds a
 * kept path loses everything else in it.
 *
 * Every path is checked before anything is removed, so a bad one removes
 * nothing. A link is removed as a link, never followed.
 *
 * With `leave`, nothing is removed and the paths that would have been are
 * returned: for a site whose files were not all put there by the starter.
 */
export async function removeEngineFiles(
  root: string,
  remove: string[],
  keep: string[],
  leave = false
): Promise<string[]> {
  for (const path of remove) assertInsideSite(root, path)

  const kept = keep.map(normalise)
  const isKept = (path: string) =>
    kept.some((other) => path === other || path.startsWith(`${other}/`))
  const holdsKept = (path: string) =>
    kept.some((other) => other.startsWith(`${path}/`))

  const removed: string[] = []
  const visit = async (path: string): Promise<void> => {
    const file = join(root, path)
    const stat = lstatSync(file, { throwIfNoEntry: false })
    if (!stat || isKept(path)) return
    if (holdsKept(path) && stat.isDirectory()) {
      for (const child of (await readdir(file)).sort()) {
        await visit(`${path}/${child}`)
      }
      return
    }
    if (!leave) await rm(file, { recursive: true, force: true })
    removed.push(path)
  }
  for (const path of remove) await visit(normalise(path))
  return removed
}
