// lint-prose.sh, with a stand-in for Vale that records the files it is given.
// The stand-in fires on the script's canary, as a configured Vale does.
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'

const SCRIPT = fileURLToPath(
  new URL('../.gitlab/scripts/lint-prose.sh', import.meta.url)
)

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'drx-prose-'))
  dirs.push(dir)
  return dir
}

const setup = (files: Record<string, string>) => {
  const repo = temp()
  const bin = temp()
  const log = join(bin, 'files.log')
  const vale = join(bin, 'vale')
  writeFileSync(
    vale,
    [
      '#!/bin/sh',
      'for arg in "$@"; do',
      '  case "$arg" in',
      '    canary.md) echo "canary.md:1:13:stand-in:fired"; exit 1 ;;',
      '    --*) ;;',
      `    *) printf '%s\\n' "$arg" >> "${log}" ;;`,
      '  esac',
      'done',
      '',
    ].join('\n')
  )
  chmodSync(vale, 0o755)

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
  writeFileSync(join(repo, '.vale.ini'), '[*.md]\n')
  git('add', '.vale.ini')
  git('commit', '-q', '-m', 'chore: add the configuration')
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(repo, name), content)
  }
  git('add', '-A')
  git('commit', '-q', '-m', 'docs: add the files')

  const run = (...args: string[]) => {
    const result = spawnSync('bash', [SCRIPT, ...args], {
      cwd: repo,
      // Only what the script needs. A pipeline variable from the run this
      // test is part of would otherwise choose the range for it.
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        VALE_BIN: vale,
      },
      encoding: 'utf8',
    })
    const seen = existsSync(log)
      ? readFileSync(log, 'utf8').split('\n').filter(Boolean)
      : []
    return { ...result, seen }
  }
  return { run }
}

describe('lint-prose.sh', () => {
  test('lints the markdown the last commit touched, whatever its name holds', () => {
    const { run } = setup({
      'notes.md': 'Notes.\n',
      'two words.md': 'More notes.\n',
      'code.ts': 'export {}\n',
    })
    const result = run()
    expect(result.stdout).toContain('2 markdown file(s)')
    expect(result.status).toBe(0)
    expect(result.seen).toContain('notes.md')
    expect(result.seen).toContain('two words.md')
    expect(result.seen).not.toContain('code.ts')
  })

  test('passes a commit that touches no markdown', () => {
    const { run } = setup({ 'code.ts': 'export {}\n' })
    const result = run()
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('0 markdown file(s)')
    expect(result.status).toBe(0)
  })

  test('--all lints every tracked markdown file', () => {
    const { run } = setup({ 'notes.md': 'Notes.\n', 'more.md': 'More.\n' })
    const result = run('--all')
    expect(result.stdout).toContain('2 markdown file(s)')
    expect(result.seen).toEqual(expect.arrayContaining(['notes.md', 'more.md']))
  })

  // macOS still has bash 3.2 as /bin/bash, where mapfile does not exist and
  // an empty array is an unbound variable under `set -u`.
  test('uses nothing a bash older than 4.4 lacks', () => {
    const source = readFileSync(SCRIPT, 'utf8')
    expect(source).not.toMatch(/\b(mapfile|readarray)\b/)
    // Each array that can be empty is expanded behind a guard.
    expect(source).not.toMatch(/ in "\$\{markdown\[@\]\}"/)
    expect(source).not.toMatch(/ "\$\{glob\[@\]\}"/)
  })
})
