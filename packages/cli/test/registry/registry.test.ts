import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { bundledRegistryDir, packageRoot } from '../../src/package-root.js'
import {
  DEFAULT_REGISTRY,
  defaultStarter,
  openRegistry,
} from '../../src/registry/registry.js'
import { entryWith, validEntry } from '../helpers/entry.js'
import { closedPort, serve, type TestServer } from '../helpers/server.js'

const index = JSON.stringify({ starters: ['quickstart'] })
const entry = JSON.stringify(validEntry())

let server: TestServer | undefined
let bundled: string

beforeEach(() => {
  bundled = mkdtempSync(join(tmpdir(), 'drx-bundled-'))
  writeFileSync(join(bundled, 'index.json'), index)
  writeFileSync(
    join(bundled, 'quickstart.json'),
    JSON.stringify(entryWith('url', 'https://example.com/bundled'))
  )
})

afterEach(async () => {
  await server?.close()
  server = undefined
  rmSync(bundled, { recursive: true, force: true })
})

describe('a default registry that is behind this build', () => {
  const entries = { '/quickstart.json': entry }

  test('gives way to the bundled copy when its revision is lower', async () => {
    writeFileSync(
      join(bundled, 'index.json'),
      JSON.stringify({ revision: 2, starters: ['quickstart'] })
    )
    server = await serve({ ...entries, '/index.json': index })
    const registry = await openRegistry({
      defaultUrl: server.url,
      bundledDir: bundled,
    })
    expect(registry.origin).toBe('bundled')
    expect(registry.fallbackReason).toBe(
      `${server.url} is older than this version of drx.`
    )
    expect((await registry.entry('quickstart')).url).toBe(
      'https://example.com/bundled'
    )
  })

  test('is read when its revision is the same or higher', async () => {
    writeFileSync(
      join(bundled, 'index.json'),
      JSON.stringify({ revision: 2, starters: ['quickstart'] })
    )
    for (const revision of [2, 3]) {
      server = await serve({
        ...entries,
        '/index.json': JSON.stringify({ revision, starters: ['quickstart'] }),
      })
      const registry = await openRegistry({
        defaultUrl: server.url,
        bundledDir: bundled,
      })
      expect(registry.origin).toBe('remote')
      await server.close()
    }
    server = undefined
  })

  test('is read when the bundled copy cannot be', async () => {
    server = await serve({ ...entries, '/index.json': index })
    const registry = await openRegistry({
      defaultUrl: server.url,
      bundledDir: join(bundled, 'missing'),
    })
    expect(registry.origin).toBe('remote')
  })
})

describe('a registry named by the user', () => {
  test('reads the index and an entry over HTTP', async () => {
    server = await serve({ '/index.json': index, '/quickstart.json': entry })
    const registry = await openRegistry({ url: server.url })

    expect(registry.origin).toBe('remote')
    expect(registry.location).toBe(server.url)
    expect(await registry.names()).toEqual(['quickstart'])
    expect(await registry.entry('quickstart')).toEqual(validEntry())
  })

  test('ignores a trailing slash on the URL', async () => {
    server = await serve({ '/quickstart.json': entry })
    const registry = await openRegistry({ url: `${server.url}/` })
    expect((await registry.entry('quickstart')).name).toBe('quickstart')
    expect(server.requests[0]?.path).toBe('/quickstart.json')
  })

  test('fails when it cannot be read, and does not fall back', async () => {
    server = await serve({})
    const registry = await openRegistry({
      url: server.url,
      bundledDir: bundled,
    })
    await expect(registry.entry('quickstart')).rejects.toThrow(
      `Could not read ${server.url}/quickstart.json: 404 Not Found.`
    )
  })

  test('fails on an entry that is not JSON', async () => {
    server = await serve({ '/quickstart.json': '<html>' })
    const registry = await openRegistry({ url: server.url })
    await expect(registry.entry('quickstart')).rejects.toThrow(
      `Could not read ${server.url}/quickstart.json: it is not valid JSON.`
    )
  })

  test('fails on an invalid entry, naming the field', async () => {
    server = await serve({
      '/quickstart.json': JSON.stringify(entryWith('druxt.line', '')),
    })
    const registry = await openRegistry({ url: server.url })
    await expect(registry.entry('quickstart')).rejects.toThrow(
      'Starter entry "quickstart" is invalid: druxt.line must be a non-empty string.'
    )
  })

  test('fails on an index that does not list names', async () => {
    server = await serve({ '/index.json': '{"starters":"quickstart"}' })
    const registry = await openRegistry({ url: server.url })
    await expect(registry.names()).rejects.toThrow(
      `${server.url}/index.json is invalid: starters must be an array of names.`
    )
  })

  test('refuses a starter name that is not a plain name', async () => {
    server = await serve({})
    const registry = await openRegistry({ url: server.url })
    await expect(registry.entry('../secrets')).rejects.toThrow(
      'A starter name may hold letters, digits, dots, dashes and underscores: "../secrets".'
    )
    expect(server.requests).toEqual([])
  })

  test('sends the token to it when one is given', async () => {
    server = await serve({ '/quickstart.json': entry })
    const registry = await openRegistry({ url: server.url, auth: 'secret' })
    await registry.entry('quickstart')
    expect(server.requests[0]?.headers.authorization).toBe('Bearer secret')
  })
})

