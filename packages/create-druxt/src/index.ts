import { runCli } from '@druxt/cli'

/** The arguments of `drx` that create a site with the given arguments. */
export function initArguments(argv: string[]): string[] {
  return ['init', ...argv]
}

/**
 * Runs `drx init` with the arguments `npm create druxt` was given and
 * returns its exit code. Creating a site is all this package does: every
 * other task is a `drx` command.
 */
export async function createDruxt(
  argv: string[],
  run: (argv: string[]) => Promise<number> = runCli
): Promise<number> {
  return run(initArguments(argv))
}
