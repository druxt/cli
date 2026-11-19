import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  CONFIG_FILE,
  findProjectRoot,
  loadProjectConfig,
  writeProjectConfig,
  type ProjectConfig,
} from '../src/project.js'
import { cleanTmp, tmp, writeTree } from './helpers/tmp.js'

afterEach(cleanTmp)

const config: ProjectConfig = {
  layout: 'monorepo',
  line: '0.x',
  starter: 'quickstart',
  source: 'npm',
  parts: [
    { role: 'frontend', kind: 'nuxt', path: 'nuxt' },
    { role: 'backend', kind: 'drupal', path: 'drupal' },
  ],
}

describe('writeProjectConfig', () => {
  test('writes drx.config.json at the project root', async () => {
    const root = tmp()
    const file = await writeProjectConfig(root, config)
    expect(file).toBe(join(root, 'drx.config.json'))
    expect(CONFIG_FILE).toBe('drx.config.json')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(config)
    expect(readFileSync(file, 'utf8').endsWith('}\n')).toBe(true)
  })
})

describe('findProjectRoot', () => {
  test('finds the root from a directory below it', async () => {
    const root = tmp()
    await writeProjectConfig(root, config)
    const deep = join(root, 'nuxt', 'components')
    mkdirSync(deep, { recursive: true })
    expect(findProjectRoot(deep)).toBe(root)
    expect(findProjectRoot(root)).toBe(root)
  })

  test('is undefined outside a project', () => {
    expect(findProjectRoot(tmp())).toBeUndefined()
  })
})

describe('loadProjectConfig', () => {
  test('reads back what was written', async () => {
    const root = tmp()
    await writeProjectConfig(root, config)
    expect(await loadProjectConfig(root)).toEqual(config)
  })

  test.each([
    [
      { ...config, layout: 'pile' },
      'layout must be one of monorepo, split, workspace',
    ],
    [{ ...config, line: 7 }, 'line must be a non-empty string'],
    [{ ...config, starter: '' }, 'starter must be a non-empty string'],
    [{ ...config, source: undefined }, 'source must be a non-empty string'],
    [{ ...config, parts: [] }, 'parts must be a non-empty array'],
    [
      { ...config, parts: [{ role: 'frontend', kind: 'nuxt', path: '../x' }] },
      'parts[0].path must be a relative path inside the project',
    ],
  ])('names the bad field in %j', async (content, message) => {
    const root = tmp()
    writeTree(root, { 'drx.config.json': content })
    await expect(loadProjectConfig(root)).rejects.toThrow(
      `${join(root, 'drx.config.json')} is invalid: ${message}.`
    )
  })

  test('reads a file again after it has changed', async () => {
    const root = tmp()
    await writeProjectConfig(root, config)
    expect((await loadProjectConfig(root)).line).toBe('0.x')
    await writeProjectConfig(root, { ...config, line: '2.x' })
    expect((await loadProjectConfig(root)).line).toBe('2.x')
  })

  test('reads the engine, the database and the URL of a backend part', async () => {
    const root = tmp()
    const recorded: ProjectConfig = {
      ...config,
      parts: [
        config.parts[0]!,
        {
          ...config.parts[1]!,
          engine: 'none',
          database: 'mariadb',
          baseUrl: 'https://example.com',
        },
      ],
    }
    await writeProjectConfig(root, recorded)
    expect(await loadProjectConfig(root)).toEqual(recorded)
  })

  test.each([
    [{ engine: '' }, 'parts[1].engine must be a non-empty string'],
    [{ database: 7 }, 'parts[1].database must be a non-empty string'],
    [
      { baseUrl: 'example.com' },
      'parts[1].baseUrl must be an http or https URL',
    ],
  ])('names the bad field of a part in %j', async (extra, message) => {
    const root = tmp()
    writeTree(root, {
      'drx.config.json': {
        ...config,
        parts: [config.parts[0], { ...config.parts[1], ...extra }],
      },
    })
    await expect(loadProjectConfig(root)).rejects.toThrow(
      `${join(root, 'drx.config.json')} is invalid: ${message}.`
    )
  })

  test('fails on a file that is not JSON', async () => {
    const root = tmp()
    writeTree(root, { 'drx.config.json': '{ nope' })
    await expect(loadProjectConfig(root)).rejects.toThrow(
      `${join(root, 'drx.config.json')} could not be read`
    )
  })
})
