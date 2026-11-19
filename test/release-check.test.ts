import { execFile, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

// The gate runs in a real node process here, which is how the release
// workflow runs it.
const SCRIPT = fileURLToPath(
  new URL('../scripts/release-check.mjs', import.meta.url)
)

let dir: string

const write = (manifest: object, record?: object | null) => {
  fs.writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest))
  if (record !== undefined) {
    fs.writeFileSync(join(dir, 'registry.json'), JSON.stringify(record))
  }
}

const run = (...flags: string[]) => {
  const registry = fs.existsSync(join(dir, 'registry.json'))
    ? [`--registry-file=${join(dir, 'registry.json')}`]
    : ['--offline']
  const result = spawnSync(
    process.execPath,
    [SCRIPT, dir, ...registry, ...flags],
    { encoding: 'utf8' }
  )
  return { status: result.status, out: result.stdout + result.stderr }
}

let server: Server | undefined

beforeEach(() => {
  dir = fs.mkdtempSync(join(os.tmpdir(), 'release-check-'))
})

afterEach(async () => {
  fs.rmSync(dir, { recursive: true, force: true })
  const closing = server
  server = undefined
  if (closing) {
    closing.closeAllConnections()
    await new Promise((resolve) => closing.close(resolve))
  }
})

// A registry on a loopback port. The script runs without blocking this
// process, which has to answer it, and a script that hangs is killed.
const runAgainst = async (
  answer: Parameters<typeof createServer>[1],
  ...flags: string[]
) => {
  server = createServer(answer)
  const listening = server
  await new Promise<void>((resolve) =>
    listening.listen(0, '127.0.0.1', resolve)
  )
  const { port } = listening.address() as AddressInfo
  return new Promise<{ status: number | string | null; out: string }>(
    (resolve) => {
      execFile(
        process.execPath,
        [SCRIPT, dir, `--registry=http://127.0.0.1:${port}`, ...flags],
        { encoding: 'utf8', timeout: 10000 },
        (error, stdout, stderr) =>
          resolve({
            status: error ? (error.killed ? 'killed' : error.code!) : 0,
            out: stdout + stderr,
          })
      )
    }
  )
}

