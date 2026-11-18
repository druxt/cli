import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { HOOK_GIT_VARIABLES, withoutHookGit } from './setup/git-env.js'

describe('the variables a git hook hands to what it runs', () => {
  test('are taken out of an environment, and nothing else is', () => {
    const cleaned = withoutHookGit({
      GIT_DIR: '/repo/.git',
      GIT_INDEX_FILE: '/repo/.git/index.lock',
      GIT_WORK_TREE: '/repo',
      GIT_PREFIX: 'packages/',
      GIT_AUTHOR_NAME: 'A Person',
      PATH: '/usr/bin',
    })
    expect(cleaned).toEqual({ GIT_AUTHOR_NAME: 'A Person', PATH: '/usr/bin' })
  })

  test('include the index, so a test never stages into the commit being made', () => {
    expect(HOOK_GIT_VARIABLES).toContain('GIT_DIR')
    expect(HOOK_GIT_VARIABLES).toContain('GIT_INDEX_FILE')
  })

  // The suite's own setup file has run by now. A hook's GIT_DIR in this process would send every `git init`
  // and `git commit` a test makes into the repository being committed to.
  test('are gone from the process the tests run in', () => {
    for (const name of HOOK_GIT_VARIABLES)
      expect(process.env[name]).toBe(undefined)
  })

  test('are removed by the setup file in a process that started with them', () => {
    const setup = fileURLToPath(new URL('./setup/git-env.ts', import.meta.url))
    const out = execFileSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--input-type=module',
        '-e',
        `await import(${JSON.stringify(setup)}); console.log(JSON.stringify([process.env.GIT_DIR ?? null, process.env.GIT_INDEX_FILE ?? null]))`,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_DIR: '/nowhere/.git',
          GIT_INDEX_FILE: '/nowhere/index',
        },
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    )
    expect(JSON.parse(out)).toEqual([null, null])
  })
})
