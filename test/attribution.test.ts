// The two halves of the attribution rule: the commitlint rule the commit-msg
// hook runs, and the script the pipelines run. Each carries its own copy of
// the pattern, so every sample here goes through both and they have to agree.
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import config from '../commitlint.config.mjs'

const SCRIPT = fileURLToPath(
  new URL('../.gitlab/scripts/check-attribution.sh', import.meta.url)
)

// In pieces, so that this file passes the scan it tests.
const CO = 'Co-authored' + '-by: '
const ASSISTED = 'Assisted' + '-by: '
const GENERATED = 'Generated ' + 'with '

const REJECTED = [
  `${CO}Claude <assistant@example.org>`,
  `${CO}Amp <amp@example.org>`,
  `${ASSISTED}Claude`,
  `${ASSISTED}GitHub Copilot`,
  `${GENERATED}Copilot`,
  `${GENERATED}Cursor`,
]
const ACCEPTED = [
  `${CO}Sam Champion <sam@example.org>`,
  `${ASSISTED}Ana Ramp <ana@example.org>`,
  'Reviewed-by: Ana <ana@example.org>',
  // A tool's name inside another word credits no tool.
  'Generated ' + 'by the precursor script',
]

const rule = config.plugins[0]!.rules['no-ai-attribution']
const hookAccepts = (message: string) => rule({ raw: message })[0]

// Only what the script needs. A pipeline variable from the run this test is
// part of would otherwise choose the range or the description for it.
const env = (path = process.env.PATH ?? '') => ({
  PATH: path,
  HOME: process.env.HOME ?? '',
})

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'drx-attribution-'))
  dirs.push(dir)
  return dir
}

const repoWithCommit = (message: string) => {
  const repo = temp()
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      [
        '-C',
        repo,
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.org',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'core.hooksPath=/dev/null',
        ...args,
      ],
      { stdio: 'pipe' }
    )
  git('init', '-q')
  writeFileSync(join(repo, 'README.md'), 'A file.\n')
  git('add', 'README.md')
  git('commit', '-q', '-m', `docs: add a file\n\n${message}`)
  return repo
}

const check = (repo: string, path?: string) =>
  spawnSync('bash', [SCRIPT], { cwd: repo, env: env(path), encoding: 'utf8' })

/** The path of the real git, quoted for a shell script, so a directory with a space in its name stays whole. */
const realGit = () => {
  const path = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
  return `'${path.replace(/'/g, `'\\''`)}'`
}

// A command of the given name that fails as one that could not run does.
const broken = (name: string, script: string) => {
  const bin = temp()
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, name), `#!/bin/sh\n${script}\n`)
  chmodSync(join(bin, name), 0o755)
  return [bin, process.env.PATH ?? ''].join(delimiter)
}

describe('the attribution rule', () => {
  test.each(REJECTED)('the hook and the script both refuse "%s"', (line) => {
    expect(hookAccepts(`docs: add a file\n\n${line}`)).toBe(false)
    const result = check(repoWithCommit(line))
    expect(result.stdout).toContain('[FAIL]')
    expect(result.status).toBe(1)
  })

  test.each(ACCEPTED)('the hook and the script both pass "%s"', (line) => {
    expect(hookAccepts(`docs: add a file\n\n${line}`)).toBe(true)
    const result = check(repoWithCommit(line))
    expect(result.stdout).toContain('[PASS]')
    expect(result.status).toBe(0)
  })
})

describe('check-attribution.sh, when a scan cannot run', () => {
  test('a grep that fails is not a clean commit message', () => {
    const result = check(
      repoWithCommit('Plain.'),
      broken('grep', 'echo "grep: broken" >&2; exit 2')
    )
    expect(result.stdout).not.toContain('[PASS]')
    expect(result.status).toBe(2)
  })

  test('a git grep that fails is not a clean tree', () => {
    const result = check(
      repoWithCommit('Plain.'),
      broken(
        'git',
        `[ "$1" = grep ] && { echo "fatal: broken" >&2; exit 128; }\nexec ${realGit()} "$@"`
      )
    )
    expect(result.stdout).not.toContain('[PASS]')
    expect(result.stderr).toContain('fatal: broken')
    expect(result.status).toBe(2)
  })

  // With pipefail a pipeline's status is its last failing command's, so grep's "no match" would hide
  // a git log that could not read the message.
  test('a git log that fails is not a clean commit message', () => {
    const result = check(
      repoWithCommit('Plain.'),
      broken('git', `[ "$1" = log ] && exit 128\nexec ${realGit()} "$@"`)
    )
    expect(result.stdout).not.toContain('[PASS]')
    expect(result.status).toBe(2)
  })
})

describe('check-attribution.sh, run before a commit', () => {
  test('reads what is staged, not only the working tree', () => {
    const repo = repoWithCommit('Plain.')
    writeFileSync(join(repo, 'NOTES.md'), `Notes.\n\n${GENERATED}Copilot\n`)
    execFileSync('git', ['-C', repo, 'add', 'NOTES.md'], { stdio: 'pipe' })
    // The working copy is cleaned after staging: the commit would still record the staged line.
    writeFileSync(join(repo, 'NOTES.md'), 'Notes.\n')
    const result = check(repo)
    expect(result.stdout).toContain('[FAIL]')
    expect(result.stdout).toContain('NOTES.md')
    expect(result.status).toBe(1)
  })
})
