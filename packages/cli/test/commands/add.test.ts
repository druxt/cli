import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { CliContext } from '../../src/context.js'
import type { ToolResult } from '../../src/exec.js'
import { answering } from '../helpers/prompter.js'
import { run } from '../helpers/run.js'
import { serve, type TestServer } from '../helpers/server.js'
import { cleanTmp, tmp, writeTree } from '../helpers/tmp.js'

const NUXT_CONFIG = readFileSync(
  fileURLToPath(
    new URL('../fixtures/quickstart-nuxt.config.js', import.meta.url)
  ),
  'utf8'
)
const PATCH = {
  description: 'Fix the redirect loop',
  url: 'https://example.com/mr/12.diff',
  issue: 'https://example.com/issue/12',
}

const entry = (name: string, extra: Record<string, unknown>) => ({
  name,
  repo: `druxt/${name}`,
  category: 'site-and-layout',
  status: 'stable',
  type: 'official',
  archived: false,
  description: `The ${name} module`,
  npm: `druxt-${name}`,
  compatibility: { druxt: '^0.25.0' },
  drupal: [],
  ...extra,
})

/** A registry with the fields the published one does not have yet. */
const REGISTRY = {
  schemaVersion: 1,
  modules: [
    entry('auth', {
      compatibility: { druxt: 'unknown' },
      drupal: [
        {
          name: 'simple_oauth',
          label: 'Simple OAuth',
          setup: [
            {
              title: 'Generate the keys',
              command: 'drush simple-oauth:generate-keys ../keys',
            },
          ],
        },
      ],
    }),
    entry('blocks', {
      drupal: [{ name: 'block', label: 'Block', core: true }],
    }),
    entry('breadcrumb', {
      drupal: [
        {
          name: 'decoupled_router',
          label: 'Decoupled Router',
          patches: [PATCH],
        },
      ],
    }),
    entry('ckeditor', { npm: undefined, status: 'unreleased' }),
    entry('legacy', { archived: true }),
    entry('node-preview', { compatibility: { druxt: '>=0.26.0 <1' } }),
    entry('router', {
      drupal: [{ name: 'decoupled_router', label: 'Decoupled Router' }],
    }),
  ],
}

let server: TestServer
let url: string

beforeEach(async () => {
  server = await serve({ '/modules.json': JSON.stringify(REGISTRY) })
  url = `${server.url}/modules.json`
})

afterEach(async () => {
  await server.close()
  cleanTmp()
})

/** A project like one `drx init` makes from the quickstart. */
function project(
  backend: Record<string, unknown> = { engine: 'ddev' },
  files: Record<string, unknown> = {}
): string {
  const root = tmp('drx-project-')
  writeTree(root, {
    'drx.config.json': {
      layout: 'monorepo',
      line: '0.x',
      starter: 'quickstart',
      source: 'npm',
      parts: [
        { role: 'frontend', kind: 'nuxt', path: 'nuxt' },
        { role: 'backend', kind: 'drupal', path: 'drupal', ...backend },
      ],
    },
    'nuxt/package.json': {
      dependencies: { nuxt: '2.15.8', 'druxt-site': '^0.15.1' },
    },
    'nuxt/package-lock.json': '{}',
    'nuxt/nuxt.config.js': NUXT_CONFIG,
    'nuxt/node_modules/druxt/package.json': { version: '0.25.2' },
    'drupal/composer.json':
      JSON.stringify(
        { require: { 'drupal/core-recommended': '~11' } },
        null,
        4
      ) + '\n',
    ...files,
  })
  return root
}

/** Every file under a directory with a hash of its content. */
function snapshot(root: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((file) => file.isFile())
      .map((file) => join(file.parentPath, file.name))
      .sort()
      .map((file) => [
        relative(root, file),
        createHash('sha256').update(readFileSync(file)).digest('hex'),
      ])
  )
}

/**
 * A stand-in for the tools: it records each command line, and an install of
 * a frontend package writes the dependency as the package manager would.
 */
