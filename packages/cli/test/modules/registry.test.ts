import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  DEFAULT_MODULE_REGISTRY,
  describeAge,
  FRESH_FOR_MS,
  loadModules,
} from '../../src/modules/registry.js'
import { moduleRegistry } from '../helpers/modules.js'
import { serve, type TestServer } from '../helpers/server.js'
import { cleanTmp, tmp } from '../helpers/tmp.js'

const MINUTE = 60 * 1000
const START = new Date('2026-11-16T10:00:00Z')

let server: TestServer
let cacheDir: string
let url: string

beforeEach(async () => {
  server = await serve({ '/modules.json': JSON.stringify(moduleRegistry()) })
  url = `${server.url}/modules.json`
  cacheDir = tmp('drx-cache-')
})

afterEach(async () => {
  await server.close()
  cleanTmp()
})

const load = (after = 0, options: { refresh?: boolean; url?: string } = {}) =>
  loadModules({
    url: options.url ?? url,
    cacheDir,
    now: () => new Date(START.getTime() + after),
    ...(options.refresh ? { refresh: true } : {}),
  })

describe('loadModules', () => {
  test('points at the published registry by default', () => {
    expect(DEFAULT_MODULE_REGISTRY).toBe(
      'https://cdn.jsdelivr.net/gh/druxt/modules@main/modules.json'
    )
  })

  test('reads the registry and keeps a copy', async () => {
    const loaded = await load()
    expect(loaded.modules.map(({ name }) => name)).toEqual([
      'auth',
      'blocks',
      'ckeditor',
      'legacy',
      'node-preview',
    ])
    expect(loaded).toMatchObject({
      url,
      origin: 'remote',
      fetchedAt: START.toISOString(),
      ageMs: 0,
    })
    expect(loaded.reason).toBeUndefined()
    expect(readdirSync(cacheDir, { recursive: true }).length).toBeGreaterThan(0)
  })

  test('uses the copy without a request while it is under an hour old', async () => {
    await load()
    const loaded = await load(59 * MINUTE)
    expect(server.requests).toHaveLength(1)
    expect(loaded).toMatchObject({
      origin: 'cache',
      fetchedAt: START.toISOString(),
      ageMs: 59 * MINUTE,
    })
    expect(loaded.reason).toBeUndefined()
    expect(loaded.modules).toHaveLength(5)
    expect(FRESH_FOR_MS).toBe(60 * MINUTE)
  })

  test('reads the registry again once the copy is an hour old', async () => {
    await load()
    const loaded = await load(60 * MINUTE)
    expect(server.requests).toHaveLength(2)
    expect(loaded.origin).toBe('remote')
    expect(loaded.ageMs).toBe(0)
  })

  test('reads the registry again when asked to refresh', async () => {
    await load()
    const loaded = await load(MINUTE, { refresh: true })
    expect(server.requests).toHaveLength(2)
    expect(loaded.origin).toBe('remote')
  })

  test('falls back to an old copy when the registry cannot be read, and says why', async () => {
    await load()
    delete server.files['/modules.json']
    const loaded = await load(3 * 24 * 60 * MINUTE)
    expect(loaded).toMatchObject({
      origin: 'cache',
      fetchedAt: START.toISOString(),
      ageMs: 3 * 24 * 60 * MINUTE,
      reason: `Could not read ${url}: 404 Not Found.`,
    })
    expect(loaded.modules).toHaveLength(5)
  })

  test('fails when the registry cannot be read and there is no copy', async () => {
    delete server.files['/modules.json']
    await expect(load()).rejects.toThrow(
      `Could not read ${url}: 404 Not Found. There is no cached copy to use.`
    )
  })

  test('keeps a copy per registry', async () => {
    await load()
    server.files['/other.json'] = JSON.stringify({
      schemaVersion: 1,
      modules: [],
    })
    const other = await load(MINUTE, { url: `${server.url}/other.json` })
    expect(other.origin).toBe('remote')
    expect(other.modules).toEqual([])
    expect((await load(MINUTE)).modules).toHaveLength(5)
  })

  test('refuses an unknown schemaVersion and does not fall back to the copy', async () => {
    await load()
    server.files['/modules.json'] = JSON.stringify({
      schemaVersion: 2,
      modules: [],
    })
    await expect(load(2 * 60 * MINUTE)).rejects.toThrow(
      'has schemaVersion 2, and this version of the CLI reads schemaVersion 1'
    )
    // The refused registry did not replace the copy.
    expect((await load(2 * 60 * MINUTE - 61 * MINUTE)).origin).toBe('cache')
  })

  test('fails on a registry that is not JSON', async () => {
    server.files['/modules.json'] = '<html>'
    await expect(load()).rejects.toThrow(
      `Could not read ${url}: it is not valid JSON.`
    )
  })

  test('ignores a copy it cannot read', async () => {
    await load()
    const [file] = readdirSync(cacheDir, { recursive: true }).filter((name) =>
      String(name).endsWith('.json')
    )
    writeFileSync(join(cacheDir, String(file)), '{ broken')
    const loaded = await load(MINUTE)
    expect(loaded.origin).toBe('remote')
    expect(server.requests).toHaveLength(2)
  })
})

describe('describeAge', () => {
  test.each([
    [0, 'less than a minute'],
    [59_000, 'less than a minute'],
    [MINUTE, '1 minute'],
    [59 * MINUTE, '59 minutes'],
    [60 * MINUTE, '1 hour'],
    [47 * 60 * MINUTE, '47 hours'],
    [48 * 60 * MINUTE, '2 days'],
    [30 * 24 * 60 * MINUTE, '30 days'],
  ])('%i ms is %s', (ms, text) => {
    expect(describeAge(ms)).toBe(text)
  })
})
