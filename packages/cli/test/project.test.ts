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

const MACHINE_NAME =
  'must be a machine name: lower-case letters, digits and underscores, starting with a letter'
const COMPOSER_NAME =
  'must be the name of a Composer package, as in vendor/name'
/** A record of what was done to the backend part of the project. */
const recordOf = (backend: Record<string, unknown>, path = 'drupal') => ({
  name: 'x',
  package: 'druxt-x',
  backend: [{ path, modules: [], patches: [], ...backend }],
})

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

  test('keeps the record of the modules that were added', async () => {
    const root = tmp()
    const recorded: ProjectConfig = {
      ...config,
      modules: [
        {
          name: 'breadcrumb',
          package: 'druxt-breadcrumb',
          frontend: [{ path: 'nuxt', installed: true, listed: false }],
          backend: [
            {
              path: 'drupal',
              modules: [
                {
                  name: 'decoupled_router',
                  package: 'drupal/decoupled_router',
                  enabled: false,
                  required: true,
                },
                { name: 'block', enabled: true, required: false },
              ],
              patches: [
                {
                  package: 'drupal/core',
                  description: 'Fix',
                  url: 'https://example.com/1.diff',
                  module: 'decoupled_router',
                },
              ],
            },
          ],
        },
      ],
    }
    await writeProjectConfig(root, recorded)
    expect(await loadProjectConfig(root)).toEqual(recorded)
  })

  test('reads the record an older version wrote', async () => {
    const root = tmp()
    const patch = {
      package: 'drupal/core',
      description: 'Fix',
      url: 'https://example.com/1.diff',
    }
    writeTree(root, {
      'drx.config.json': {
        ...config,
        modules: [
          {
            name: 'breadcrumb',
            package: 'druxt-breadcrumb',
            backend: [
              {
                path: 'drupal',
                modules: [
                  {
                    name: 'decoupled_router',
                    package: 'drupal/decoupled_router',
                  },
                ],
                patches: [patch],
              },
            ],
          },
          { name: 'blocks', package: 'druxt-blocks', backend: [] },
        ],
      },
    })
    // It required and enabled every module it listed, and kept nothing on
    // the frontend, which stays absent: the record does not say.
    expect((await loadProjectConfig(root)).modules).toEqual([
      {
        name: 'breadcrumb',
        package: 'druxt-breadcrumb',
        backend: [
          {
            path: 'drupal',
            modules: [
              {
                name: 'decoupled_router',
                package: 'drupal/decoupled_router',
                enabled: true,
                required: true,
              },
            ],
            patches: [patch],
          },
        ],
      },
      { name: 'blocks', package: 'druxt-blocks', backend: [] },
    ])
  })

  test.each([
    [{ modules: 'breadcrumb' }, 'modules must be an array'],
    [
      { modules: [{ package: 'x' }] },
      'modules[0].name must be a non-empty string',
    ],
    [
      { modules: [{ name: 'x' }] },
      'modules[0].package must be a non-empty string',
    ],
    [
      { modules: [{ name: 'x', package: 'y', backend: {} }] },
      'modules[0].backend must be an array',
    ],
    [
      { modules: [{ name: 'x', package: '--global', backend: [] }] },
      'modules[0].package must be the name of an npm package',
    ],
    [
      { modules: [{ name: 'x', package: 'y & calc', backend: [] }] },
      'modules[0].package must be the name of an npm package',
    ],
    [
      { modules: [recordOf({ modules: [{ name: 'a,b' }] })] },
      `modules[0].backend[0].modules[0].name ${MACHINE_NAME}`,
    ],
    [
      { modules: [recordOf({ modules: [{ name: '--root=/' }] })] },
      `modules[0].backend[0].modules[0].name ${MACHINE_NAME}`,
    ],
    [
      {
        modules: [
          { name: 'w', package: 'w', backend: [] },
          recordOf({ modules: [{ name: 'a' }, { name: 'b', package: '-W' }] }),
        ],
      },
      `modules[1].backend[0].modules[1].package ${COMPOSER_NAME}`,
    ],
    [
      {
        modules: [
          recordOf({
            patches: [
              { package: '| calc', description: 'x', url: 'https://e.org/x' },
            ],
          }),
        ],
      },
      `modules[0].backend[0].patches[0].package ${COMPOSER_NAME}`,
    ],
    [
      {
        modules: [
          recordOf({
            patches: [
              {
                package: 'drupal/core',
                description: 'x',
                url: 'https://e.org/x',
                module: 'a b',
              },
            ],
          }),
        ],
      },
      `modules[0].backend[0].patches[0].module ${MACHINE_NAME}`,
    ],
  ])('names the bad field of the record in %j', async (extra, message) => {
    const root = tmp()
    writeTree(root, { 'drx.config.json': { ...config, ...extra } })
    await expect(loadProjectConfig(root)).rejects.toThrow(
      `${join(root, 'drx.config.json')} is invalid: ${message}.`
    )
  })

  test('keeps a record for a part the project no longer has, unread', async () => {
    const root = tmp()
    const record = recordOf({ modules: [{ name: 'not a name' }] }, 'gone')
    writeTree(root, { 'drx.config.json': { ...config, modules: [record] } })
    // No part is at that path, so no tool is ever handed what it holds.
    expect((await loadProjectConfig(root)).modules?.[0]?.backend[0]?.path).toBe(
      'gone'
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
