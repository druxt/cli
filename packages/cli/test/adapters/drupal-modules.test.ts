import { afterEach, describe, expect, test } from 'vitest'
import { adapterFor } from '../../src/adapters/index.js'
import type {
  AddRequest,
  Ask,
  BackendRecord,
  ModuleChange,
} from '../../src/adapters/adapter.js'
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
  ...extra,
})

/**
 * A site that answers what it is asked: which modules are enabled, and what
 * uninstalling one would take with it. `asked` keeps the questions.
 */
function answering(
  enabled: string[] = [],
  dependents: Record<string, string[]> = {},
  paths: Record<string, string> = {}
) {
  const asked: string[] = []
  const ask: Ask = async (tool, args) => {
    asked.push(`${tool} ${args.join(' ')}`)
    if (args[0] === 'pm:list') {
      const list = Object.fromEntries(
        enabled.map((name) => [
          name,
          { name, path: paths[name] ?? `modules/contrib/${name}` },
        ])
      )
      return { code: 0, output: JSON.stringify(list) }
    }
    const name = args[1] as string
    if (!enabled.includes(name)) {
      return {
        code: 1,
        output: `The following module(s) are not installed: ${name}. No modules to uninstall.`,
      }
    }
    const all = [name, ...(dependents[name] ?? [])].join(', ')
    return {
      code: 0,
      output: `The following extensions will be uninstalled: ${all}\n`,
    }
  }
  return { ask, asked }
}
const silent: Ask = async () => ({ code: 1, output: 'No database.' })

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
    ask: answering().ask,
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
        {
          name: 'decoupled_router',
          package: 'drupal/decoupled_router',
          enabled: true,
          required: true,
        },
      ],
      patches: [],
    })
    expect(change.problems).toEqual([])
  })

  test('only enables a core module', async () => {
    const change = await add(site(), [need('jsonapi', { core: true })])
    expect(runs(change)).toEqual(['drush en -y jsonapi'])
    // It has no package, and the record says it was enabled.
    expect(change.record).toEqual({
      modules: [{ name: 'jsonapi', enabled: true, required: false }],
      patches: [],
    })
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
      {
        name: 'menu_items',
        package: 'drupal/jsonapi_menu_items',
        enabled: true,
        required: true,
      },
      { name: 'views', enabled: true, required: false },
    ])
  })

  test('does not require a package the site has, and records only the enabling', async () => {
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
    expect(change.record?.modules).toEqual([
      {
        name: 'decoupled_router',
        package: 'drupal/decoupled_router',
        enabled: true,
        required: false,
      },
    ])
  })

  test('does not enable a module that is enabled, and does not record it', async () => {
    const { ask, asked } = answering(['decoupled_router', 'views'])
    const change = await add(
      site(),
      [need('decoupled_router'), need('views', { core: true })],
      { ask }
    )
    expect(asked).toEqual([
      'drush pm:list --type=module --status=enabled --fields=name,path --format=json',
    ])
    expect(runs(change)).toEqual(['composer require drupal/decoupled_router'])
    expect(change.notes).toEqual([
      'decoupled_router is already enabled.',
      'views is already enabled.',
    ])
    expect(change.record?.modules).toEqual([
      {
        name: 'decoupled_router',
        package: 'drupal/decoupled_router',
        enabled: false,
        required: true,
      },
    ])
  })

  test('records what the site enabled along with it, once the steps have run', async () => {
    const enabled = ['views']
    const { ask } = answering(enabled)
    const change = await add(site(), [need('jsonapi_defaults')], { ask })
    expect(change.record?.modules.map(({ name }) => name)).toEqual([
      'jsonapi_defaults',
    ])
    // Drush enables what a module depends on with it.
    enabled.push('jsonapi_defaults', 'jsonapi_extras')
    expect(await change.settle?.()).toEqual({
      modules: [
        {
          name: 'jsonapi_defaults',
          package: 'drupal/jsonapi_defaults',
          enabled: true,
          required: true,
        },
        { name: 'jsonapi_extras', enabled: true, required: false },
      ],
      patches: [],
    })
  })

  test('records no enabling of a module that did not come up', async () => {
    const { ask } = answering([])
    const change = await add(site(), [need('decoupled_router')], { ask })
    // Nothing was enabled by the time it is asked again.
    expect((await change.settle?.())?.modules).toEqual([
      {
        name: 'decoupled_router',
        package: 'drupal/decoupled_router',
        enabled: false,
        required: true,
      },
    ])
  })

  test('enables, and records no enabling, when the site cannot say what is enabled', async () => {
    const change = await add(site(), [need('views', { core: true })], {
      ask: silent,
    })
    expect(runs(change)).toEqual(['drush en -y views'])
    expect(change.record?.modules).toEqual([])
    expect(change.warnings).toEqual([
      'The backend could not say which modules are enabled. views will be enabled, and drx remove will leave it enabled, since it may have been before.',
    ])
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
    // Neither package is installed yet: each is patched as it is installed.
    expect(runs(change)).toEqual([
      `composer require ${PLUGIN}:^2.0@beta`,
      'composer patches-relock',
      'composer require drupal/decoupled_router',
      'drush en -y decoupled_router',
    ])
    expect(change.record?.patches).toEqual([
      {
        package: 'drupal/decoupled_router',
        description: 'Fix the redirect loop',
        url: 'https://example.com/mr/12.diff',
        module: 'decoupled_router',
      },
      {
        package: 'drupal/core',
        description: 'Fix core',
        url: 'https://example.com/mr/9.diff',
        module: 'decoupled_router',
      },
    ])
  })

  test('are applied in place to a package that is installed, required or not', async () => {
    // Another package brought it in: composer.json does not require it.
    const dir = site(
      {},
      {
        'vendor/composer/installed.json': {
          packages: [{ name: 'drupal/decoupled_router', version: '2.0.7' }],
        },
      }
    )
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
    expect(runs(change)).toEqual([
      `composer require ${PLUGIN}:^2.0@beta`,
      'composer patches-relock',
      'composer require drupal/decoupled_router',
      'composer patches-repatch',
      'drush en -y decoupled_router',
    ])
  })

  test('are refused when one is not served over https, and nothing is planned', async () => {
    const change = await add(site(), [
      patched({
        patches: [
          {
            description: 'Fix the redirect loop',
            url: 'http://example.com/mr/12.diff',
          },
        ],
      }),
    ])
    expect(change.steps).toEqual([])
    expect(change.problems).toEqual([
      'The patch "Fix the redirect loop" that decoupled_router needs is at http://example.com/mr/12.diff, and Composer only fetches a patch over https. Pass --no-patches to add the module without it.',
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

describe('a backend that is not run from here', () => {
  // No `ask`: nothing in the part can be looked at.
  const elsewhere = (dir: string, needs: BackendModule[]) =>
    drupal.addModule(dir, {
      needs,
      patches: true,
      registryStatesCore: false,
    })

  test('gets the lines for a module that may be core, and the doubt is said', async () => {
    const change = await elsewhere(site(), [
      need('jsonapi_menu_items'),
      need('menu_link_content'),
    ])
    expect(change.problems).toEqual([])
    expect(runs(change)).toEqual([
      'composer require drupal/jsonapi_menu_items drupal/menu_link_content',
      'drush en -y jsonapi_menu_items menu_link_content',
    ])
    expect(change.manual).toEqual([
      'The module registry does not say whether jsonapi_menu_items or menu_link_content is part of core. Leave a module that is out of the composer require line: only the enable line applies to it.',
    ])
  })

  test('needs no composer.json to print them', async () => {
    const change = await elsewhere(tmp('drx-nothing-'), [
      need('block', { core: true }),
    ])
    expect(change.problems).toEqual([])
    expect(runs(change)).toEqual(['drush en -y block'])
  })
})

describe('taking backend modules out again', () => {
  const ROUTER = 'decoupled_router'
  const MENU = 'jsonapi_menu_items'
  const record: BackendRecord = {
    modules: [
      {
        name: ROUTER,
        package: 'drupal/decoupled_router',
        enabled: true,
        required: true,
      },
      {
        name: MENU,
        package: 'drupal/jsonapi_menu_items',
        enabled: true,
        required: true,
      },
    ],
    patches: [
      {
        package: 'drupal/decoupled_router',
        description: 'Fix the redirect loop',
        url: 'https://example.com/mr/12.diff',
        module: ROUTER,
      },
    ],
  }
  const carrying = (files: Record<string, unknown> = {}) =>
    site(
      {
        extra: {
          patches: {
            'drupal/decoupled_router': {
              'Fix the redirect loop': 'https://example.com/mr/12.diff',
              'Their own': 'patches/own.patch',
            },
          },
        },
      },
      files
    )
  const remove = (dir: string, ask: Ask, given = record) =>
    drupal.removeModule(dir, { record: given, ask })

  test('uninstalls and removes what the record says was added', async () => {
    const { ask, asked } = answering([ROUTER, MENU])
    const change = await remove(carrying(), ask)
    expect(asked).toEqual([
      'drush pm:uninstall decoupled_router --simulate',
      'drush pm:uninstall jsonapi_menu_items --simulate',
    ])
    expect(runs(change)).toEqual([
      'drush pmu -y decoupled_router jsonapi_menu_items',
      'composer remove --no-update-with-dependencies drupal/decoupled_router drupal/jsonapi_menu_items',
      'composer patches-relock',
    ])
    expect(JSON.parse(edit(change)?.content ?? '{}').extra.patches).toEqual({
      'drupal/decoupled_router': { 'Their own': 'patches/own.patch' },
    })
    expect(edit(change)?.summary).toBe('Remove 1 patch from composer.json')
    expect(change.record).toBeUndefined()
  })

  test('leaves a module an enabled module depends on, with its requirement and patch', async () => {
    const { ask } = answering([ROUTER, MENU, 'druxt'], { [ROUTER]: ['druxt'] })
    const change = await remove(carrying(), ask)
    expect(runs(change)).toEqual([
      'drush pmu -y jsonapi_menu_items',
      'composer remove --no-update-with-dependencies drupal/jsonapi_menu_items',
    ])
    expect(edit(change)).toBeUndefined()
    expect(change.notes).toEqual([
      'decoupled_router stays enabled: druxt depends on it.',
    ])
    expect(change.record).toEqual({
      modules: [record.modules[0]],
      patches: record.patches,
    })
  })

  test('uninstalls two modules of the record that depend on each other', async () => {
    const { ask } = answering([ROUTER, MENU], { [ROUTER]: [MENU] })
    const change = await remove(carrying(), ask)
    expect(runs(change)[0]).toBe(
      'drush pmu -y decoupled_router jsonapi_menu_items'
    )
  })

  test('leaves a module whose dependent is itself held', async () => {
    // MENU depends on ROUTER, and druxt on MENU: neither can go.
    const { ask } = answering([ROUTER, MENU, 'druxt'], {
      [ROUTER]: [MENU, 'druxt'],
      [MENU]: ['druxt'],
    })
    const change = await remove(carrying(), ask)
    expect(runs(change)).toEqual([])
    expect(change.record?.modules).toHaveLength(2)
  })

  test('uninstalls nothing it cannot ask about, and gives the command', async () => {
    const change = await remove(carrying(), silent)
    expect(change.steps).toEqual([])
    expect(change.manual).toEqual([
      'The backend could not say what depends on decoupled_router, so it was left enabled. Once nothing does: drush pm:uninstall decoupled_router, then composer remove drupal/decoupled_router',
      'The backend could not say what depends on jsonapi_menu_items, so it was left enabled. Once nothing does: drush pm:uninstall jsonapi_menu_items, then composer remove drupal/jsonapi_menu_items',
    ])
    expect(change.record).toEqual(record)
  })

  test('does not uninstall a module that is no longer enabled, and removes its package', async () => {
    const { ask } = answering([MENU])
    const change = await remove(carrying(), ask)
    expect(runs(change)[0]).toBe('drush pmu -y jsonapi_menu_items')
    expect(change.notes).toContain(
      'decoupled_router is not enabled, so it is not uninstalled.'
    )
    expect(runs(change)[1]).toBe(
      'composer remove --no-update-with-dependencies drupal/decoupled_router drupal/jsonapi_menu_items'
    )
  })

  describe('a requirement on a module the site had enabled', () => {
    const only: BackendRecord = {
      modules: [
        {
          name: 'jsonapi_views',
          package: 'drupal/jsonapi_views',
          enabled: false,
          required: true,
        },
      ],
      patches: [],
    }
    const installed = (requires: Record<string, string>) => ({
      'vendor/composer/installed.json': {
        packages: [
          { name: 'drupal/jsonapi_views', version: '1.2.0' },
          { name: 'drupal/druxt', version: '1.3.1', require: requires },
        ],
      },
    })

    test('comes out of composer.json alone while another package brings the module in', async () => {
      const dir = site({}, installed({ 'drupal/jsonapi_views': '^1.1' }))
      const { ask, asked } = answering(['jsonapi_views', 'druxt'])
      const change = await remove(dir, ask, only)
      // Composer's remove fails on a package that is still installed.
      expect(runs(change)).toEqual([
        'composer remove --no-update drupal/jsonapi_views',
        'composer update --lock',
      ])
      expect(asked).toEqual([])
      expect(change.record).toBeUndefined()
    })

    test('stays while the module is enabled and nothing else brings it in', async () => {
      const dir = site({}, installed({}))
      const { ask } = answering(['jsonapi_views'])
      const change = await remove(dir, ask, only)
      expect(change.steps).toEqual([])
      expect(change.notes).toEqual([
        'drupal/jsonapi_views stays required: jsonapi_views was enabled before drx add, and nothing else brings it in.',
      ])
      expect(change.record).toEqual(only)
    })

    test('goes once the module is no longer enabled', async () => {
      const { ask } = answering([])
      const change = await remove(site({}, installed({})), ask, only)
      expect(runs(change)).toEqual([
        'composer remove --no-update-with-dependencies drupal/jsonapi_views',
      ])
    })
  })

  test('keeps a package that holds a module that is still enabled', async () => {
    // jsonapi_extras came up with jsonapi_defaults and is in the same package.
    const given: BackendRecord = {
      modules: [
        {
          name: 'jsonapi_defaults',
          package: 'drupal/jsonapi_extras',
          enabled: true,
          required: true,
        },
      ],
      patches: [],
    }
    const dir = site(
      {},
      {
        'vendor/composer/installed.json': {
          packages: [
            {
              name: 'drupal/jsonapi_extras',
              version: '3.28.0',
              'install-path': '../../web/modules/contrib/jsonapi_extras',
            },
          ],
        },
      }
    )
    const { ask } = answering(
      ['jsonapi_defaults', 'jsonapi_extras'],
      {},
      {
        jsonapi_defaults:
          'modules/contrib/jsonapi_extras/modules/jsonapi_defaults',
      }
    )
    const change = await remove(dir, ask, given)
    expect(runs(change)).toEqual(['drush pmu -y jsonapi_defaults'])
    expect(change.notes).toEqual([
      'drupal/jsonapi_extras stays required: jsonapi_extras is enabled, and its files are in that package.',
    ])
    // The requirement stays on the record, and the enabling is undone.
    expect(change.record).toEqual({
      modules: [{ ...given.modules[0], enabled: false }],
      patches: [],
    })
  })

  test('reinstalls a package that stays installed once its patch is gone', async () => {
    const dir = carrying({
      'vendor/composer/installed.json': {
        packages: [
          { name: 'drupal/decoupled_router', version: '2.0.7' },
          {
            name: 'drupal/druxt',
            version: '1.3.1',
            require: { 'drupal/decoupled_router': '^2.0' },
          },
        ],
      },
    })
    const { ask } = answering([ROUTER, MENU])
    const change = await remove(dir, ask)
    expect(runs(change)).toEqual([
      'drush pmu -y decoupled_router jsonapi_menu_items',
      'composer remove --no-update drupal/decoupled_router',
      'composer remove --no-update-with-dependencies drupal/jsonapi_menu_items',
      'composer patches-relock',
      'composer reinstall drupal/decoupled_router',
    ])
  })

  test('keeps every patch of a record that does not say what each was for', async () => {
    const old: BackendRecord = {
      modules: record.modules,
      patches: record.patches.map(({ package: pkg, description, url }) => ({
        package: pkg,
        description,
        url,
      })),
    }
    const { ask } = answering([ROUTER, MENU, 'druxt'], { [MENU]: ['druxt'] })
    const change = await remove(carrying(), ask, old)
    expect(edit(change)).toBeUndefined()
    expect(change.record?.patches).toEqual(old.patches)
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
    const change = await remove(dir, answering([ROUTER, MENU]).ask)
    expect(JSON.parse(edit(change)?.content ?? '{}').extra).toEqual({})
  })

  test('does nothing with no record', async () => {
    const change = await drupal.removeModule(carrying(), {})
    expect(change.steps).toEqual([])
  })
})
