import { afterEach, describe, expect, test } from 'vitest'
import { adapterFor } from '../../src/adapters/index.js'
import type { AddRequest, ModuleChange } from '../../src/adapters/adapter.js'
import type { BackendModule } from '../../src/modules/entry.js'
import { cleanTmp, tmp, writeTree } from '../helpers/tmp.js'

afterEach(cleanTmp)

const drupal = adapterFor('drupal')!
const PLUGIN = 'cweagans/composer-patches'

const need = (
  name: string,
  extra: Partial<BackendModule> = {}
): BackendModule => ({
  kind: 'drupal',
  name,
  label: name,
  core: false,
  ...extra,
})

/** A site's composer.json, written with four spaces as Composer writes it. */
function site(
  composer: Record<string, unknown> = {},
  files: Record<string, unknown> = {}
): string {
  const dir = tmp('drx-backend-')
  writeTree(dir, {
    'composer.json':
      JSON.stringify(
        { require: { 'drupal/core-recommended': '~11' }, ...composer },
        null,
        4
      ) + '\n',
    ...files,
  })
  return dir
}

const add = (
  dir: string,
  needs: BackendModule[],
  options: Partial<AddRequest> = {}
) =>
  drupal.addModule(dir, {
    needs,
    patches: true,
    registryStatesCore: true,
    ...options,
  })

const runs = (change: ModuleChange) =>
  change.steps.flatMap((step) =>
    'run' in step ? [`${step.run.tool} ${step.run.args.join(' ')}`] : []
  )
const edit = (change: ModuleChange) =>
  change.steps.flatMap((step) => ('edit' in step ? [step.edit] : []))[0]

describe('adding the backend modules a Druxt module needs', () => {
  test('requires a contributed module and enables it', async () => {
    const change = await add(site(), [need('decoupled_router')])
    expect(runs(change)).toEqual([
      'composer require drupal/decoupled_router',
      'drush en -y decoupled_router',
    ])
    expect(change.record).toEqual({
      modules: [
        { name: 'decoupled_router', package: 'drupal/decoupled_router' },
      ],
      patches: [],
    })
    expect(change.problems).toEqual([])
  })

  test('only enables a core module', async () => {
    const change = await add(site(), [need('jsonapi', { core: true })])
    expect(runs(change)).toEqual(['drush en -y jsonapi'])
    expect(change.record).toEqual({ modules: [], patches: [] })
  })

  test('requires the package and constraint the registry names', async () => {
    const change = await add(site(), [
      need('menu_items', {
        composer: { package: 'drupal/jsonapi_menu_items', constraint: '^1.2' },
      }),
      need('views', { core: true }),
    ])
    expect(runs(change)).toEqual([
      'composer require drupal/jsonapi_menu_items:^1.2',
      'drush en -y menu_items views',
    ])
    expect(change.record?.modules).toEqual([
      { name: 'menu_items', package: 'drupal/jsonapi_menu_items' },
    ])
  })

  test('does not require a package the site has, and does not record it', async () => {
    const dir = site({
      require: {
        'drupal/core-recommended': '~11',
        'drupal/decoupled_router': '^2',
      },
    })
    const change = await add(dir, [need('decoupled_router')])
    expect(runs(change)).toEqual(['drush en -y decoupled_router'])
    expect(change.notes).toContain(
      'drupal/decoupled_router is already required in composer.json.'
    )
    expect(change.record?.modules).toEqual([])
  })

  test('has nothing to do for a module that needs nothing', async () => {
    const change = await add(site(), [])
    expect(change.steps).toEqual([])
  })

  test('lists what is left to do, and does not run it', async () => {
    const change = await add(site(), [
      need('simple_oauth', {
        label: 'Simple OAuth',
        setup: [
          {
            title: 'Generate the keys',
            command: 'drush simple-oauth:generate-keys ../keys',
            url: 'https://example.com/keys',
          },
          { title: 'Create a consumer' },
        ],
      }),
    ])
    expect(change.after).toEqual([
      'Simple OAuth: Generate the keys',
      '  drush simple-oauth:generate-keys ../keys',
      '  https://example.com/keys',
      'Simple OAuth: Create a consumer',
    ])
    expect(runs(change).join('\n')).not.toContain('generate-keys')
  })

  test('fails on a part with no composer.json', async () => {
    const change = await add(tmp(), [need('decoupled_router')])
    expect(change.problems).toEqual([
      'There is no composer.json to add decoupled_router to.',
    ])
    expect(change.steps).toEqual([])
  })
})

