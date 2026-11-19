import { nodeTooOld } from './node-version.js'

/**
 * Runs drx and returns its exit code. The Node version is checked before the
 * commands are loaded: their libraries fail to load on an old Node, with an
 * error that names none of this.
 */
export async function launch(
  node: string,
  argv: string[],
  stderr: { write(text: string): unknown }
): Promise<number> {
  const problem = nodeTooOld(node)
  if (problem) {
    stderr.write(`${problem}\n`)
    return 1
  }
  const { runCli } = await import('./cli.js')
  return runCli(argv)
}
