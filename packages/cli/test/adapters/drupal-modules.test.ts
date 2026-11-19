import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
  paths: Record<string, string> = {},
  /** What a simulated uninstall takes to be enabled, when that differs. */
  cached: string[] = enabled,
  /** False when the list of enabled modules cannot be had. */
  lists = true
) {
  const asked: string[] = []
  const ask: Ask = async (tool, args) => {
    asked.push(`${tool} ${args.join(' ')}`)
    if (args[0] === 'pm:list') {
      if (!lists) return { code: 1, output: 'No list.' }
      const list = Object.fromEntries(
        enabled.map((name) => [
          name,
          { name, path: paths[name] ?? `modules/contrib/${name}` },
        ])
      )
      return { code: 0, output: JSON.stringify(list) }
    }
    const name = args.at(-1) as string
    if (!cached.includes(name)) {
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

/** The site each change was planned for, to make an edit's content from. */
const sites = new WeakMap<ModuleChange, string>()
const planned = async (dir: string, change: Promise<ModuleChange>) => {
  sites.set(await change, dir)
  return change
}

const add = (
  dir: string,
  needs: BackendModule[],
  options: Partial<AddRequest> = {}
) =>
  planned(
    dir,
    drupal.addModule(dir, {
      needs,
      patches: true,
      registryStatesCore: true,
      ask: answering().ask,
      ...options,
    })
  )

const runs = (change: ModuleChange) =>
  change.steps.flatMap((step) =>
    'run' in step ? [`${step.run.tool} ${step.run.args.join(' ')}`] : []
  )
/** The edit of a change, with the content it makes of the file as it is. */
const edit = (change: ModuleChange) =>
  change.steps.flatMap((step) => {
    if (!('edit' in step)) return []
    const file = join(sites.get(change) as string, step.edit.file)
    const content = step.edit.change(readFileSync(file, 'utf8'))
    return [{ ...step.edit, content }]
  })[0]
/** What the part says was done, once every step has been taken. */
const settled = (change: ModuleChange) =>
  change.settle?.(
    change.steps.reduce<BackendRecord>(
      (done, step) => ({
        modules: [...done.modules, ...(step.record?.modules ?? [])],
        patches: [...done.patches, ...(step.record?.patches ?? [])],
      }),
      { modules: [], patches: [] }
    )
  )

describe('adding the backend modules a Druxt module needs', () => {
  test('requires a contributed module and enables it', async () => {
    const change = await add(site(), [need('decoupled_router')])
    expect(runs(change)).toEqual([
      'composer require -- drupal/decoupled_router',
      'drush cr',
      'drush en -y -- decoupled_router',
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
    expect(runs(change)).toEqual(['drush en -y -- jsonapi'])
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
      'composer require -- drupal/jsonapi_menu_items:^1.2',
      'drush cr',
      'drush en -y -- menu_items views',
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
    expect(runs(change)).toEqual(['drush en -y -- decoupled_router'])
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
    expect(runs(change)).toEqual([
      'composer require -- drupal/decoupled_router',
      'drush cr',
    ])
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
    expect(await settled(change)).toEqual({
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
    expect((await settled(change))?.modules).toEqual([
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
    expect(runs(change)).toEqual(['drush en -y -- views'])
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
      'composer require -- drupal/decoupled_router',
      'drush cr',
      'drush en -y -- jsonapi decoupled_router',
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
      'drush en -y -- views',
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
    expect(runs(change)).toEqual(['drush en -y -- decoupled_router'])
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
      `composer require -- ${PLUGIN}:^2.0@beta`,
      'composer patches-relock',
      'composer require -- drupal/decoupled_router',
      'drush cr',
      'drush en -y -- decoupled_router',
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
      `composer require -- ${PLUGIN}:^2.0@beta`,
      'composer patches-relock',
      'composer require -- drupal/decoupled_router',
      'composer patches-repatch',
      'drush cr',
      'drush en -y -- decoupled_router',
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
    expect(runs(change)).not.toContain(
      `composer require -- ${PLUGIN}:^2.0@beta`
    )
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
    const dir = site(
      {
        require: { 'drupal/core-recommended': '~11', [PLUGIN]: '^2.0' },
        extra: {
          patches: {
            'drupal/decoupled_router': {
              Theirs: 'https://example.com/mr/12.diff',
            },
          },
        },
      },
      {
        'patches.lock.json': {
          patches: {
            'drupal/decoupled_router': [
              { description: 'Theirs', url: 'https://example.com/mr/12.diff' },
            ],
          },
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
    expect(edit(change)).toBeUndefined()
    expect(change.record?.patches).toEqual([])
    expect(change.notes).toContain(
      'The patch "Fix the redirect loop" is already in composer.json.'
    )
  })

  describe('one that composer.json already lists', () => {
    const ONE = {
      description: 'Fix the redirect loop',
      url: 'https://example.com/mr/12.diff',
    }
    const listing = {
      require: { 'drupal/core-recommended': '~11', [PLUGIN]: '^2.0@beta' },
      extra: {
        patches: { 'drupal/decoupled_router': { [ONE.description]: ONE.url } },
      },
    }
    const LOCKED = {
      'patches.lock.json': {
        patches: { 'drupal/decoupled_router': [{ ...ONE, depth: 1 }] },
      },
    }
    const INSTALLED = (extra: Record<string, unknown> = {}) => ({
      'vendor/composer/installed.json': {
        packages: [
          { name: 'drupal/decoupled_router', version: '2.0.7', ...extra },
        ],
      },
    })
    const again = (dir: string) => add(dir, [patched({ patches: [ONE] })])

    test('is locked and applied when the lock file does not have it', async () => {
      // An earlier run wrote the patch and stopped before it was locked.
      const change = await again(site(listing, INSTALLED()))
      expect(edit(change)).toBeUndefined()
      expect(runs(change)).toEqual([
        'composer patches-relock',
        'composer require -- drupal/decoupled_router',
        'composer patches-repatch',
        'drush cr',
        'drush en -y -- decoupled_router',
      ])
      expect(change.notes).toContain(
        'The patch "Fix the redirect loop" is in composer.json and not in patches.lock.json, so the patches are locked again.'
      )
      expect(change.notes).not.toContain(
        'The patch "Fix the redirect loop" is already in composer.json.'
      )
      // It was written by the run before, whose record has it.
      expect(change.record?.patches).toEqual([])
    })

    test('is locked with an empty lock file as well', async () => {
      const dir = site(listing, { 'patches.lock.json': { patches: [] } })
      expect(runs(await again(dir))).toEqual([
        'composer patches-relock',
        'composer require -- drupal/decoupled_router',
        'drush cr',
        'drush en -y -- decoupled_router',
      ])
    })

    test('gets the plugin first when that is what the earlier run stopped at', async () => {
      const dir = site({
        extra: listing.extra,
        config: { 'allow-plugins': { [PLUGIN]: true } },
      })
      const change = await again(dir)
      expect(edit(change)).toBeUndefined()
      expect(runs(change).slice(0, 2)).toEqual([
        `composer require -- ${PLUGIN}:^2.0@beta`,
        'composer patches-relock',
      ])
      expect(change.record?.patcher).toEqual({ required: true, allowed: false })
    })

    test('has the plugin allowed again when the site no longer allows it', async () => {
      const dir = site({ extra: listing.extra })
      const change = await again(dir)
      expect(edit(change)?.summary).toBe(`Allow ${PLUGIN} in composer.json`)
      const written = JSON.parse(edit(change)?.content ?? '{}')
      expect(written.config['allow-plugins']).toEqual({ [PLUGIN]: true })
      expect(written.extra).toEqual(listing.extra)
    })

    test('is installed again on a package nothing says it was applied to', async () => {
      const dir = site(
        {
          ...listing,
          require: { ...listing.require, 'drupal/decoupled_router': '^2.0' },
        },
        { ...LOCKED, ...INSTALLED() }
      )
      const change = await again(dir)
      expect(runs(change)).toEqual([
        'composer reinstall -- drupal/decoupled_router',
        'drush en -y -- decoupled_router',
      ])
      expect(change.notes).toContain(
        'The patch "Fix the redirect loop" is locked, and nothing on the site says drupal/decoupled_router was installed with it, so the package is installed again.'
      )
    })

    test('is left alone once it is locked and the package says it is applied', async () => {
      const dir = site(listing, {
        ...LOCKED,
        ...INSTALLED({
          extra: { patches_applied: { [ONE.description]: ONE.url } },
        }),
      })
      const change = await again(dir)
      expect(runs(change)).toEqual([
        'composer require -- drupal/decoupled_router',
        'drush cr',
        'drush en -y -- decoupled_router',
      ])
      expect(change.notes).toContain(
        'The patch "Fix the redirect loop" is already in composer.json.'
      )
    })

    test('is left alone once it is locked, for a package still to install', async () => {
      const change = await again(site(listing, LOCKED))
      expect(runs(change)).toEqual([
        'composer require -- drupal/decoupled_router',
        'drush cr',
        'drush en -y -- decoupled_router',
      ])
    })
  })

  describe('the plugin that applies them', () => {
    test('is recorded as added, with its permission, on a site without it', async () => {
      const change = await add(site(), [patched()])
      expect(change.record?.patcher).toEqual({ required: true, allowed: true })
      // Each step says its own part, for a run that stops between them.
      expect(change.steps.map((step) => step.record?.patcher)).toEqual([
        { required: false, allowed: true },
        { required: true, allowed: false },
        undefined,
        undefined,
        undefined,
        undefined,
      ])
    })

    test('is recorded without the permission where every plugin is allowed', async () => {
      const dir = site({ config: { 'allow-plugins': true } })
      const change = await add(dir, [patched()])
      expect(change.record?.patcher).toEqual({ required: true, allowed: false })
    })

    test('is not recorded on a site that had it', async () => {
      const dir = site({
        require: { 'drupal/core-recommended': '~11', [PLUGIN]: '^2.0' },
      })
      const change = await add(dir, [patched()])
      expect(change.record).not.toHaveProperty('patcher')
      expect(change.steps.some((step) => step.record?.patcher)).toBe(false)
    })
  })

  test('are left out, with a warning, when patches are turned off', async () => {
    const change = await add(site(), [patched()], { patches: false })
    expect(edit(change)).toBeUndefined()
    expect(runs(change)).toEqual([
      'composer require -- drupal/decoupled_router',
      'drush cr',
      'drush en -y -- decoupled_router',
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
      'composer require -- drupal/jsonapi_menu_items drupal/menu_link_content',
      'drush cr',
      'drush en -y -- jsonapi_menu_items menu_link_content',
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
    expect(runs(change)).toEqual(['drush en -y -- block'])
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
    planned(dir, drupal.removeModule(dir, { record: given, ask }))

  test('uninstalls and removes what the record says was added', async () => {
    const { ask, asked } = answering([ROUTER, MENU])
    const change = await remove(carrying(), ask)
    // Each module is asked about twice: the list is asked for once.
    expect(asked).toEqual([
      'drush pm:uninstall --simulate -- decoupled_router',
      'drush pm:list --type=module --status=enabled --fields=name,path --format=json',
      'drush pm:uninstall --simulate -- jsonapi_menu_items',
    ])
    expect(runs(change)).toEqual([
      'drush pmu -y -- decoupled_router jsonapi_menu_items',
      'composer remove --no-update-with-dependencies -- drupal/decoupled_router drupal/jsonapi_menu_items',
      'composer patches-relock',
      'drush cr',
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
      'drush pmu -y -- jsonapi_menu_items',
      'composer remove --no-update-with-dependencies -- drupal/jsonapi_menu_items',
      'drush cr',
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
      'drush pmu -y -- decoupled_router jsonapi_menu_items'
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
    expect(runs(change)[0]).toBe('drush pmu -y -- jsonapi_menu_items')
    expect(change.notes).toContain(
      'decoupled_router is not enabled, so it is not uninstalled.'
    )
    expect(runs(change)[1]).toBe(
      'composer remove --no-update-with-dependencies -- drupal/decoupled_router drupal/jsonapi_menu_items'
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
        'composer remove --no-update -- drupal/jsonapi_views',
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
        'composer remove --no-update-with-dependencies -- drupal/jsonapi_views',
        'drush cr',
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
    expect(runs(change)).toEqual(['drush pmu -y -- jsonapi_defaults'])
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
      'drush pmu -y -- decoupled_router jsonapi_menu_items',
      'composer remove --no-update -- drupal/decoupled_router',
      'composer remove --no-update-with-dependencies -- drupal/jsonapi_menu_items',
      'composer patches-relock',
      'composer reinstall -- drupal/decoupled_router',
      'drush cr',
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
    // With the key gone `extra` is empty, and goes as well.
    expect(JSON.parse(edit(change)?.content ?? '{}').extra).toBeUndefined()
  })

  test('keeps what else the site has under extra', async () => {
    const dir = site({
      extra: {
        'drupal-scaffold': { locations: { 'web-root': 'web/' } },
        patches: {
          'drupal/decoupled_router': {
            'Fix the redirect loop': 'https://example.com/mr/12.diff',
          },
        },
      },
    })
    const change = await remove(dir, answering([ROUTER, MENU]).ask)
    expect(JSON.parse(edit(change)?.content ?? '{}').extra).toEqual({
      'drupal-scaffold': { locations: { 'web-root': 'web/' } },
    })
  })

  describe('a site whose two answers about a module differ', () => {
    const LEFT =
      'Rebuild its caches with drush cr and run this again, or once nothing depends on it: drush pm:uninstall decoupled_router, then composer remove drupal/decoupled_router'

    test('keeps a module the list has enabled and a simulated uninstall does not', async () => {
      // A cached container from before the module was enabled.
      const { ask } = answering([ROUTER, MENU], {}, {}, [MENU])
      const change = await remove(carrying(), ask)
      expect(runs(change)).toEqual([
        'drush pmu -y -- jsonapi_menu_items',
        'composer remove --no-update-with-dependencies -- drupal/jsonapi_menu_items',
        'drush cr',
      ])
      expect(change.notes).toEqual([])
      expect(change.manual).toEqual([
        `The backend gave two answers about whether decoupled_router is enabled, so it was left as it is. ${LEFT}`,
      ])
      expect(edit(change)).toBeUndefined()
      // Nothing about it is rewritten: it is still one the add enabled.
      expect(change.record).toEqual({
        modules: [record.modules[0]],
        patches: record.patches,
      })
    })

    test('keeps a module a simulated uninstall has enabled and the list does not', async () => {
      const { ask } = answering([MENU], {}, {}, [ROUTER, MENU])
      const change = await remove(carrying(), ask)
      expect(runs(change)[0]).toBe('drush pmu -y -- jsonapi_menu_items')
      expect(change.manual).toEqual([
        `The backend gave two answers about whether decoupled_router is enabled, so it was left as it is. ${LEFT}`,
      ])
      expect(change.record?.modules).toEqual([record.modules[0]])
    })

    test('keeps every module when the list cannot be had', async () => {
      const { ask } = answering([ROUTER, MENU], {}, {}, [MENU], false)
      const change = await remove(carrying(), ask)
      expect(change.steps).toEqual([])
      expect(change.manual[0]).toBe(
        `The backend could not say whether decoupled_router is enabled, so it was left as it is. ${LEFT}`
      )
      expect(change.record).toEqual(record)
    })

    test('keeps the requirement of a module the site had enabled', async () => {
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
      // The list says it is off now, and a simulated uninstall that it is on.
      const { ask } = answering([], {}, {}, ['jsonapi_views'])
      const change = await remove(site(), ask, only)
      expect(change.steps).toEqual([])
      expect(change.record).toEqual(only)
    })
  })

  describe('the plugin that applies patches', () => {
    const added: BackendRecord = {
      ...record,
      patcher: { required: true, allowed: true },
    }
    const patchedSite = (
      extra: Record<string, unknown> = {},
      files: Record<string, unknown> = {}
    ) =>
      site(
        {
          require: {
            'drupal/core-recommended': '~11',
            [PLUGIN]: '^2.0@beta',
            'drupal/decoupled_router': '^2.0',
          },
          config: {
            'sort-packages': true,
            'allow-plugins': { 'composer/installers': true, [PLUGIN]: true },
          },
          extra: {
            patches: {
              'drupal/decoupled_router': {
                'Fix the redirect loop': 'https://example.com/mr/12.diff',
              },
            },
          },
          ...extra,
        },
        files
      )
    /** Each edit of a change, made of what the edit before it wrote. */
    const edited = (change: ModuleChange) => {
      const file = join(sites.get(change) as string, 'composer.json')
      let source = readFileSync(file, 'utf8')
      return change.steps.flatMap((step) => {
        if (!('edit' in step)) return []
        source = step.edit.change(source)
        return [{ summary: step.edit.summary, json: JSON.parse(source) }]
      })
    }

    test('goes with the last patch when the record says the add put it there', async () => {
      const change = await remove(
        patchedSite(),
        answering([ROUTER, MENU]).ask,
        added
      )
      expect(runs(change)).toEqual([
        'drush pmu -y -- decoupled_router jsonapi_menu_items',
        'composer remove --no-update-with-dependencies -- drupal/decoupled_router drupal/jsonapi_menu_items',
        'composer patches-relock',
        `composer remove -- ${PLUGIN}`,
        'drush cr',
      ])
      // The permission goes once the plugin has, or Composer would stop it.
      const kinds = change.steps.map((step) => Object.keys(step)[0])
      expect(kinds).toEqual([
        'run',
        'edit',
        'run',
        'run',
        'run',
        'edit',
        'remove',
        'run',
      ])
      const [patches, permission] = edited(change)
      expect(patches?.summary).toBe('Remove 1 patch from composer.json')
      expect(patches?.json.config['allow-plugins'][PLUGIN]).toBe(true)
      expect(permission?.summary).toBe(
        `Remove ${PLUGIN} from allow-plugins in composer.json`
      )
      expect(permission?.json.config).toEqual({
        'sort-packages': true,
        'allow-plugins': { 'composer/installers': true },
      })
      expect(change.record).toBeUndefined()
    })

    test('takes its lock file with it once that holds no patch', async () => {
      const change = await remove(
        patchedSite(),
        answering([ROUTER, MENU]).ask,
        added
      )
      const removal = change.steps.flatMap((step) =>
        'remove' in step ? [step.remove] : []
      )[0]
      expect(removal?.file).toBe('patches.lock.json')
      expect(removal?.summary).toBe('Delete patches.lock.json')
      expect(removal?.when('{"_hash": "x", "patches": []}')).toBe(true)
      expect(removal?.when('{"patches": {}}')).toBe(true)
      expect(removal?.when('{"patches": {"a/b": [{"url": "x"}]}}')).toBe(false)
      expect(removal?.when('not json')).toBe(false)
    })

    test('takes an allow-plugins it leaves empty, and a config that leaves empty', async () => {
      const dir = patchedSite({
        config: { 'allow-plugins': { [PLUGIN]: true } },
      })
      const change = await remove(dir, answering([ROUTER, MENU]).ask, added)
      expect(edited(change)[1]?.json.config).toBeUndefined()
    })

    test('stays while composer.json has another patch, and stays on the record', async () => {
      const dir = patchedSite({
        extra: {
          patches: {
            'drupal/decoupled_router': {
              'Fix the redirect loop': 'https://example.com/mr/12.diff',
            },
            'drupal/druxt': { 'Their own': 'patches/own.patch' },
          },
        },
      })
      const change = await remove(dir, answering([ROUTER, MENU]).ask, added)
      expect(runs(change).join('\n')).not.toContain(PLUGIN)
      expect(edited(change)).toHaveLength(1)
      expect(change.record).toEqual({
        modules: [],
        patches: [],
        patcher: added.patcher,
      })
    })

    test('stays when the record does not say the add put it there', async () => {
      const change = await remove(patchedSite(), answering([ROUTER, MENU]).ask)
      expect(runs(change).join('\n')).not.toContain(PLUGIN)
      expect(edited(change)).toHaveLength(1)
      expect(change.steps.some((step) => 'remove' in step)).toBe(false)
    })

    test('keeps a permission the site had, and takes only the requirement', async () => {
      const change = await remove(
        patchedSite(),
        answering([ROUTER, MENU]).ask,
        {
          ...record,
          patcher: { required: true, allowed: false },
        }
      )
      expect(runs(change)).toContain(`composer remove -- ${PLUGIN}`)
      expect(edited(change)).toHaveLength(1)
    })

    test('keeps a requirement the site had, and takes only the permission', async () => {
      const change = await remove(
        patchedSite(),
        answering([ROUTER, MENU]).ask,
        {
          ...record,
          patcher: { required: false, allowed: true },
        }
      )
      expect(runs(change).join('\n')).not.toContain(`-- ${PLUGIN}`)
      expect(edited(change)[1]?.json.config['allow-plugins']).toEqual({
        'composer/installers': true,
      })
      expect(change.steps.some((step) => 'remove' in step)).toBe(false)
    })

    test('comes out of composer.json alone while another package requires it', async () => {
      const dir = patchedSite(
        {},
        {
          'vendor/composer/installed.json': {
            packages: [
              { name: PLUGIN, version: '2.0.0' },
              {
                name: 'acme/tools',
                version: '1.0.0',
                require: { [PLUGIN]: '^2' },
              },
            ],
          },
        }
      )
      const change = await remove(dir, answering([ROUTER, MENU]).ask, added)
      // Composer's remove fails on a package that is still installed.
      expect(runs(change)).toEqual([
        'drush pmu -y -- decoupled_router jsonapi_menu_items',
        `composer remove --no-update -- ${PLUGIN}`,
        'composer remove --no-update-with-dependencies -- drupal/decoupled_router drupal/jsonapi_menu_items',
        'composer patches-relock',
        'drush cr',
      ])
      // The plugin is still installed, and so its lock file stays.
      expect(change.steps.some((step) => 'remove' in step)).toBe(false)
    })

    test('stays with a module that stays, whose patch it applies', async () => {
      const { ask } = answering([ROUTER, MENU, 'druxt'], {
        [ROUTER]: ['druxt'],
      })
      const change = await remove(patchedSite(), ask, added)
      expect(runs(change).join('\n')).not.toContain(PLUGIN)
      expect(change.record?.patcher).toEqual(added.patcher)
    })
  })

  test('rebuilds the caches after Composer has changed what is installed', async () => {
    const change = await remove(carrying(), answering([ROUTER, MENU]).ask)
    expect(runs(change).at(-1)).toBe('drush cr')
    // Nothing installed changes when only the manifest does.
    const kept = await remove(
      carrying(),
      answering([ROUTER, MENU, 'druxt'], {
        [ROUTER]: ['druxt'],
        [MENU]: ['druxt'],
      }).ask
    )
    expect(runs(kept)).toEqual([])
  })

  test('does nothing with no record', async () => {
    const change = await drupal.removeModule(carrying(), {})
    expect(change.steps).toEqual([])
  })
})
