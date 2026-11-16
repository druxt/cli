import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { CliContext } from '../../src/context.js'
import { moduleRegistry } from '../helpers/modules.js'
import { run } from '../helpers/run.js'
import { serve, type TestServer } from '../helpers/server.js'
import { cleanTmp, tmp, writeTree } from '../helpers/tmp.js'

let server: TestServer
let url: string

beforeEach(async () => {
  server = await serve({ '/modules.json': JSON.stringify(moduleRegistry()) })
  url = `${server.url}/modules.json`
})

afterEach(async () => {
  await server.close()
  cleanTmp()
})

const drx = (argv: string[], overrides: Partial<CliContext> = {}) =>
  run(argv, { defaultModuleRegistry: url, ...overrides })

/**
 * A project whose frontend part has blocks installed, asks for node-preview
 * without having it, and has druxt 0.25.2 brought in by another package.
 */
function project(): string {
  const root = tmp('drx-project-')
  writeTree(root, {
    'drx.config.json': {
      layout: 'monorepo',
      line: '0.x',
      starter: 'quickstart',
      source: 'npm',
      parts: [
        { role: 'frontend', kind: 'nuxt', path: 'nuxt' },
        { role: 'backend', kind: 'drupal', path: 'drupal' },
      ],
    },
    'nuxt/package.json': {
      dependencies: {
        nuxt: '2.15.8',
        'druxt-blocks': '^0.25.1',
        '@druxt-contrib/node-preview': '^1.0.0',
      },
    },
    'nuxt/node_modules/druxt/package.json': { version: '0.25.2' },
    'nuxt/node_modules/druxt-blocks/package.json': { version: '0.25.3' },
    'drupal/composer.json': { require: { 'drupal/core-recommended': '~11' } },
  })
  return root
}

describe('drx module list outside a project', () => {
  test('lists the modules, without the archived ones', async () => {
    const result = await drx(['module', 'list'])
    expect(result.code).toBe(0)
    expect(result.stdout).toBe(
      [
        'Name          Package                      Type      Status      Druxt',
        'auth          druxt-auth                   official  stable      unknown',
        'blocks        druxt-blocks                 official  stable      ^0.25.1',
        'ckeditor      -                            contrib   unreleased  unknown',
        'node-preview  @druxt-contrib/node-preview  contrib   stable      >=0.26.0 <1',
        '',
      ].join('\n')
    )
    expect(result.stderr).toBe(`Modules from ${url}.\n`)
  })

  test('--all adds the archived ones, marked, with a range that is not stated', async () => {
    const result = await drx(['module', 'list', '--all'])
    expect(result.stdout).toMatch(
      /^legacy +druxt-legacy +contrib +stable \(archived\) +not stated$/m
    )
  })

  test('--type and --category filter', async () => {
    const contrib = await drx(['module', 'list', '--type', 'contrib'])
    expect(contrib.stdout).not.toContain('auth')
    expect(contrib.stdout).toContain('ckeditor')
    expect(contrib.stdout).toContain('node-preview')

    const both = await drx([
      'module',
      'list',
      '--type',
      'Contrib',
      '--category',
      'authoring-and-preview',
      '--json',
    ])
    expect(
      JSON.parse(both.stdout).modules.map((m: { name: string }) => m.name)
    ).toEqual(['ckeditor', 'node-preview'])
  })

  test('says so when nothing matches', async () => {
    const result = await drx(['module', 'list', '--type', 'imaginary'])
    expect(result.code).toBe(0)
    expect(result.stdout).toBe('No modules match.\n')
  })

  test('--json gives the rows, the registry and no project', async () => {
    const result = await drx(['module', 'list', '--json'])
    const data = JSON.parse(result.stdout)
    expect(result.code).toBe(0)
    expect(data.project).toBeNull()
    expect(data.registry).toMatchObject({ url, origin: 'remote', ageMs: 0 })
    expect(data.modules).toHaveLength(4)
    expect(data.modules[2]).toEqual({
      name: 'ckeditor',
      npm: null,
      type: 'contrib',
      status: 'unreleased',
      category: 'authoring-and-preview',
      archived: false,
      description: 'Render CKEditor content with components',
      druxt: 'unknown',
    })
  })
})