function tools(root: string, fail?: { on: string; output: string }) {
  const calls: string[] = []
  const exec: CliContext['exec'] = async (command, args, { cwd }) => {
    const line = `${relative(root, cwd)}$ ${command} ${args.join(' ')}`
    calls.push(line)
    if (fail && line.includes(fail.on)) return { code: 1, output: fail.output }
    if (command === 'npm') {
      const file = join(cwd, 'package.json')
      const manifest = JSON.parse(readFileSync(file, 'utf8'))
      if (args[0] === 'install')
        manifest.dependencies[args[1] as string] = '^1.0.0'
      else delete manifest.dependencies[args[1] as string]
      writeFileSync(file, JSON.stringify(manifest))
    }
    return { code: 0, output: '' } satisfies ToolResult
  }
  return { calls, exec }
}

const never: CliContext['exec'] = async (command, args) => {
  throw new Error(`A command was run: ${command} ${args.join(' ')}`)
}

const drx = (
  argv: string[],
  cwd: string,
  overrides: Partial<CliContext> = {}
) => run(argv, { cwd, defaultModuleRegistry: url, exec: never, ...overrides })

const config = (root: string) =>
  JSON.parse(readFileSync(join(root, 'drx.config.json'), 'utf8'))

const DRY_RUN = [
  'Add breadcrumb (druxt-breadcrumb)',
  '  nuxt/',
  '    run   npm install druxt-breadcrumb',
  "    edit  Add 'druxt-breadcrumb' to modules in nuxt.config.js",
  '  drupal/',
  '    edit  Add 1 patch to composer.json',
  '    run   ddev composer require cweagans/composer-patches:^2.0@beta',
  '    run   ddev composer patches-relock',
  '    run   ddev composer require drupal/decoupled_router',
  '    run   ddev drush en -y decoupled_router',
  '',
  'Nothing was changed: this was a dry run.',
  '',
].join('\n')

describe('drx add --dry-run', () => {
  test('prints every step and each command line', async () => {
    const root = project()
    const result = await drx(['add', 'breadcrumb', '--dry-run'], root)
    expect(result.code).toBe(0)
    expect(result.stdout).toBe(DRY_RUN)
    expect(result.stderr).toContain(
      'Patch for drupal/decoupled_router: Fix the redirect loop (https://example.com/issue/12)'
    )
  })

  test('changes nothing and runs nothing', async () => {
    const root = project()
    const before = snapshot(root)
    // `never` throws on any command, and the snapshot would show any write.
    const result = await drx(['add', 'breadcrumb', 'auth', '--dry-run'], root)
    expect(result.code).toBe(0)
    expect(result.stderr).not.toContain('A command was run')
    expect(snapshot(root)).toEqual(before)
  })

  test('is the same through drx module add, and by package name', async () => {
    const root = project()
    for (const argv of [
      ['module', 'add', 'breadcrumb', '--dry-run'],
      ['add', 'druxt-breadcrumb', '--dry-run'],
    ]) {
      expect((await drx(argv, root)).stdout).toBe(DRY_RUN)
    }
  })

  test('--json lists the steps as data', async () => {
    const root = project()
    const result = await drx(['add', 'blocks', '--dry-run', '--json'], root)
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      dryRun: true,
      modules: [
        {
          name: 'blocks',
          package: 'druxt-blocks',
          steps: [
            { part: 'nuxt', run: 'npm install druxt-blocks' },
            {
              part: 'nuxt',
              edit: "Add 'druxt-blocks' to modules in nuxt.config.js",
            },
            { part: 'drupal', run: 'ddev drush en -y block' },
          ],
        },
      ],
    })
  })
})