describe('the default registry', () => {
  test('points at the raw files of druxt/cli on GitHub', () => {
    expect(DEFAULT_REGISTRY).toBe(
      'https://raw.githubusercontent.com/druxt/cli/0.x/starters'
    )
  })

  test('is used when it answers', async () => {
    server = await serve({ '/index.json': index, '/quickstart.json': entry })
    const registry = await openRegistry({
      defaultUrl: server.url,
      bundledDir: bundled,
    })
    expect(registry.origin).toBe('remote')
    expect(registry.fallbackReason).toBeUndefined()
    expect((await registry.entry('quickstart')).url).toBe(
      'https://example.com/quickstart'
    )
  })

  test('falls back to the bundled copy when it answers 404', async () => {
    server = await serve({})
    const registry = await openRegistry({
      defaultUrl: server.url,
      bundledDir: bundled,
    })
    expect(registry.origin).toBe('bundled')
    expect(registry.location).toBe(bundled)
    expect(registry.fallbackReason).toBe(
      `Could not read ${server.url}/index.json: 404 Not Found.`
    )
    expect(await registry.names()).toEqual(['quickstart'])
    expect((await registry.entry('quickstart')).url).toBe(
      'https://example.com/bundled'
    )
  })

  test('falls back to the bundled copy when nothing answers', async () => {
    const url = await closedPort()
    const registry = await openRegistry({
      defaultUrl: url,
      bundledDir: bundled,
    })
    expect(registry.origin).toBe('bundled')
    expect(registry.fallbackReason).toContain(
      `Could not read ${url}/index.json`
    )
  })

  test('is never sent the token', async () => {
    server = await serve({ '/index.json': index, '/quickstart.json': entry })
    const registry = await openRegistry({
      defaultUrl: server.url,
      bundledDir: bundled,
      auth: 'secret',
    })
    await registry.entry('quickstart')
    for (const request of server.requests) {
      expect(request.headers.authorization).toBeUndefined()
    }
  })
})

describe('the bundled registry', () => {
  test('names the starters it has when asked for one it lacks', async () => {
    server = await serve({})
    const registry = await openRegistry({
      defaultUrl: server.url,
      bundledDir: bundled,
    })
    await expect(registry.entry('missing')).rejects.toThrow(
      'There is no starter named "missing". The registry has: quickstart.'
    )
  })

  test('ships in the repository with one valid default starter', async () => {
    server = await serve({})
    const registry = await openRegistry({
      defaultUrl: server.url,
      bundledDir: bundledRegistryDir(),
    })
    const names = await registry.names()
    expect(names).toEqual(['quickstart'])
    const starter = await registry.entry('quickstart')
    expect(starter.tar).toBe(
      'https://codeload.github.com/druxt/quickstart/tar.gz/refs/heads/develop'
    )
    expect(starter.druxt.default).toBe(true)
    expect(starter.druxt.requires.commands).toEqual([
      ['php', 'composer'],
      ['ddev'],
    ])
    expect((await defaultStarter(registry))?.name).toBe('quickstart')
  })
})

describe('the copy of the registry the build puts in the package', () => {
  const source = join(packageRoot(), '..', '..', 'starters')
  const copy = join(packageRoot(), 'starters')

  // The copy exists only after a build. A stale one would be read by every
  // other test here in place of starters/, so it has to match.
  test.skipIf(!existsSync(copy))('equals starters/', () => {
    const files = readdirSync(source).sort()
    expect(readdirSync(copy).sort()).toEqual(files)
    for (const file of files) {
      expect(readFileSync(join(copy, file), 'utf8'), file).toBe(
        readFileSync(join(source, file), 'utf8')
      )
    }
  })
})

describe('defaultStarter', () => {
  test('is undefined when no entry is marked as the default', async () => {
    server = await serve({
      '/index.json': index,
      '/quickstart.json': JSON.stringify(entryWith('druxt.default', false)),
    })
    const registry = await openRegistry({ url: server.url })
    expect(await defaultStarter(registry)).toBeUndefined()
  })
})
