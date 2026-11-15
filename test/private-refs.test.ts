import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import { findPrivateRefs } from '../scripts/lint-private-refs.mjs'

const SCRIPT = fileURLToPath(
  new URL('../scripts/lint-private-refs.mjs', import.meta.url)
)

const hostsIn = (text: string) => findPrivateRefs(text).map((ref) => ref.host)

// The hosts below are private on purpose. The rule exempts this file by path,
// which is why it can state them plainly.
describe('findPrivateRefs', () => {
  test('finds a private host by name', () => {
    expect(hostsIn('see http://gitlab.example.local/x')).toEqual([
      'gitlab.example.local',
    ])
  })

  test('finds RFC1918 addresses', () => {
    expect(hostsIn('http://10.0.0.8/ http://192.168.1.1/')).toEqual([
      '10.0.0.8',
      '192.168.1.1',
    ])
    expect(hostsIn('http://172.16.0.1/')).toEqual(['172.16.0.1'])
  })

  test('finds an RFC1918 address inside an IPv4-mapped IPv6 literal', () => {
    expect(hostsIn('https://[::ffff:10.0.0.8]/x')).toEqual(['10.0.0.8'])
    expect(hostsIn('https://[::ffff:0a00:0008]/x')).toEqual(['10.0.0.8'])
    expect(hostsIn('https://[0:0:0:0:0:ffff:10.0.0.8]/x')).toEqual(['10.0.0.8'])
    expect(hostsIn('http://[::ffff:c0a8:0101]/')).toEqual(['192.168.1.1'])
  })

  test('finds a link-local IPv6 address', () => {
    expect(hostsIn('http://[fe80::1]/')).toEqual(['fe80::1'])
  })

  test('leaves public hosts alone', () => {
    expect(hostsIn('https://druxtjs.org/docs')).toEqual([])
    expect(hostsIn('http://[2001:db8::1]/')).toEqual([])
    expect(hostsIn('http://[::ffff:8.8.8.8]/')).toEqual([])
  })

  test('leaves the local development hosts alone', () => {
    expect(hostsIn('http://localhost:3000/ http://127.0.0.1:8888/')).toEqual([])
    expect(hostsIn('http://[::1]/ https://example.ddev.site/')).toEqual([])
  })

  test('reads the host, not the userinfo a git remote carries', () => {
    expect(hostsIn('https://oauth2:token@gitlab.example.local/a')).toEqual([
      'gitlab.example.local',
    ])
  })
})

describe('the lint:private command', () => {
  let repo: string | undefined

  afterEach(() => {
    if (repo) rmSync(repo, { recursive: true, force: true })
  })

  const repoWith = (content: string) => {
    repo = mkdtempSync(join(tmpdir(), 'drx-private-'))
    execFileSync('git', ['init', '-q', repo])
    writeFileSync(join(repo, 'README.md'), content)
    execFileSync('git', ['-C', repo, 'add', 'README.md'])
    return repo
  }

  const run = (root: string) => {
    try {
      execFileSync(process.execPath, [SCRIPT, root], { stdio: 'pipe' })
      return 0
    } catch (error) {
      return (error as { status: number }).status
    }
  }

  test('passes a repository with public references only', () => {
    expect(run(repoWith('See https://druxtjs.org.\n'))).toBe(0)
  })

  test('fails a repository whose tracked file names a private host', () => {
    expect(run(repoWith('See http://gitlab.example.local/x.\n'))).toBe(1)
  })
})
