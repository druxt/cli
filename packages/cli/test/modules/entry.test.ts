import { describe, expect, test } from 'vitest'
import { DrxError } from '../../src/errors.js'
import { parseModuleRegistry } from '../../src/modules/entry.js'
import { moduleRegistry, moduleRegistryWith } from '../helpers/modules.js'

const AT = 'https://example.com/modules.json'

describe('parseModuleRegistry', () => {
  test('reads an entry, keeping what the CLI uses', () => {
    const [auth, blocks] = parseModuleRegistry(moduleRegistry(), AT)
    expect(auth).toEqual({
      name: 'auth',
      npm: 'druxt-auth',
      repo: 'druxt/druxt-auth',
      category: 'authentication',
      status: 'stable',
      type: 'official',
      archived: false,
      description: 'Authentication module for DruxtJS',
      website: 'https://github.com/druxt/druxt-auth',
      druxt: 'unknown',
      backend: [
        {
          kind: 'drupal',
          name: 'simple_oauth',
          label: 'Simple OAuth',
          core: false,
          url: 'https://www.drupal.org/project/simple_oauth',
        },
      ],
    })
    expect(blocks?.path).toBe('packages/blocks')
    expect(blocks?.druxt).toBe('^0.25.1')
    expect(blocks?.backend).toEqual([
      { kind: 'drupal', name: 'block', label: 'Block', core: true },
    ])
  })

  test('fills in what an entry leaves out', () => {
    const modules = parseModuleRegistry(moduleRegistry(), AT)
    const ckeditor = modules.find(({ name }) => name === 'ckeditor')
    const legacy = modules.find(({ name }) => name === 'legacy')
    expect(ckeditor?.npm).toBeUndefined()
    expect(legacy?.druxt).toBeUndefined()
    expect(legacy?.backend).toEqual([])
    expect(legacy?.archived).toBe(true)
  })

  test('ignores fields it does not know', () => {
    const registry = {
      ...moduleRegistryWith(0, (module) => {
        module.downloads = { weekly: 12 }
      }),
      generatedAt: '2026-11-16',
    }
    expect(parseModuleRegistry(registry, AT)).toEqual(
      parseModuleRegistry(moduleRegistry(), AT)
    )
  })

  test('refuses a schemaVersion it does not know, saying so', () => {
    const attempt = () =>
      parseModuleRegistry({ ...moduleRegistry(), schemaVersion: 2 }, AT)
    expect(attempt).toThrow(DrxError)
    expect(attempt).toThrow(
      `The module registry at ${AT} has schemaVersion 2, and this version of the CLI reads schemaVersion 1. Update @druxt/cli to read it.`
    )
  })

  test.each([
    ['a string', 'it must be an object'],
    [{ modules: [] }, 'schemaVersion must be a number'],
    [{ schemaVersion: 1 }, 'modules must be an array'],
    [{ schemaVersion: 1, modules: ['x'] }, 'modules[0] must be an object'],
  ])('names what is wrong with %j', (registry, message) => {
    expect(() => parseModuleRegistry(registry, AT)).toThrow(
      `The module registry at ${AT} is invalid: ${message}.`
    )
  })

  test.each([
    ['name', undefined, 'modules[1].name must be a non-empty string'],
    ['name', '', 'modules[1].name must be a non-empty string'],
    ['repo', 7, 'modules[1].repo must be a non-empty string'],
    ['category', undefined, 'modules[1].category must be a non-empty string'],
    ['status', null, 'modules[1].status must be a non-empty string'],
    ['type', [], 'modules[1].type must be a non-empty string'],
    ['npm', 7, 'modules[1].npm must be a string'],
    ['path', {}, 'modules[1].path must be a string'],
    ['description', 7, 'modules[1].description must be a string'],
    ['website', false, 'modules[1].website must be a string'],
    ['archived', 'no', 'modules[1].archived must be true or false'],
    ['compatibility', '^1', 'modules[1].compatibility must be an object'],
    [
      'compatibility',
      { druxt: 1 },
      'modules[1].compatibility.druxt must be a string',
    ],
    ['drupal', 'block', 'modules[1].drupal must be an array'],
    ['drupal', ['block'], 'modules[1].drupal[0] must be an object'],
    [
      'drupal',
      [{ label: 'Block' }],
      'modules[1].drupal[0].name must be a non-empty string',
    ],
    [
      'drupal',
      [{ name: 'block' }],
      'modules[1].drupal[0].label must be a non-empty string',
    ],
    [
      'drupal',
      [{ name: 'block', label: 'Block', core: 'yes' }],
      'modules[1].drupal[0].core must be true or false',
    ],
    [
      'drupal',
      [{ name: 'block', label: 'Block', url: 7 }],
      'modules[1].drupal[0].url must be a string',
    ],
  ])('names the bad field: %s = %j', (field, value, message) => {
    const registry = moduleRegistryWith(1, (module) => {
      if (value === undefined) delete module[field]
      else module[field] = value
    })
    expect(() => parseModuleRegistry(registry, AT)).toThrow(
      `The module registry at ${AT} is invalid: ${message}.`
    )
  })
})