describe('drx add', () => {
  test('installs the package, lists it in the config, and sets up the backend', async () => {
    const root = project()
    const { calls, exec } = tools(root)
    const result = await drx(['add', 'breadcrumb'], root, { exec })

    expect(result.code).toBe(0)
    expect(calls).toEqual([
      'nuxt$ npm install druxt-breadcrumb',
      'drupal$ ddev composer require cweagans/composer-patches:^2.0@beta',
      'drupal$ ddev composer patches-relock',
      'drupal$ ddev composer require drupal/decoupled_router',
      'drupal$ ddev drush en -y decoupled_router',
    ])
    expect(readFileSync(join(root, 'nuxt/nuxt.config.js'), 'utf8')).toContain(
      "    localhostListenURL,\n    'druxt-breadcrumb'\n  ],"
    )
    const composer = JSON.parse(
      readFileSync(join(root, 'drupal/composer.json'), 'utf8')
    )
    expect(composer.extra.patches).toEqual({
      'drupal/decoupled_router': { [PATCH.description]: PATCH.url },
    })
    expect(result.stdout).toBe('Added breadcrumb.\n')
  })

  test('records what it did in drx.config.json', async () => {
    const root = project()
    await drx(['add', 'breadcrumb'], root, { exec: tools(root).exec })
    expect(config(root).modules).toEqual([
      {
        name: 'breadcrumb',
        package: 'druxt-breadcrumb',
        backend: [
          {
            path: 'drupal',
            modules: [
              { name: 'decoupled_router', package: 'drupal/decoupled_router' },
            ],
            patches: [
              {
                package: 'drupal/decoupled_router',
                description: PATCH.description,
                url: PATCH.url,
              },
            ],
          },
        ],
      },
    ])
  })

  test('runs the backend tools as the engine of the part does', async () => {
    const root = project({ engine: 'php' })
    const { calls, exec } = tools(root)
    await drx(['add', 'blocks'], root, { exec })
    expect(calls).toEqual([
      'nuxt$ npm install druxt-blocks',
      'drupal$ vendor/bin/drush en -y block',
    ])
  })

  test('adds several modules, one after the other', async () => {
    const root = project()
    const { calls, exec } = tools(root)
    const result = await drx(['add', 'blocks', 'router'], root, { exec })
    expect(result.stdout).toBe('Added blocks.\nAdded router.\n')
    expect(calls.filter((line) => line.startsWith('nuxt$'))).toEqual([
      'nuxt$ npm install druxt-blocks',
      'nuxt$ npm install druxt-router',
    ])
    expect(config(root).modules.map((m: { name: string }) => m.name)).toEqual([
      'blocks',
      'router',
    ])
  })

  test('prints what is left to do, and does not run it', async () => {
    const root = project()
    const { calls, exec } = tools(root)
    const result = await drx(['add', 'auth'], root, { exec })
    expect(result.stdout).toBe(
      [
        'Added auth.',
        '',
        'Left to do:',
        '  Simple OAuth: Generate the keys',
        '    drush simple-oauth:generate-keys ../keys',
        '',
      ].join('\n')
    )
    expect(calls.join('\n')).not.toContain('generate-keys')
    // The config lists druxt-auth already, with its options.
    expect(result.stderr).toContain(
      'druxt-auth is already in modules in nuxt.config.js.'
    )
  })

  test('--no-patches leaves the patches out and warns', async () => {
    const root = project()
    const { calls, exec } = tools(root)
    const result = await drx(['add', 'breadcrumb', '--no-patches'], root, {
      exec,
    })
    expect(result.code).toBe(0)
    expect(calls).not.toContain('drupal$ ddev composer patches-relock')
    expect(result.stderr).toContain(
      'Warning: The patch "Fix the redirect loop" for drupal/decoupled_router was not applied. Decoupled Router may not work without it.'
    )
    expect(
      readFileSync(join(root, 'drupal/composer.json'), 'utf8')
    ).not.toContain('patches')
  })

  test('prints the line to add when the config cannot be edited safely', async () => {
    const root = project(
      { engine: 'ddev' },
      {
        'nuxt/nuxt.config.js': 'export default () => ({ modules: [] })\n',
      }
    )
    const result = await drx(['add', 'blocks'], root, {
      exec: tools(root).exec,
    })
    expect(result.code).toBe(0)
    expect(result.stdout).toContain(
      [
        'Left to do:',
        "  Add 'druxt-blocks' to the modules array in nuxt.config.js. It could not be edited safely.",
      ].join('\n')
    )
  })
})

