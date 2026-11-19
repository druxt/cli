// Read by the binary before anything else is loaded, so it has no imports and
// only syntax an old Node can parse.

/** The oldest Node drx runs on. The same as `engines.node` in package.json. */
export const MINIMUM_NODE = '22.12.0'

function parts(version: string): number[] {
  return version.split('.').map((part) => Number.parseInt(part, 10) || 0)
}

/**
 * What to tell the user when this Node is older than drx needs, or undefined
 * when it is new enough.
 */
export function nodeTooOld(current: string): string | undefined {
  const have = parts(current)
  const need = parts(MINIMUM_NODE)
  for (let index = 0; index < need.length; index++) {
    const a = have[index] || 0
    const b = need[index] || 0
    if (a > b) return undefined
    if (a < b) {
      return (
        'drx needs Node ' +
        MINIMUM_NODE +
        ' or later, and this is Node ' +
        current +
        '.'
      )
    }
  }
  return undefined
}
