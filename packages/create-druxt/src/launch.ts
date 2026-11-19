/** The oldest Node @druxt/cli runs on. Kept in step with its `engines.node`. */
export const MINIMUM_NODE = [22, 12, 0]

/** Whether a Node version, such as `16.18.1`, is older than the minimum. */
export function tooOld(version: string): boolean {
  const have = version.split('.').map((part) => Number.parseInt(part, 10) || 0)
  for (const [index, need] of MINIMUM_NODE.entries()) {
    const part = have[index] ?? 0
    if (part !== need) return part < need
  }
  return false
}

/**
 * Runs `drx init` and returns its exit code. The Node version is checked
 * before @druxt/cli is loaded, which fails on an old Node with an error that
 * names none of this.
 */
export async function launch(
  node: string,
  argv: string[],
  stderr: { write(text: string): unknown }
): Promise<number> {
  if (tooOld(node)) {
    stderr.write(
      `create-druxt needs Node ${MINIMUM_NODE.join('.')} or later, and this is Node ${node}.\n`
    )
    return 1
  }
  const { createDruxt } = await import('./index.js')
  return createDruxt(argv)
}