describe('drx module list in a project', () => {
  test('adds what is installed and whether its range admits the Druxt there', async () => {
    const root = project()
    const result = await drx(['module', 'list'], { cwd: join(root, 'nuxt') })
    expect(result.code).toBe(0)
    expect(result.stdout).toBe(
      [
        'Name          Package                      Type      Status      Druxt        Installed  Compatible',
        'auth          druxt-auth                   official  stable      unknown      no         unknown',
        'blocks        druxt-blocks                 official  stable      ^0.25.1      0.25.3     yes',
        'ckeditor      -                            contrib   unreleased  unknown      -          unknown',
        'node-preview  @druxt-contrib/node-preview  contrib   stable      >=0.26.0 <1  declared   no',
        '',
      ].join('\n')
    )
    expect(result.stderr).toContain(
      `Project ${root}: nuxt/ has druxt 0.25.2 installed.`
    )
  })

  test('--json has a row per frontend part for each module', async () => {
    const root = project()
    const result = await drx(['module', 'list', '--json'], { cwd: root })
    const data = JSON.parse(result.stdout)
    expect(data.project).toEqual({
      root,
      parts: [
        {
          path: 'nuxt',
          kind: 'nuxt',
          druxt: { name: 'druxt', range: null, installed: '0.25.2' },
        },
      ],
    })
    expect(data.modules[1].parts).toEqual([
      {
        path: 'nuxt',
        installed: '0.25.3',
        declared: '^0.25.1',
        compatibility: 'compatible',
      },
    ])
    expect(data.modules[0].parts[0]).toEqual({
      path: 'nuxt',
      installed: null,
      declared: null,
      compatibility: 'unknown',
    })
    expect(data.modules[3].parts[0]).toEqual({
      path: 'nuxt',
      installed: null,
      declared: '^1.0.0',
      compatibility: 'incompatible',
    })
  })

  test('says when the part has no Druxt to compare with', async () => {
    const root = tmp()
    writeTree(root, {
      'drx.config.json': {
        layout: 'monorepo',
        line: '0.x',
        starter: 'quickstart',
        source: 'npm',
        parts: [{ role: 'frontend', kind: 'nuxt', path: 'web' }],
      },
      'web/package.json': { dependencies: { nuxt: '2.15.8' } },
    })
    const result = await drx(['module', 'list'], { cwd: root })
    expect(result.stderr).toContain(`Project ${root}: web/ has no druxt.`)
    expect(result.stdout).toMatch(/^blocks .* no +unknown$/m)
  })
})