describe('drx add when the backend is not run from here', () => {
  test('with the none engine does the frontend and prints the rest', async () => {
    const root = project({ engine: 'none', baseUrl: 'https://example.com' })
    const { calls, exec } = tools(root)
    const result = await drx(['add', 'breadcrumb'], root, { exec })
    expect(result.code).toBe(0)
    expect(calls).toEqual(['nuxt$ npm install druxt-breadcrumb'])
    expect(result.stdout).toBe(
      [
        'Added breadcrumb.',
        '',
        'Left to do:',
        '  The backend of this project is not on this machine. Where it is:',
        '    Patch drupal/decoupled_router with https://example.com/mr/12.diff (Fix the redirect loop)',
        '    composer require cweagans/composer-patches:^2.0@beta',
        '    composer patches-relock',
        '    composer require drupal/decoupled_router',
        '    drush en -y decoupled_router',
        '',
      ].join('\n')
    )
    expect(config(root).modules[0].backend).toEqual([])
    expect(
      readFileSync(join(root, 'drupal/composer.json'), 'utf8')
    ).not.toContain('patches')
  })

  test('says so when the project does not record an engine', async () => {
    const root = project({})
    const { calls, exec } = tools(root)
    const result = await drx(['add', 'blocks'], root, { exec })
    expect(calls).toEqual(['nuxt$ npm install druxt-blocks'])
    expect(result.stdout).toContain(
      '  This project does not record how drupal/ is run. In it:\n    drush en -y block'
    )
  })
})

describe('what drx add refuses', () => {
  test.each([
    ['legacy', 'legacy is archived.', true],
    [
      'node-preview',
      'node-preview works with druxt >=0.26.0 <1, and nuxt/ has druxt 0.25.2.',
      true,
    ],
    [
      'ckeditor',
      'ckeditor has no package to install: it is not released.',
      false,
    ],
  ])(
    '%s, and --force goes ahead only where it can',
    async (name, reason, forceable) => {
      const root = project()
      const before = snapshot(root)
      const refused = await drx(['add', name], root)
      expect(refused.code).toBe(1)
      expect(refused.stderr).toContain(`Cannot add ${name}: ${reason}`)
      expect(
        refused.stderr.includes('Pass --force to add it all the same.')
      ).toBe(forceable)
      expect(snapshot(root)).toEqual(before)

      const forced = await drx(['add', name, '--force'], root, {
        exec: tools(root).exec,
      })
      expect(forced.code).toBe(forceable ? 0 : 1)
      if (forceable) expect(forced.stderr).toContain(`Warning: ${reason}`)
    }
  )

  test('warns, and goes ahead, when the compatibility is unknown', async () => {
    const root = project()
    const result = await drx(['add', 'auth'], root, { exec: tools(root).exec })
    expect(result.code).toBe(0)
    expect(result.stderr).toContain(
      'Warning: auth does not say which druxt it works with, so it may not work with the one in nuxt/.'
    )
  })

  test('adds nothing when one of several is refused', async () => {
    const root = project()
    const before = snapshot(root)
    const result = await drx(['add', 'blocks', 'legacy'], root)
    expect(result.code).toBe(1)
    expect(snapshot(root)).toEqual(before)
  })

  test('a name the registry does not have, with the closest', async () => {
    const result = await drx(['add', 'blok'], project())
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'There is no module named "blok". Closest: blocks.'
    )
  })

  test('running outside a project', async () => {
    const cwd = tmp()
    const result = await drx(['add', 'blocks'], cwd)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      `drx add works inside a project, and there is no drx.config.json in ${cwd} or above it.`
    )
  })

  test('no name, with nobody to ask', async () => {
    const result = await drx(['add'], project())
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'Give the name of a module, as in "drx add blocks".'
    )
  })
})

describe('drx add when a tool fails', () => {
  test('stops, shows the output, and says what was and was not done', async () => {
    const root = project()
    const { calls, exec } = tools(root, {
      on: 'composer require drupal/decoupled_router',
      output: 'Your requirements could not be resolved.',
    })
    const result = await drx(['add', 'breadcrumb'], root, { exec })

    expect(result.code).toBe(1)
    expect(calls.at(-1)).toBe(
      'drupal$ ddev composer require drupal/decoupled_router'
    )
    expect(result.stderr).toContain(
      [
        'Error: ddev composer require drupal/decoupled_router failed in drupal/ with exit code 1.',
        'Your requirements could not be resolved.',
        'Done:',
        '  nuxt/: npm install druxt-breadcrumb',
        "  nuxt/: Add 'druxt-breadcrumb' to modules in nuxt.config.js",
        '  drupal/: Add 1 patch to composer.json',
        '  drupal/: ddev composer require cweagans/composer-patches:^2.0@beta',
        '  drupal/: ddev composer patches-relock',
        'Not done:',
        '  drupal/: ddev composer require drupal/decoupled_router',
        '  drupal/: ddev drush en -y decoupled_router',
      ].join('\n')
    )
    expect(config(root).modules).toBeUndefined()
  })
})

