import { describe, expect, test } from 'vitest'
import { DrxError } from '../../src/errors.js'
import { parseModuleRegistry } from '../../src/modules/entry.js'
import { moduleRegistry, moduleRegistryWith } from '../helpers/modules.js'

const AT = 'https://example.com/modules.json'
const NPM_NAME = 'modules[1].npm must be the name of an npm package'
const MODULE_NAME =
  'modules[1].drupal[0].name must be a machine name: lower-case letters, digits and underscores, starting with a letter'

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

  test('keeps core as the registry states it, and absent when it does not', () => {
    const registry = moduleRegistryWith(0, (module) => {
      module.drupal = [
        { name: 'one', label: 'One', core: false },
        { name: 'two', label: 'Two' },
      ]
    })
    const [auth] = parseModuleRegistry(registry, AT)
    expect(auth?.backend).toEqual([
      { kind: 'drupal', name: 'one', label: 'One', core: false },
      { kind: 'drupal', name: 'two', label: 'Two' },
    ])
  })

  test.each([
    'druxt',
    'druxt-blocks',
    '@druxt-contrib/node-preview',
    '@druxt/core',
    'druxt.js',
    'druxt_blocks',
    '',
  ])('takes %j as the name of a package', (npm) => {
    const registry = moduleRegistryWith(1, (module) => {
      module.npm = npm
    })
    expect(parseModuleRegistry(registry, AT)[1]?.npm).toBe(npm)
  })

  test.each(['block', 'jsonapi_menu_items', 'ckeditor5', 'a'])(
    'takes %j as the name of a backend module',
    (name) => {
      const registry = moduleRegistryWith(1, (module) => {
        module.drupal = [{ name, label: 'Block' }]
      })
      expect(parseModuleRegistry(registry, AT)[1]?.backend[0]?.name).toBe(name)
    }
  )

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
    ['npm', '--registry=https://example.com', NPM_NAME],
    ['npm', '-g', NPM_NAME],
    ['npm', 'druxt-blocks & calc', NPM_NAME],
    ['npm', 'Druxt-Blocks', NPM_NAME],
    ['npm', '../druxt-blocks', NPM_NAME],
    ['npm', '@druxt/', NPM_NAME],
    ['npm', 'druxt-blocks@latest', NPM_NAME],
    ['npm', 'a'.repeat(215), NPM_NAME],
    ['drupal', [{ name: '--uri=example.com', label: 'Block' }], MODULE_NAME],
    ['drupal', [{ name: 'block,node', label: 'Block' }], MODULE_NAME],
    ['drupal', [{ name: 'block node', label: 'Block' }], MODULE_NAME],
    ['drupal', [{ name: 'Block', label: 'Block' }], MODULE_NAME],
    ['drupal', [{ name: '9lives', label: 'Block' }], MODULE_NAME],
    ['drupal', [{ name: 'block|calc', label: 'Block' }], MODULE_NAME],
  ])('names the bad field: %s = %j', (field, value, message) => {
    const registry = moduleRegistryWith(1, (module) => {
      if (value === undefined) delete module[field]
      else module[field] = value
    })
    expect(() => parseModuleRegistry(registry, AT)).toThrow(
      `The module registry at ${AT} is invalid: ${message}.`
    )
  })

  test('reads what a backend module needs done to add it', () => {
    const registry = moduleRegistryWith(1, (module) => {
      module.drupal = [
        {
          name: 'jsonapi_menu',
          label: 'Menu items',
          composer: {
            package: 'drupal/jsonapi_menu_items',
            constraint: '^1.2',
          },
          setup: [
            {
              title: 'Create a consumer',
              command: 'drush x',
              url: 'https://example.com/doc',
            },
            { title: 'Save the keys' },
          ],
          patches: [
            {
              description: 'Fix a crash',
              url: 'https://example.com/1.diff',
              package: 'drupal/core',
              issue: 'https://example.com/issue/1',
              until: '11.3.0',
            },
            { description: 'Another', url: 'https://example.com/2.diff' },
          ],
        },
      ]
    })
    expect(parseModuleRegistry(registry, AT)[1]?.backend).toEqual([
      {
        kind: 'drupal',
        name: 'jsonapi_menu',
        label: 'Menu items',
        composer: { package: 'drupal/jsonapi_menu_items', constraint: '^1.2' },
        setup: [
          {
            title: 'Create a consumer',
            command: 'drush x',
            url: 'https://example.com/doc',
          },
          { title: 'Save the keys' },
        ],
        patches: [
          {
            description: 'Fix a crash',
            url: 'https://example.com/1.diff',
            package: 'drupal/core',
            issue: 'https://example.com/issue/1',
            until: '11.3.0',
          },
          { description: 'Another', url: 'https://example.com/2.diff' },
        ],
      },
    ])
  })

  test.each([
    [{ composer: 'drupal/x' }, 'composer must be an object'],
    [{ composer: {} }, 'composer.package must be a non-empty string'],
    [
      { composer: { package: 'drupal/x', constraint: 1 } },
      'composer.constraint must be a string',
    ],
    [{ setup: 'x' }, 'setup must be an array'],
    [{ setup: [{}] }, 'setup[0].title must be a non-empty string'],
    [
      { setup: [{ title: 'x', command: 1 }] },
      'setup[0].command must be a string',
    ],
    [{ patches: {} }, 'patches must be an array'],
    [
      { patches: [{ url: 'https://example.com/a.diff' }] },
      'patches[0].description must be a non-empty string',
    ],
    [
      { patches: [{ description: 'x', url: 'ftp://example.com/a.diff' }] },
      'patches[0].url must be an http or https URL',
    ],
    [
      {
        patches: [
          { description: 'x', url: 'https://example.com/a.diff', until: 1 },
        ],
      },
      'patches[0].until must be a string',
    ],
  ])('names the bad field of a backend module in %j', (extra, message) => {
    const registry = moduleRegistryWith(1, (module) => {
      module.drupal = [{ name: 'block', label: 'Block', ...extra }]
    })
    expect(() => parseModuleRegistry(registry, AT)).toThrow(
      `The module registry at ${AT} is invalid: modules[1].drupal[0].${message}.`
    )
  })
})
