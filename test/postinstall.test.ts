import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'

const SCRIPT = fileURLToPath(
  new URL('../scripts/postinstall.mjs', import.meta.url)
)

let repo: string | undefined

afterEach(() => {
  if (repo) rmSync(repo, { recursive: true, force: true })
})

// A checkout with the script copied to `<under>/scripts/`, then run from there.
const install = (under: string) => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'drx-postinstall-')))
  execFileSync('git', ['init', '-q', repo])
  const scripts = join(repo, under, 'scripts')
  mkdirSync(scripts, { recursive: true })
  copyFileSync(SCRIPT, join(scripts, 'postinstall.mjs'))
  execFileSync(process.execPath, [join(scripts, 'postinstall.mjs')], {
    cwd: join(repo, under),
    stdio: 'pipe',
  })
  try {
    return execFileSync(
      'git',
      ['-C', repo, 'config', '--local', 'core.hooksPath'],
      { encoding: 'utf8' }
    ).trim()
  } catch {
    return undefined
  }
}

describe('the postinstall script', () => {
  test('points its own checkout at the committed hooks', () => {
    expect(install('.')).toBe('.githooks')
  })

  test('leaves the hooks of a checkout it is only vendored into', () => {
    expect(install('vendor/druxt-cli')).toBeUndefined()
  })
})