describe('telling core from contributed with the published registry', () => {
  // The registry as it is published today: no module is marked as core.
  const published = () => {
    const modules = [
      entry('menu', {
        drupal: [
          { name: 'jsonapi_menu_items', label: 'JSON:API Menu Items' },
          { name: 'menu_link_content', label: 'Custom Menu Links' },
        ],
      }),
    ]
    server.files['/modules.json'] = JSON.stringify({
      schemaVersion: 1,
      modules,
    })
  }

  test('refuses before any step when core is not installed to look in', async () => {
    published()
    const root = project()
    const before = snapshot(root)
    const result = await drx(['add', 'menu'], root)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'Cannot add menu: Cannot tell whether jsonapi_menu_items is part of core or a package to require'
    )
    expect(snapshot(root)).toEqual(before)
  })

  test('looks in the installed core, enables what is there and requires the rest', async () => {
    published()
    const root = project(
      { engine: 'ddev' },
      {
        'drupal/web/core/modules/menu_link_content/menu_link_content.info.yml':
          '',
      }
    )
    const { calls, exec } = tools(root)
    const result = await drx(['add', 'menu'], root, { exec })
    expect(result.code).toBe(0)
    expect(calls.slice(1)).toEqual([
      'drupal$ ddev composer require drupal/jsonapi_menu_items',
      'drupal$ ddev drush en -y jsonapi_menu_items menu_link_content',
    ])
  })
})

describe('drx add in a terminal with no name', () => {
  const answers = {
    'Which modules?': ['breadcrumb', 'blocks'],
    'Make these changes?': true,
  }
  const picking = (
    root: string,
    given: Record<string, unknown>,
    exec = tools(root).exec
  ) => {
    const { prompter, asked } = answering(given)
    return run(
      ['add'],
      {
        cwd: root,
        env: { XDG_CONFIG_HOME: tmp(), NO_COLOR: '1' },
        defaultModuleRegistry: url,
        exec,
        prompter,
      },
      { columns: 100 }
    ).then((result) => ({ ...result, asked }))
  }

  test('offers the modules that can be added, then a summary and a confirm', async () => {
    const root = project()
    const result = await picking(root, answers)
    expect(result.code).toBe(0)
    expect(result.asked.map(({ message }) => message)).toEqual([
      'Which modules?',
      'Make these changes?',
    ])
    expect(result.asked[0]?.choices?.map(({ value }) => value)).toEqual([
      'auth',
      'blocks',
      'breadcrumb',
      'node-preview',
      'router',
    ])
    expect(result.stderr).toContain('Add breadcrumb (druxt-breadcrumb)')
    expect(result.stderr).toContain('    run   ddev drush en -y block')
    expect(result.stdout).toBe('Added breadcrumb.\nAdded blocks.\n')
  })

  test('ends with the command that repeats it', async () => {
    const result = await picking(project(), answers)
    expect(result.stderr.trimEnd().split('\n').at(-1)).toBe(
      'Repeat this with: drx add breadcrumb blocks --yes'
    )
  })

  test('changes nothing when the answer is no', async () => {
    const root = project()
    const before = snapshot(root)
    const result = await picking(
      root,
      { ...answers, 'Make these changes?': false },
      never
    )
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Error: Cancelled. Nothing was changed.')
    expect(snapshot(root)).toEqual(before)
  })
})