describe('telling a core module from a contributed one when the registry does not', () => {
  const published = { registryStatesCore: false }

  test('looks in the core the site has installed', async () => {
    const dir = site(
      {},
      { 'web/core/modules/jsonapi/jsonapi.info.yml': 'name: JSON:API\n' }
    )
    const change = await add(
      dir,
      [need('jsonapi'), need('decoupled_router')],
      published
    )
    expect(runs(change)).toEqual([
      'composer require drupal/decoupled_router',
      'drush en -y jsonapi decoupled_router',
    ])
  })

  test('finds core under the web root the site names', async () => {
    const dir = site(
      {
        extra: { 'drupal-scaffold': { locations: { 'web-root': 'docroot/' } } },
      },
      { 'docroot/core/modules/views/views.info.yml': 'name: Views\n' }
    )
    expect(runs(await add(dir, [need('views')], published))).toEqual([
      'drush en -y views',
    ])
  })

  test('knows a package the site already requires is contributed', async () => {
    const dir = site({
      require: {
        'drupal/core-recommended': '~11',
        'drupal/decoupled_router': '^2',
      },
    })
    const change = await add(dir, [need('decoupled_router')], published)
    expect(change.problems).toEqual([])
    expect(runs(change)).toEqual(['drush en -y decoupled_router'])
  })

  test('refuses to guess when core is not installed, and takes no step', async () => {
    const change = await add(site(), [need('jsonapi')], published)
    expect(change.problems).toEqual([
      'Cannot tell whether jsonapi is part of core or a package to require: the module registry does not say, and core is not installed in this part to look in. Install the dependencies of the backend, then run this again.',
    ])
    expect(change.steps).toEqual([])
  })
})

