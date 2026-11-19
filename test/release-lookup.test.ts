// The registry lookup the release workflow's publishing steps share. Those
// jobs do not check the repository out, so the function lives in the workflow
// and is read from there.
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'

const workflow = readFileSync(
  fileURLToPath(new URL('../.github/workflows/release.yml', import.meta.url)),
  'utf8'
)

/** Every copy of the function in the workflow, without its indentation. */
function copies(): string[] {
  const found: string[] = []
  const lines = workflow.split('\n')
  for (const [index, line] of lines.entries()) {
    if (line.trim() !== 'npm_field() {') continue
    const indent = line.length - line.trimStart().length
    const end = lines.findIndex(
      (candidate, at) => at > index && candidate === `${' '.repeat(indent)}}`
    )
    found.push(
      lines
        .slice(index, end + 1)
        .map((part) => part.slice(indent))
        .join('\n')
    )
  }
  return found
}

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

/** Runs a publishing step's shape, as GitHub runs bash, with a stand-in npm. */
function run(npm: string) {
  const dir = mkdtempSync(join(tmpdir(), 'drx-lookup-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'npm'), `#!/bin/sh\n${npm}\n`)
  chmodSync(join(dir, 'npm'), 0o755)
  const script = [
    copies()[0],
    'have="$(npm_field "@druxt/cli@1.2.3" version)"',
    'if [ -n "$have" ]; then echo "already: $have"; else echo "publish"; fi',
  ].join('\n')
  return spawnSync(
    'bash',
    ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script],
    {
      cwd: dir,
      encoding: 'utf8',
      env: { PATH: `${dir}:${process.env.PATH ?? ''}` },
    }
  )
}

describe.skipIf(process.platform === 'win32')(
  'the release workflow registry lookup',
  () => {
    test('is the only way the workflow asks npm what is published', () => {
      const all = copies()
      expect(all).toHaveLength(2)
      expect(all[1]).toBe(all[0])
      expect(workflow.match(/npm view/g)).toHaveLength(2)
      execFileSync('bash', ['-n', '-c', all[0]!])
    })

    test('skips a version npm has', () => {
      const result = run('echo 1.2.3')
      expect(result.status).toBe(0)
      expect(result.stdout).toBe('already: 1.2.3\n')
    })

    test('publishes a version or a package npm does not have', () => {
      expect(run('exit 0').stdout).toBe('publish\n')
      const missing = run('echo "npm error code E404" >&2; exit 1')
      expect(missing.status).toBe(0)
      expect(missing.stdout).toBe('publish\n')
    })

    test('stops, and does not publish, when the registry cannot be asked', () => {
      const result = run('echo "npm error code ETIMEDOUT" >&2; exit 1')
      expect(result.status).not.toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('ETIMEDOUT')
    })
  }
)