describe('drx remove', () => {
  /** A project with breadcrumb added by `drx add`. */
  async function added(names = ['breadcrumb']) {
    const root = project()
    const result = await drx(['add', ...names], root, {
      exec: tools(root).exec,
    })
    expect(result.code).toBe(0)
    return root
  }

  test('takes the module out of the config and uninstalls the package', async () => {
    const root = await added()
    const { calls, exec } = tools(root)
    const result = await drx(['remove', 'breadcrumb'], root, { exec })
    expect(result.code).toBe(0)
    expect(calls).toEqual(['nuxt$ npm uninstall druxt-breadcrumb'])
    expect(readFileSync(join(root, 'nuxt/nuxt.config.js'), 'utf8')).toBe(
      NUXT_CONFIG
    )
    expect(result.stdout).toBe(
      [
        'Removed breadcrumb.',
        '',
        'Left to do:',
        '  The backend was left as it is. drx remove breadcrumb --backend takes out what drx add put in drupal/: decoupled_router, 1 patch.',
        '',
      ].join('\n')
    )
    // The record stays, so the backend can still be undone.
    expect(config(root).modules).toHaveLength(1)
  })

  test('--backend undoes what the record says drx add did, and drops the record', async () => {
    const root = await added()
    const { calls, exec } = tools(root)
    const result = await drx(['remove', 'breadcrumb', '--backend'], root, {
      exec,
    })
    expect(result.code).toBe(0)
    expect(calls).toEqual([
      'nuxt$ npm uninstall druxt-breadcrumb',
      'drupal$ ddev drush pmu -y decoupled_router',
      'drupal$ ddev composer remove drupal/decoupled_router',
      'drupal$ ddev composer patches-relock',
    ])
    const composer = JSON.parse(
      readFileSync(join(root, 'drupal/composer.json'), 'utf8')
    )
    expect(composer.extra.patches).toBeUndefined()
    expect(config(root).modules).toBeUndefined()
    expect(result.stdout).toBe('Removed breadcrumb.\n')
  })

  test('--backend keeps a backend module another installed module needs', async () => {
    // router needs decoupled_router too, and is installed without drx add.
    const root = await added()
    const file = join(root, 'nuxt/package.json')
    const manifest = JSON.parse(readFileSync(file, 'utf8'))
    manifest.dependencies['druxt-router'] = '^0.25.0'
    writeFileSync(file, JSON.stringify(manifest))

    const { calls, exec } = tools(root)
    const result = await drx(['remove', 'breadcrumb', '--backend'], root, {
      exec,
    })
    expect(calls).toEqual(['nuxt$ npm uninstall druxt-breadcrumb'])
    expect(result.stderr).toContain(
      'decoupled_router stays: another installed module needs it.'
    )
  })

  test('touches no backend module that drx add did not put there', async () => {
    const root = project()
    const file = join(root, 'nuxt/package.json')
    const manifest = JSON.parse(readFileSync(file, 'utf8'))
    manifest.dependencies['druxt-blocks'] = '^0.25.0'
    writeFileSync(file, JSON.stringify(manifest))

    const { calls, exec } = tools(root)
    const result = await drx(
      ['module', 'remove', 'blocks', '--backend'],
      root,
      { exec }
    )
    expect(result.code).toBe(0)
    expect(calls).toEqual(['nuxt$ npm uninstall druxt-blocks'])
  })

  test('--dry-run prints the steps and changes nothing', async () => {
    const root = await added()
    const before = snapshot(root)
    const result = await drx(
      ['remove', 'breadcrumb', '--backend', '--dry-run'],
      root
    )
    expect(result.code).toBe(0)
    expect(result.stdout).toBe(
      [
        'Remove breadcrumb (druxt-breadcrumb)',
        '  nuxt/',
        '    run   npm uninstall druxt-breadcrumb',
        "    edit  Remove 'druxt-breadcrumb' from modules in nuxt.config.js",
        '  drupal/',
        '    run   ddev drush pmu -y decoupled_router',
        '    edit  Remove 1 patch from composer.json',
        '    run   ddev composer remove drupal/decoupled_router',
        '    run   ddev composer patches-relock',
        '',
        'Nothing was changed: this was a dry run.',
        '',
      ].join('\n')
    )
    expect(snapshot(root)).toEqual(before)
  })

  test('fails on a module the project does not have', async () => {
    const result = await drx(['remove', 'blocks'], project())
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'Cannot remove blocks: druxt-blocks is not in this project.'
    )
  })
})