describe('the patches a backend module needs', () => {
  const patched = (extra: Partial<BackendModule> = {}) =>
    need('decoupled_router', {
      label: 'Decoupled Router',
      patches: [
        {
          description: 'Fix the redirect loop',
          url: 'https://example.com/mr/12.diff',
          issue: 'https://example.com/issue/12',
        },
        {
          description: 'Fix core',
          url: 'https://example.com/mr/9.diff',
          package: 'drupal/core',
          until: '11.3.0',
        },
      ],
      ...extra,
    })

  test('are written to extra.patches, with the plugin required and allowed', async () => {
    const dir = site()
    const change = await add(dir, [patched()])
    const written = JSON.parse(edit(change)?.content ?? '{}')
    expect(written.extra.patches).toEqual({
      'drupal/decoupled_router': {
        'Fix the redirect loop': 'https://example.com/mr/12.diff',
      },
      'drupal/core': { 'Fix core': 'https://example.com/mr/9.diff' },
    })
    expect(written.config['allow-plugins'][PLUGIN]).toBe(true)
    expect(written.require).toEqual({ 'drupal/core-recommended': '~11' })
    expect(edit(change)?.file).toBe('composer.json')
    expect(edit(change)?.summary).toBe('Add 2 patches to composer.json')
    // Composer's own four spaces, and the newline the file ends with.
    expect(edit(change)?.content).toMatch(/^\{\n {4}"require"/)
    expect(edit(change)?.content.endsWith('}\n')).toBe(true)

    expect(change.steps.map((step) => Object.keys(step)[0])[0]).toBe('edit')
    expect(runs(change)).toEqual([
      `composer require ${PLUGIN}:^2.0@beta`,
      'composer patches-relock',
      'composer require drupal/decoupled_router',
      'composer patches-repatch',
      'drush en -y decoupled_router',
    ])
    expect(change.record?.patches).toEqual([
      {
        package: 'drupal/decoupled_router',
        description: 'Fix the redirect loop',
        url: 'https://example.com/mr/12.diff',
      },
      {
        package: 'drupal/core',
        description: 'Fix core',
        url: 'https://example.com/mr/9.diff',
      },
    ])
  })

  test('are each shown with the issue they belong to', async () => {
    const change = await add(site(), [patched()])
    expect(change.notes).toEqual([
      'Patch for drupal/decoupled_router: Fix the redirect loop (https://example.com/issue/12)',
      'Patch for drupal/core: Fix core',
    ])
  })

  test('leave the plugin alone when the site has it, and keep its other patches', async () => {
    const dir = site({
      require: { 'drupal/core-recommended': '~11', [PLUGIN]: '^2.0' },
      extra: {
        patches: { 'drupal/druxt': { 'A local fix': 'patches/a.patch' } },
      },
    })
    const change = await add(dir, [patched()])
    const written = JSON.parse(edit(change)?.content ?? '{}')
    expect(written.extra.patches['drupal/druxt']).toEqual({
      'A local fix': 'patches/a.patch',
    })
    expect(written.config).toBeUndefined()
    expect(runs(change)).not.toContain(`composer require ${PLUGIN}:^2.0@beta`)
  })

  test('skip one whose fix the installed package has', async () => {
    const dir = site(
      {},
      {
        'vendor/composer/installed.json': {
          packages: [{ name: 'drupal/core', version: '11.3.2' }],
        },
      }
    )
    const change = await add(dir, [patched()])
    expect(JSON.parse(edit(change)?.content ?? '{}').extra.patches).toEqual({
      'drupal/decoupled_router': {
        'Fix the redirect loop': 'https://example.com/mr/12.diff',
      },
    })
    expect(change.notes).toContain(
      'The patch "Fix core" is not needed: drupal/core 11.3.2 has the fix, which came in 11.3.0.'
    )
    expect(change.record?.patches).toHaveLength(1)
  })

  test('skip one the site already carries, and do not record it', async () => {
    const dir = site({
      require: { 'drupal/core-recommended': '~11', [PLUGIN]: '^2.0' },
      extra: {
        patches: {
          'drupal/decoupled_router': {
            Theirs: 'https://example.com/mr/12.diff',
          },
        },
      },
    })
    const change = await add(dir, [
      patched({
        patches: [
          {
            description: 'Fix the redirect loop',
            url: 'https://example.com/mr/12.diff',
          },
        ],
      }),
    ])
    expect(edit(change)).toBeUndefined()
    expect(change.record?.patches).toEqual([])
    expect(change.notes).toContain(
      'The patch "Fix the redirect loop" is already in composer.json.'
    )
  })

  test('are left out, with a warning, when patches are turned off', async () => {
    const change = await add(site(), [patched()], { patches: false })
    expect(edit(change)).toBeUndefined()
    expect(runs(change)).toEqual([
      'composer require drupal/decoupled_router',
      'drush en -y decoupled_router',
    ])
    expect(change.warnings).toEqual([
      'The patch "Fix the redirect loop" for drupal/decoupled_router was not applied. Decoupled Router may not work without it.',
      'The patch "Fix core" for drupal/core was not applied. Decoupled Router may not work without it.',
    ])
  })
})

describe('taking backend modules out again', () => {
  const record = {
    modules: [
      { name: 'decoupled_router', package: 'drupal/decoupled_router' },
      { name: 'jsonapi_menu_items', package: 'drupal/jsonapi_menu_items' },
    ],
    patches: [
      {
        package: 'drupal/decoupled_router',
        description: 'Fix the redirect loop',
        url: 'https://example.com/mr/12.diff',
      },
    ],
  }
  const carrying = () =>
    site({
      extra: {
        patches: {
          'drupal/decoupled_router': {
            'Fix the redirect loop': 'https://example.com/mr/12.diff',
            'Their own': 'patches/own.patch',
          },
        },
      },
    })

  test('uninstalls and removes what the record says was added', async () => {
    const change = await drupal.removeModule(carrying(), {
      record,
      stillNeeded: [],
    })
    expect(runs(change)).toEqual([
      'drush pmu -y decoupled_router jsonapi_menu_items',
      'composer remove drupal/decoupled_router drupal/jsonapi_menu_items',
      'composer patches-relock',
    ])
    expect(JSON.parse(edit(change)?.content ?? '{}').extra.patches).toEqual({
      'drupal/decoupled_router': { 'Their own': 'patches/own.patch' },
    })
    expect(edit(change)?.summary).toBe('Remove 1 patch from composer.json')
  })

  test('keeps a module something else still needs', async () => {
    const change = await drupal.removeModule(carrying(), {
      record,
      stillNeeded: ['decoupled_router'],
    })
    expect(runs(change)).toEqual([
      'drush pmu -y jsonapi_menu_items',
      'composer remove drupal/jsonapi_menu_items',
    ])
    expect(edit(change)).toBeUndefined()
    expect(change.notes).toContain(
      'decoupled_router stays: another installed module needs it.'
    )
  })

  test('drops the patches key when its last patch goes', async () => {
    const dir = site({
      extra: {
        patches: {
          'drupal/decoupled_router': {
            'Fix the redirect loop': 'https://example.com/mr/12.diff',
          },
        },
      },
    })
    const change = await drupal.removeModule(dir, { record, stillNeeded: [] })
    expect(JSON.parse(edit(change)?.content ?? '{}').extra).toEqual({})
  })

  test('does nothing with no record', async () => {
    const change = await drupal.removeModule(carrying(), { stillNeeded: [] })
    expect(change.steps).toEqual([])
  })
})
