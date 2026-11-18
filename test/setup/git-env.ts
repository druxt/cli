/**
 * The variables git sets for a hook, which point every git command at the repository being committed to.
 *
 * A test that runs `git init` or `git commit` in a temporary directory would otherwise write to that
 * repository's index and refs when the suite runs from the pre-commit hook.
 */
export const HOOK_GIT_VARIABLES = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_PREFIX',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
] as const

/** A copy of an environment without the variables a git hook sets. */
export function withoutHookGit(
  env: Record<string, string | undefined>
): Record<string, string | undefined> {
  const cleaned = { ...env }
  for (const name of HOOK_GIT_VARIABLES) delete cleaned[name]
  return cleaned
}

for (const name of HOOK_GIT_VARIABLES) delete process.env[name]