describe('drx module search', () => {
  test('matches the name, the package and the description, in any case', async () => {
    const byName = await drx(['module', 'search', 'BLOCK'])
    expect(byName.stdout).toContain('blocks')
    expect(byName.stdout).not.toContain('auth')

    const byPackage = await drx(['module', 'search', 'druxt-contrib', '--json'])
    expect(
      JSON.parse(byPackage.stdout).modules.map((m: { name: string }) => m.name)
    ).toEqual(['node-preview'])

    const byDescription = await drx(['module', 'search', 'unsaved content'])
    expect(byDescription.stdout).toContain('node-preview')
    expect(byDescription.stdout).not.toContain('blocks')
  })

  test('says so when nothing matches', async () => {
    const result = await drx(['module', 'search', 'zzz'])
    expect(result.code).toBe(0)
    expect(result.stdout).toBe('No modules match.\n')
  })

  test('takes the same filters as list', async () => {
    const hidden = await drx(['module', 'search', 'legacy'])
    expect(hidden.stdout).toBe('No modules match.\n')
    const shown = await drx(['module', 'search', 'legacy', '--all'])
    expect(shown.stdout).toContain('druxt-legacy')
  })

  test('fails without text to search for', async () => {
    const result = await drx(['module', 'search'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'Give the text to search for, as in "drx module search menu".'
    )
  })
})

describe('drx module info', () => {
  test('prints one module in full', async () => {
    const result = await drx(['module', 'info', 'auth'])
    expect(result.code).toBe(0)
    expect(result.stdout).toBe(
      [
        'auth',
        'Authentication module for DruxtJS',
        '',
        'Package     druxt-auth',
        'Type        official',
        'Status      stable',
        'Category    authentication',
        'Druxt       unknown',
        'Repository  https://github.com/druxt/druxt-auth',
        'Website     https://github.com/druxt/druxt-auth',
        '',
        'Backend modules it needs:',
        '  drupal  simple_oauth  Simple OAuth  https://www.drupal.org/project/simple_oauth',
        '',
      ].join('\n')
    )
  })

  test('finds a module by its package name, and marks core modules', async () => {
    const result = await drx(['module', 'info', 'druxt-blocks'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain(
      'Repository  https://github.com/druxt/druxt.js/tree/HEAD/packages/blocks'
    )
    expect(result.stdout).toContain('  drupal  block  Block  (core)')
  })

  test('says what a module lacks', async () => {
    const ckeditor = await drx(['module', 'info', 'ckeditor'])
    expect(ckeditor.stdout).toContain('Package     not published')
    const legacy = await drx(['module', 'info', 'legacy'])
    expect(legacy.stdout).toContain('Status      stable (archived)')
    expect(legacy.stdout).toContain('Druxt       not stated')
    expect(legacy.stdout).toContain('Backend modules it needs: none listed.')
  })

  test('in a project adds the installed version and the compatibility', async () => {
    const root = project()
    const blocks = await drx(['module', 'info', 'blocks'], { cwd: root })
    expect(blocks.stdout).toContain(
      [
        'In nuxt/:',
        '  Installed   0.25.3 (asked for as ^0.25.1)',
        '  Druxt       0.25.2 installed',
        '  Compatible  yes',
        '',
      ].join('\n')
    )
    const preview = await drx(['module', 'info', 'node-preview'], { cwd: root })
    expect(preview.stdout).toContain(
      [
        'In nuxt/:',
        '  Installed   no (asked for as ^1.0.0)',
        '  Druxt       0.25.2 installed',
        '  Compatible  no',
        '',
      ].join('\n')
    )
    const auth = await drx(['module', 'info', 'auth'], { cwd: root })
    expect(auth.stdout).toContain('  Installed   no\n')
    expect(auth.stdout).toContain('  Compatible  unknown')
  })

  test('--json has the whole entry', async () => {
    const root = project()
    const result = await drx(['module', 'info', 'blocks', '--json'], {
      cwd: root,
    })
    const data = JSON.parse(result.stdout)
    expect(data.module).toEqual({
      name: 'blocks',
      npm: 'druxt-blocks',
      type: 'official',
      status: 'stable',
      category: 'site-and-layout',
      archived: false,
      description: 'Drupal Blocks, Block Regions and more',
      druxt: '^0.25.1',
      repository: 'https://github.com/druxt/druxt.js/tree/HEAD/packages/blocks',
      website: 'https://druxtjs.org/modules/blocks',
      backend: [{ kind: 'drupal', name: 'block', label: 'Block', core: true }],
      parts: [
        {
          path: 'nuxt',
          installed: '0.25.3',
          declared: '^0.25.1',
          compatibility: 'compatible',
        },
      ],
    })
    expect(data.project.root).toBe(root)
  })

  test('fails on an unknown name, with the closest ones', async () => {
    const result = await drx(['module', 'info', 'blok', '--json'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'There is no module named "blok". Closest: blocks.'
    )
    expect(JSON.parse(result.stdout).error.code).toBe('unknown-module')
  })

  test('fails on a name nothing is close to', async () => {
    const result = await drx(['module', 'info', 'zzzzzzzzzz'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'There is no module named "zzzzzzzzzz". Run "drx module list --all" to see every name.'
    )
  })

  test('fails without a name', async () => {
    const result = await drx(['module', 'info'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'Give the name of a module, as in "drx module info blocks".'
    )
  })
})

describe('the module registry the commands read', () => {
  test('--module-registry takes a URL', async () => {
    server.files['/other.json'] = JSON.stringify({
      schemaVersion: 1,
      modules: [],
    })
    const other = `${server.url}/other.json`
    const result = await drx(['module', 'list', '--module-registry', other])
    expect(result.stderr).toBe(`Modules from ${other}.\n`)
    expect(result.stdout).toBe('No modules match.\n')
  })

  test('--module-registry takes a name from the user configuration', async () => {
    const home = tmp()
    writeTree(home, { 'config.json': { moduleRegistries: { ours: url } } })
    const result = await drx(['module', 'list', '--module-registry', 'ours'], {
      defaultModuleRegistry: 'http://127.0.0.1:9/unused.json',
      env: { DRX_CONFIG: join(home, 'config.json') },
    })
    expect(result.code).toBe(0)
    expect(result.stderr).toBe(`Modules from ${url}.\n`)
  })

  test('says when a fresh copy was used, and --refresh reads again', async () => {
    const cacheDir = tmp('drx-cache-')
    const start = new Date('2026-11-16T10:00:00Z')
    await drx(['module', 'list'], { cacheDir, now: () => start })
    const later = { cacheDir, now: () => new Date(start.getTime() + 600_000) }

    const cached = await drx(['module', 'list'], later)
    expect(cached.stderr).toBe(`Modules from ${url}, read 10 minutes ago.\n`)
    expect(server.requests).toHaveLength(1)

    const refreshed = await drx(['module', 'list', '--refresh'], later)
    expect(refreshed.stderr).toBe(`Modules from ${url}.\n`)
    expect(server.requests).toHaveLength(2)
  })

  test('says when an old copy stood in for a registry that cannot be read', async () => {
    const cacheDir = tmp('drx-cache-')
    const start = new Date('2026-11-16T10:00:00Z')
    await drx(['module', 'list'], { cacheDir, now: () => start })
    delete server.files['/modules.json']

    const result = await drx(['module', 'list', '--json'], {
      cacheDir,
      now: () => new Date(start.getTime() + 3 * 86_400_000),
    })
    expect(result.code).toBe(0)
    expect(result.stderr).toBe(
      `Could not read ${url}: 404 Not Found.\nUsing the copy of the registry read 3 days ago.\n`
    )
    expect(JSON.parse(result.stdout).registry).toMatchObject({
      origin: 'cache',
      ageMs: 3 * 86_400_000,
      reason: `Could not read ${url}: 404 Not Found.`,
    })
  })

  test('fails on a schemaVersion it does not know', async () => {
    server.files['/modules.json'] = JSON.stringify({
      schemaVersion: 2,
      modules: [],
    })
    const result = await drx(['module', 'list'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('has schemaVersion 2')
  })
})

describe('the module commands that are not built', () => {
  test.each(['add', 'remove', 'configure'])(
    'drx module %s says it is not available yet',
    async (command) => {
      const result = await drx(['module', command, 'blocks', '--json'])
      expect(result.code).toBe(1)
      expect(result.stderr).toContain(
        `drx module ${command} is not available yet. This version can list, search and show modules.`
      )
      expect(JSON.parse(result.stdout).error.code).toBe('not-available')
      expect(server.requests).toEqual([])
    }
  )
})

describe('drx module usage', () => {
  test('--help lists the module commands', async () => {
    const result = await drx(['module', '--help'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('USAGE drx module')
    for (const name of [
      'list',
      'search',
      'info',
      'add',
      'remove',
      'configure',
    ]) {
      expect(result.stdout).toMatch(new RegExp(`^ +${name} `, 'm'))
    }
  })

  test('<command> --help describes that command', async () => {
    const result = await drx(['module', 'list', '--help'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('USAGE drx module list')
    expect(result.stdout).toContain('--module-registry')
  })

  test('fails on an unknown option, naming it', async () => {
    const result = await drx(['module', 'list', '--archived'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'Unknown option --archived. Run "drx module list --help" for the options.'
    )
  })

  test('fails with no module command', async () => {
    const result = await drx(['module'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('No command specified')
  })
})