describe('release-check', () => {
  test('passes a publishable package', () => {
    write({ name: 'x', version: '1.0.0', dependencies: { druxt: '^0.24.0' } })
    expect(run('--skip-files')).toEqual({
      status: 0,
      out: 'release-check: x@1.0.0 can publish.\n',
    })
  })

  test.each(['workspace:*', 'link:../druxt', 'file:../druxt'])(
    'refuses the specifier %s',
    (range) => {
      write({ name: 'x', version: '1.0.0', peerDependencies: { druxt: range } })
      const result = run('--skip-files')
      expect(result.status).toBe(1)
      expect(result.out).toContain('does not resolve from npm')
    }
  )

  test('refuses an invalid version', () => {
    write({ name: 'x', version: '1.0' })
    expect(run('--skip-files').out).toContain('is not a valid version')
  })

  test('refuses a version below the published one', () => {
    write(
      { name: 'x', version: '1.1.9' },
      { latest: '1.2.0', versions: ['1.2.0'] }
    )
    const result = run('--skip-files')
    expect(result.status).toBe(1)
    expect(result.out).toContain('does not rise above the published 1.2.0')
  })

  test('refuses a snapshot of an already published version', () => {
    write(
      { name: 'x', version: '1.2.0-dev.20260920004838' },
      { latest: '1.2.0', versions: ['1.2.0'] }
    )
    expect(run('--skip-files').status).toBe(1)
  })

  test('passes a snapshot above the published version', () => {
    write(
      { name: 'x', version: '1.2.1-dev.20260920004838' },
      { latest: '1.2.0', versions: ['1.2.0'] }
    )
    expect(run('--skip-files').status).toBe(0)
  })

  test('passes a stable release over its own prerelease', () => {
    write(
      { name: 'x', version: '2.0.0' },
      { latest: '2.0.0-beta.1', versions: ['2.0.0-beta.1'] }
    )
    expect(run('--skip-files').status).toBe(0)
  })

  test('passes a version branch release below a newer major', () => {
    const record = { latest: '2.0.0', versions: ['1.9.0', '2.0.0'] }
    write({ name: 'x', version: '1.9.1' }, record)
    expect(run('--skip-files').status).toBe(0)
    write({ name: 'x', version: '1.9.1-dev.20261031020000' }, record)
    expect(run('--skip-files').status).toBe(0)
  })

  test('passes a dev snapshot cut after an earlier one of the same core', () => {
    // `changeset version --snapshot` runs in CI and is never committed, so the
    // pending changesets stay pending and every push computes the same core
    // until the version pull request merges. Only the timestamp moves.
    write(
      { name: 'x', version: '0.2.0-dev.20261101000000' },
      { latest: '0.1.0', versions: ['0.1.0', '0.2.0-dev.20261031000000'] }
    )
    expect(run('--skip-files').status).toBe(0)
  })

  test('refuses a version below the highest of its own major', () => {
    write(
      { name: 'x', version: '1.8.5' },
      { latest: '2.0.0', versions: ['1.9.0', '2.0.0'] }
    )
    const result = run('--skip-files')
    expect(result.status).toBe(1)
    expect(result.out).toContain('does not rise above the published 1.9.0')
  })

  test('passes the first release of a new major', () => {
    write(
      { name: 'x', version: '3.0.0' },
      { latest: '2.0.0', versions: ['1.9.0', '2.0.0'] }
    )
    expect(run('--skip-files').status).toBe(0)
  })

  test('passes an already published version, because publish skips it', () => {
    write(
      { name: 'x', version: '1.2.0' },
      { latest: '1.2.0', versions: ['1.2.0'] }
    )
    expect(run('--skip-files').status).toBe(0)
  })

  test('passes a package npm has never seen', () => {
    write({ name: 'x', version: '0.0.1' }, null)
    expect(run('--skip-files').status).toBe(0)
  })

  test('refuses a files entry that was not built, or is empty', () => {
    write({ name: 'x', version: '1.0.0', files: ['dist', 'templates'] })
    fs.mkdirSync(join(dir, 'dist'))
    const result = run()
    expect(result.status).toBe(1)
    expect(result.out).toContain('files entry "dist" is empty')
    expect(result.out).toContain('files entry "templates" does not exist')

    fs.writeFileSync(join(dir, 'dist', 'index.js'), '')
    fs.mkdirSync(join(dir, 'templates'))
    fs.writeFileSync(join(dir, 'templates', 'plugin.js'), '')
    expect(run().status).toBe(0)
  })

  test.each([undefined, []])('refuses a files list of %p', (list) => {
    write({ name: 'x', version: '1.0.0', files: list })
    const result = run()
    expect(result.status).toBe(1)
    expect(result.out).toContain('has no "files" list')
    expect(run('--skip-files').status).toBe(0)
  })

  test('skips a private package', () => {
    write({ name: 'x', version: 'nope', private: true })
    expect(run()).toEqual({
      status: 0,
      out: 'release-check: the package is private, nothing to publish.\n',
    })
  })

  test('--unpublished prints the version only when npm lacks it', () => {
    write(
      { name: 'x', version: '1.2.1' },
      { latest: '1.2.0', versions: ['1.2.0'] }
    )
    expect(run('--unpublished').out).toBe('x@1.2.1\n')

    write(
      { name: 'x', version: '1.2.0' },
      { latest: '1.2.0', versions: ['1.2.0'] }
    )
    expect(run('--unpublished').out).toBe('')
  })

  test.each([
    ['1.2.1', 'latest', { latest: '1.2.0', versions: ['1.2.0'] }],
    ['2.0.0', 'latest', { latest: '2.0.0-beta.1', versions: ['2.0.0-beta.1'] }],
    ['0.1.0', 'latest', null],
    ['1.9.1', 'latest-1', { latest: '2.0.0', versions: ['1.9.0', '2.0.0'] }],
    ['2.1.0-beta.0', 'next', { latest: '2.0.0', versions: ['2.0.0'] }],
  ])('--dist-tag publishes %s as %s', (version, tag, record) => {
    write({ name: 'x', version }, record)
    expect(run('--dist-tag').out).toBe(`${tag}\n`)
  })

  test('refuses an unknown option', () => {
    write({ name: 'x', version: '1.0.0' })
    const result = run('--nope')
    expect(result.status).toBe(1)
    expect(result.out).toContain('Unknown option: --nope')
  })

  test('checks every directory named, and says which package a problem is in', () => {
    const second = join(dir, 'second')
    fs.mkdirSync(second)
    fs.writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'x', version: '1.0.0' })
    )
    fs.writeFileSync(
      join(second, 'package.json'),
      JSON.stringify({ name: 'y', version: '1.0' })
    )
    const result = spawnSync(
      process.execPath,
      [SCRIPT, dir, second, '--offline', '--skip-files'],
      { encoding: 'utf8' }
    )
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('release-check: x@1.0.0 can publish.\n')
    expect(result.stderr).toBe(
      'release-check: y: "1.0" is not a valid version.\n'
    )
  })

  test('--unpublished prints a line for each directory npm lacks', () => {
    const second = join(dir, 'second')
    fs.mkdirSync(second)
    write({ name: 'x', version: '1.2.1' }, { latest: '1.2.0', versions: [] })
    fs.writeFileSync(
      join(second, 'package.json'),
      JSON.stringify({ name: 'y', version: '0.1.0' })
    )
    const result = spawnSync(
      process.execPath,
      [
        SCRIPT,
        dir,
        second,
        `--registry-file=${join(dir, 'registry.json')}`,
        '--unpublished',
      ],
      { encoding: 'utf8' }
    )
    expect(result.stdout).toBe('x@1.2.1\ny@0.1.0\n')
  })

  test.each([
    '../druxt',
    './vendor/druxt',
    '/srv/druxt',
    '~/druxt',
    '..\\druxt',
    'C:\\code\\druxt',
    'druxt-0.25.0.tgz',
  ])('refuses the local path %s', (range) => {
    write({ name: 'x', version: '1.0.0', dependencies: { druxt: range } })
    const result = run('--skip-files')
    expect(result.status).toBe(1)
    expect(result.out).toContain('does not resolve from npm')
  })

  test.each([
    '^0.24.0',
    '>=0.25.1 <1',
    '1.x',
    '*',
    'latest',
    'next',
    'npm:druxt-next@^1.0.0',
    'npm:@druxt/core@0.25.0',
  ])('passes the range, tag or alias %s', (range) => {
    write({ name: 'x', version: '1.0.0', dependencies: { druxt: range } })
    expect(run('--skip-files').status).toBe(0)
  })

  test('refuses a declared entry point that is not in the package', () => {
    write({
      name: 'x',
      version: '1.0.0',
      files: ['dist'],
      bin: { x: './dist/bin.js' },
      main: './dist/index.js',
      types: './dist/index.d.ts',
      exports: {
        '.': { types: './dist/index.d.ts', import: './dist/index.js' },
        './tools': { import: { default: './dist/tools.js' } },
        './components/*': './dist/components/*',
        './package.json': './package.json',
      },
    })
    fs.mkdirSync(join(dir, 'dist'))
    fs.writeFileSync(join(dir, 'dist', 'index.js'), '')
    fs.writeFileSync(join(dir, 'dist', 'index.d.ts'), '')

    const result = run()
    expect(result.status).toBe(1)
    expect(result.out).toContain(
      'bin.x is "./dist/bin.js", which is not among the files npm would pack.'
    )
    expect(result.out).toContain(
      'exports["./tools"].import.default is "./dist/tools.js", which is not among the files npm would pack.'
    )
    expect(result.out).not.toContain('index')
    expect(result.out).not.toContain('components')

    fs.writeFileSync(join(dir, 'dist', 'bin.js'), '')
    fs.writeFileSync(join(dir, 'dist', 'tools.js'), '')
    expect(run()).toEqual({
      status: 0,
      out: 'release-check: x@1.0.0 can publish.\n',
    })
  })

  test('refuses an entry point that exists and is left out of the package', () => {
    write({
      name: 'x',
      version: '1.0.0',
      files: ['dist'],
      exports: { '.': './src/index.js' },
    })
    fs.mkdirSync(join(dir, 'dist'))
    fs.writeFileSync(join(dir, 'dist', 'index.js'), '')
    fs.mkdirSync(join(dir, 'src'))
    fs.writeFileSync(join(dir, 'src', 'index.js'), '')
    const result = run()
    expect(result.status).toBe(1)
    expect(result.out).toContain(
      'exports["."] is "./src/index.js", which is not among the files npm would pack.'
    )
  })

  test('reads the registry it is given', async () => {
    write({ name: 'x', version: '1.1.9' })
    const result = await runAgainst((request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          'dist-tags': { latest: '1.2.0' },
          versions: { '1.2.0': {} },
        })
      )
    }, '--skip-files')
    expect(result.out).toContain('does not rise above the published 1.2.0')
    expect(result.status).toBe(1)
  })

  test('fails when the registry closes before its answer is complete', async () => {
    write({ name: 'x', version: '1.1.9' })
    const result = await runAgainst((request, response) => {
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-length': '4096',
      })
      response.write('{"dist-tags": {"latest": "1.2.0"}, "versions": {', () =>
        response.socket?.destroy()
      )
    }, '--skip-files')
    expect(result.out).toContain(
      'release-check: npm closed the connection before its answer for x was complete.'
    )
    expect(result.out).not.toContain('can publish')
    expect(result.status).toBe(1)
  })
})
