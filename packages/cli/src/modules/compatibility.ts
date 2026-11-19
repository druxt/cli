import semver from 'semver'
import type { PackageVersion } from '../adapters/index.js'

/**
 * Whether a module works with the Druxt of a part. `unknown` covers a module
 * that states no range, and a part with no Druxt version to compare. It is
 * never read as compatible.
 */
export type Compatibility = 'compatible' | 'incompatible' | 'unknown'

/**
 * Compares the range a module states with the Druxt a part's adapter
 * reports: the installed version when there is one, and the range the part
 * asks for when nothing is installed yet.
 */
export function compatibility(
  moduleRange: string | undefined,
  druxt: PackageVersion | undefined
): Compatibility {
  if (!moduleRange || moduleRange === 'unknown') return 'unknown'
  if (!druxt || semver.validRange(moduleRange) === null) return 'unknown'

  if (druxt.installed !== null) {
    if (semver.valid(druxt.installed) === null) return 'unknown'
    // A prerelease of a version inside the range counts as inside it.
    return semver.satisfies(druxt.installed, moduleRange, {
      includePrerelease: true,
    })
      ? 'compatible'
      : 'incompatible'
  }

  if (druxt.range === null || semver.validRange(druxt.range) === null) {
    return 'unknown'
  }
  return semver.intersects(druxt.range, moduleRange)
    ? 'compatible'
    : 'incompatible'
}
