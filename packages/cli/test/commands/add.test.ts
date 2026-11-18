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

/** What the stand-in backend has enabled, and what depends on what. */
interface Backend {
  enabled?: string[]
  /** For a module, the enabled modules that depend on it. */
  dependents?: Record<string, string[]>
  /** True when the backend cannot be asked anything. */
  unreadable?: boolean
  /** For a module, what the backend enables along with it. */
  brings?: Record<string, string[]>
}

/**
 * A stand-in for the tools: it records each command line, and an install of
 * a frontend package writes the dependency as the package manager would. A
 * question to the backend is answered from `backend` and kept in `asked`,
 * apart from the commands that change something.
 */
function tools(
  root: string,
  fail?: { on: string; output: string },
  backend: Backend = {}
) {
  const calls: string[] = []
  const asked: string[] = []
  const enabled = new Set(backend.enabled ?? [])
  const exec: CliContext['exec'] = async (command, args, { cwd }) => {
    const line = `${relative(root, cwd)}$ ${command} ${args.join(' ')}`
    if (args.includes('pm:list')) {
      asked.push(line)
      if (backend.unreadable) return { code: 1, output: 'No database.' }
      const list = Object.fromEntries(
        [...enabled].map((name) => [name, { name }])
      )
      return { code: 0, output: JSON.stringify(list) }
    }
    if (args.includes('--simulate')) {
      asked.push(line)
      const name = args.at(-2) as string
      if (backend.unreadable) return { code: 1, output: 'No database.' }
      if (!enabled.has(name)) {
        return {
          code: 1,
          output: `The following module(s) are not installed: ${name}. No modules to uninstall.`,
        }
      }
      const all = [name, ...(backend.dependents?.[name] ?? [])]
      return {
        code: 0,
        output: `The following extensions will be uninstalled: ${all.join(', ')}\n`,
      }
    }
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
    const names = args.slice(args.indexOf('-y') + 1)
    if (args.includes('en')) {
      for (const name of names) {
        enabled.add(name)
        for (const other of backend.brings?.[name] ?? []) enabled.add(other)
      }
    }
    if (args.includes('pmu')) for (const name of names) enabled.delete(name)
    return { code: 0, output: '' } satisfies ToolResult
  }
  return { calls, asked, exec, enabled }
}

/** Answers what the backend is asked, and fails on anything that changes it. */
const asking = (root: string, backend: Backend = {}): CliContext['exec'] => {
  const { exec } = tools(root, undefined, backend)
  return async (command, args, options) => {
    if (args.includes('pm:list') || args.includes('--simulate')) {
      return exec(command, args, options)
    }
    throw new Error(`A command was run: ${command} ${args.join(' ')}`)
  }
}

const drx = (
  argv: string[],
  cwd: string,
  overrides: Partial<CliContext> = {}
) =>
  run(argv, {
    cwd,
    defaultModuleRegistry: url,
    // Asking the backend what it has enabled changes nothing.
    exec: asking(cwd),
    ...overrides,
  })

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
        frontend: [{ path: 'nuxt', installed: true, listed: true }],
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
            patches: [
              {
                package: 'drupal/decoupled_router',
                description: PATCH.description,
                url: PATCH.url,
                module: 'decoupled_router',
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
      asking(root)
    )
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Error: Cancelled. Nothing was changed.')
    expect(snapshot(root)).toEqual(before)
  })
})

describe('drx remove', () => {
  /** The backend once breadcrumb is added. */
  const ENABLED = { enabled: ['decoupled_router'] }

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
    const { calls, exec } = tools(root, undefined, ENABLED)
    const result = await drx(['remove', 'breadcrumb', '--backend'], root, {
      exec,
    })
    expect(result.code).toBe(0)
    expect(calls).toEqual([
      'nuxt$ npm uninstall druxt-breadcrumb',
      'drupal$ ddev drush pmu -y decoupled_router',
      'drupal$ ddev composer remove --no-update-with-dependencies drupal/decoupled_router',
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

    const { calls, exec } = tools(root, undefined, ENABLED)
    const result = await drx(['remove', 'breadcrumb', '--backend'], root, {
      exec,
    })
    expect(calls).toEqual(['nuxt$ npm uninstall druxt-breadcrumb'])
    expect(result.stderr).toContain('decoupled_router stays: router needs it.')
    // router has no record to take it, so it stays on this one.
    expect(config(root).modules[0].name).toBe('breadcrumb')
    expect(config(root).modules[0].backend[0].modules).toHaveLength(1)
  })

  test('--dry-run prints the steps and changes nothing', async () => {
    const root = await added()
    const before = snapshot(root)
    const result = await drx(
      ['remove', 'breadcrumb', '--backend', '--dry-run'],
      root,
      { exec: asking(root, ENABLED) }
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
        '    run   ddev composer remove --no-update-with-dependencies drupal/decoupled_router',
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

/** The project with one more dependency in the frontend's package.json. */
function depend(root: string, name: string) {
  const file = join(root, 'nuxt/package.json')
  const manifest = JSON.parse(readFileSync(file, 'utf8'))
  manifest.dependencies[name] = '^0.25.0'
  writeFileSync(file, JSON.stringify(manifest))
}

describe('what drx add records', () => {
  test('says what it did to each part, and what it found in place', async () => {
    const root = project()
    // The site has the Decoupled Router module enabled, and not required.
    const backend = { enabled: ['decoupled_router'] }
    const { calls, exec } = tools(root, undefined, backend)
    const result = await drx(['add', 'router'], root, { exec })
    expect(result.code).toBe(0)
    expect(calls).toEqual([
      'nuxt$ npm install druxt-router',
      'drupal$ ddev composer require drupal/decoupled_router',
    ])
    expect(result.stderr).toContain('decoupled_router is already enabled.')
    expect(config(root).modules).toEqual([
      {
        name: 'router',
        package: 'druxt-router',
        frontend: [{ path: 'nuxt', installed: true, listed: true }],
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
            ],
            patches: [],
          },
        ],
      },
    ])
  })

  test('records a module the backend enabled along with the one it was asked for', async () => {
    const root = project()
    const { calls, exec } = tools(root, undefined, {
      brings: { decoupled_router: ['path_alias'] },
      dependents: { path_alias: ['decoupled_router'] },
    })
    await drx(['add', 'router'], root, { exec })
    expect(config(root).modules[0].backend[0].modules).toEqual([
      {
        name: 'decoupled_router',
        package: 'drupal/decoupled_router',
        enabled: true,
        required: true,
      },
      { name: 'path_alias', enabled: true, required: false },
    ])

    calls.length = 0
    await drx(['remove', 'router', '--backend'], root, { exec })
    expect(calls).toContain(
      'drupal$ ddev drush pmu -y decoupled_router path_alias'
    )
    expect(config(root).modules).toBeUndefined()
  })

  test('a second add keeps what the first recorded', async () => {
    const root = project()
    const { exec } = tools(root)
    await drx(['add', 'breadcrumb'], root, { exec })
    const first = config(root).modules
    expect(first[0].backend[0].modules).toHaveLength(1)

    const again = await drx(['add', 'breadcrumb'], root, { exec })
    expect(again.code).toBe(0)
    expect(config(root).modules).toEqual(first)
  })

  test('add, remove, add, then remove --backend undoes the backend', async () => {
    const root = project()
    const { calls, exec } = tools(root)
    await drx(['add', 'router'], root, { exec })
    await drx(['remove', 'router'], root, { exec })
    await drx(['add', 'router'], root, { exec })
    calls.length = 0
    const result = await drx(['remove', 'router', '--backend'], root, { exec })
    expect(result.code).toBe(0)
    expect(calls).toEqual([
      'nuxt$ npm uninstall druxt-router',
      'drupal$ ddev drush pmu -y decoupled_router',
      'drupal$ ddev composer remove --no-update-with-dependencies drupal/decoupled_router',
    ])
    expect(config(root).modules).toBeUndefined()
  })

  test('reads a record written before the parts were told apart', async () => {
    const root = project()
    const file = join(root, 'drx.config.json')
    const old = JSON.parse(readFileSync(file, 'utf8'))
    old.modules = [
      {
        name: 'router',
        package: 'druxt-router',
        backend: [
          {
            path: 'drupal',
            modules: [
              { name: 'decoupled_router', package: 'drupal/decoupled_router' },
            ],
            patches: [],
          },
        ],
      },
    ]
    writeFileSync(file, JSON.stringify(old))
    depend(root, 'druxt-router')
    const { calls, exec } = tools(root, undefined, {
      enabled: ['decoupled_router'],
    })
    const result = await drx(['remove', 'router', '--backend'], root, { exec })
    expect(result.code).toBe(0)
    // The record does not say who installed the package, so it stays.
    expect(calls).toEqual([
      'drupal$ ddev drush pmu -y decoupled_router',
      'drupal$ ddev composer remove --no-update-with-dependencies drupal/decoupled_router',
    ])
    expect(result.stdout).toContain(
      'The record does not say whether drx add installed druxt-router, so it was left. To take it out: npm uninstall druxt-router.'
    )
  })
})

describe('drx remove of what the site already had', () => {
  test('keeps a package and a config entry that drx add found in place', async () => {
    const root = project(
      { engine: 'ddev' },
      {
        'drupal/composer.json': JSON.stringify({
          require: {
            'drupal/core-recommended': '~11',
            'drupal/simple_oauth': '^6',
          },
        }),
      }
    )
    depend(root, 'druxt-auth')
    const before = snapshot(root)
    const { calls, exec } = tools(root, undefined, {
      enabled: ['simple_oauth'],
    })
    await drx(['add', 'auth'], root, { exec })
    expect(config(root).modules[0].frontend).toEqual([
      { path: 'nuxt', installed: false, listed: false },
    ])
    calls.length = 0

    const result = await drx(['remove', 'auth', '--backend'], root, { exec })
    expect(result.code).toBe(0)
    expect(calls).toEqual([])
    expect(result.stderr).toContain(
      'druxt-auth was in package.json before drx add, so it stays.'
    )
    expect(result.stdout).toBe(
      'Nothing to remove for auth: drx add found it in place.\n'
    )
    expect(config(root).modules).toBeUndefined()
    const after = snapshot(root)
    delete after['drx.config.json']
    delete before['drx.config.json']
    expect(after).toEqual(before)
  })

  test('refuses a module that is installed and has no record', async () => {
    const root = project()
    depend(root, 'druxt-blocks')
    const before = snapshot(root)
    const result = await drx(['remove', 'blocks'], root)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'Cannot remove blocks: drx add did not put druxt-blocks in this project, so there is nothing of its own to undo. Uninstall the package and take it out of the config by hand.'
    )
    expect(snapshot(root)).toEqual(before)
  })

  test('refuses a module that is only in node_modules', async () => {
    const root = project(
      { engine: 'ddev' },
      { 'nuxt/node_modules/druxt-blocks/package.json': { version: '0.18.1' } }
    )
    const result = await drx(['remove', 'blocks'], root)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'Cannot remove blocks: druxt-blocks is not in this project.'
    )
  })
})

describe('drx remove --backend and what the backend still needs', () => {
  test('leaves a module another enabled module depends on, and says which', async () => {
    const root = project()
    const { calls, asked, exec, enabled } = tools(root, undefined, {
      dependents: { decoupled_router: ['druxt'] },
    })
    await drx(['add', 'router'], root, { exec })
    calls.length = 0

    const result = await drx(['remove', 'router', '--backend'], root, { exec })
    expect(result.code).toBe(0)
    expect(asked).toContain(
      'drupal$ ddev drush pm:uninstall decoupled_router --simulate'
    )
    expect(calls).toEqual(['nuxt$ npm uninstall druxt-router'])
    expect(enabled.has('decoupled_router')).toBe(true)
    expect(result.stderr).toContain(
      'decoupled_router stays enabled: druxt depends on it.'
    )
    // What stays keeps its record.
    expect(config(root).modules).toEqual([
      {
        name: 'router',
        package: 'druxt-router',
        frontend: [],
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
            patches: [],
          },
        ],
      },
    ])
  })

  test('uninstalls nothing when the backend cannot say what depends on it', async () => {
    const root = project()
    const { exec } = tools(root)
    await drx(['add', 'router'], root, { exec })

    const silent = tools(root, undefined, { unreadable: true })
    const result = await drx(['remove', 'router', '--backend'], root, {
      exec: silent.exec,
    })
    expect(result.code).toBe(0)
    expect(silent.calls).toEqual(['nuxt$ npm uninstall druxt-router'])
    expect(result.stdout).toBe(
      [
        'Removed router.',
        '',
        'Left to do:',
        '  The backend could not say what depends on decoupled_router, so it was left enabled. Once nothing does: drush pm:uninstall decoupled_router, then composer remove drupal/decoupled_router',
        '',
      ].join('\n')
    )
    expect(config(root).modules[0].backend[0].modules).toHaveLength(1)
  })

  test('hands over what came up with a module that stays, and takes it all out last', async () => {
    // Enabling decoupled_router brings path_alias up with it.
    const root = project()
    const { calls, exec } = tools(root, undefined, {
      brings: { decoupled_router: ['path_alias'] },
      dependents: { path_alias: ['decoupled_router'] },
    })
    await drx(['add', 'breadcrumb', '--no-patches'], root, { exec })
    await drx(['add', 'router'], root, { exec })

    await drx(['remove', 'breadcrumb', '--backend'], root, { exec })
    // Nothing is left on the record of the module that is gone.
    expect(config(root).modules).toHaveLength(1)
    expect(
      config(root).modules[0].backend[0].modules.map(
        (module: { name: string }) => module.name
      )
    ).toEqual(['decoupled_router', 'path_alias'])

    calls.length = 0
    const last = await drx(['remove', 'router', '--backend'], root, { exec })
    expect(last.code).toBe(0)
    expect(calls).toEqual([
      'nuxt$ npm uninstall druxt-router',
      'drupal$ ddev drush pmu -y decoupled_router path_alias',
      'drupal$ ddev composer remove --no-update-with-dependencies drupal/decoupled_router',
    ])
    expect(config(root).modules).toBeUndefined()
  })

  test('a module that was removed no longer holds what it needed', async () => {
    const root = project()
    const { calls, exec } = tools(root)
    await drx(['add', 'breadcrumb', '--no-patches'], root, { exec })
    // router was removed, and something of it was left on its record.
    const file = join(root, 'drx.config.json')
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    saved.modules.push({
      name: 'router',
      package: 'druxt-router',
      frontend: [],
      backend: [
        {
          path: 'drupal',
          modules: [{ name: 'path_alias', enabled: true, required: false }],
          patches: [],
        },
      ],
    })
    writeFileSync(file, JSON.stringify(saved))

    calls.length = 0
    const result = await drx(['remove', 'breadcrumb', '--backend'], root, {
      exec,
    })
    expect(result.stderr).not.toContain('router needs it')
    expect(calls).toContain('drupal$ ddev drush pmu -y decoupled_router')
  })

  test('hands what stays to the module that still needs it', async () => {
    // breadcrumb and router both need decoupled_router.
    const root = project()
    const { calls, exec } = tools(root)
    await drx(['add', 'breadcrumb'], root, { exec })
    await drx(['add', 'router'], root, { exec })
    calls.length = 0

    const first = await drx(['remove', 'breadcrumb', '--backend'], root, {
      exec,
    })
    expect(first.code).toBe(0)
    expect(calls).toEqual(['nuxt$ npm uninstall druxt-breadcrumb'])
    expect(first.stderr).toContain('decoupled_router stays: router needs it.')
    expect(config(root).modules).toEqual([
      {
        name: 'router',
        package: 'druxt-router',
        frontend: [{ path: 'nuxt', installed: true, listed: true }],
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
            patches: [
              {
                package: 'drupal/decoupled_router',
                description: PATCH.description,
                url: PATCH.url,
                module: 'decoupled_router',
              },
            ],
          },
        ],
      },
    ])

    calls.length = 0
    const second = await drx(['remove', 'router', '--backend'], root, { exec })
    expect(second.code).toBe(0)
    expect(calls).toEqual([
      'nuxt$ npm uninstall druxt-router',
      'drupal$ ddev drush pmu -y decoupled_router',
      'drupal$ ddev composer remove --no-update-with-dependencies drupal/decoupled_router',
      'drupal$ ddev composer patches-relock',
    ])
    expect(
      JSON.parse(readFileSync(join(root, 'drupal/composer.json'), 'utf8')).extra
    ).toEqual({})
    expect(config(root).modules).toBeUndefined()
  })
})

describe('drx add with no backend to look in', () => {
  // The registry as it is published: no module is marked as core.
  const published = () => {
    server.files['/modules.json'] = JSON.stringify({
      schemaVersion: 1,
      modules: [
        entry('menu', {
          drupal: [
            { name: 'jsonapi_menu_items', label: 'JSON:API Menu Items' },
            { name: 'menu_link_content', label: 'Custom Menu Links' },
          ],
        }),
      ],
    })
  }

  test('plans the frontend and leaves the backend lines to the user', async () => {
    published()
    const root = project({ engine: 'none', baseUrl: 'https://example.com' })
    const before = snapshot(root)
    const result = await drx(['add', 'menu', '--dry-run'], root)
    expect(result.code).toBe(0)
    expect(result.stdout).toBe(
      [
        'Add menu (druxt-menu)',
        '  nuxt/',
        '    run   npm install druxt-menu',
        "    edit  Add 'druxt-menu' to modules in nuxt.config.js",
        '  drupal/',
        '    The backend of this project is not on this machine. Where it is:',
        '      composer require drupal/jsonapi_menu_items drupal/menu_link_content',
        '      drush en -y jsonapi_menu_items menu_link_content',
        '',
        'Left to do:',
        '  The module registry does not say whether jsonapi_menu_items or menu_link_content is part of core. Leave a module that is out of the composer require line: only the enable line applies to it.',
        '',
        'Nothing was changed: this was a dry run.',
        '',
      ].join('\n')
    )
    expect(snapshot(root)).toEqual(before)
  })
})

describe('drx add and a patch that is not served over https', () => {
  test('refuses before anything is written, naming the entry', async () => {
    server.files['/modules.json'] = JSON.stringify({
      schemaVersion: 1,
      modules: [
        entry('blocks', {
          drupal: [{ name: 'block', label: 'Block', core: true }],
        }),
        entry('breadcrumb', {
          drupal: [
            {
              name: 'decoupled_router',
              label: 'Decoupled Router',
              patches: [{ ...PATCH, url: 'http://example.com/mr/12.diff' }],
            },
          ],
        }),
      ],
    })
    const root = project()
    const before = snapshot(root)
    const result = await drx(['add', 'breadcrumb'], root)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'Cannot add breadcrumb: The patch "Fix the redirect loop" that decoupled_router needs is at http://example.com/mr/12.diff, and Composer only fetches a patch over https.'
    )
    expect(snapshot(root)).toEqual(before)

    const without = await drx(['add', 'breadcrumb', '--no-patches'], root, {
      exec: tools(root).exec,
    })
    expect(without.code).toBe(0)
  })
})

describe('drx add --dry-run and what is left to the user', () => {
  test('prints the line of a config that cannot be edited', async () => {
    const root = project(
      { engine: 'ddev' },
      { 'nuxt/nuxt.config.js': 'export default () => ({ modules: [] })\n' }
    )
    const result = await drx(['add', 'blocks', '--dry-run'], root)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain(
      [
        'Left to do:',
        "  Add 'druxt-blocks' to the modules array in nuxt.config.js. It could not be edited safely.",
        '',
        'Nothing was changed: this was a dry run.',
      ].join('\n')
    )
  })
})

describe('the JSON of a step that failed', () => {
  test('has the step, its exit code and what was and was not done', async () => {
    const root = project()
    const { exec } = tools(root, {
      on: 'composer require drupal/decoupled_router',
      output: 'Your requirements could not be resolved.',
    })
    const result = await drx(['add', 'router', '--json'], root, { exec })
    expect(result.code).toBe(1)
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      error: {
        code: 'step-failed',
        message: expect.stringContaining(
          'ddev composer require drupal/decoupled_router failed in drupal/ with exit code 1.'
        ),
        failed: {
          part: 'drupal',
          step: 'ddev composer require drupal/decoupled_router',
          exitCode: 1,
          output: 'Your requirements could not be resolved.',
        },
        done: [
          'nuxt/: npm install druxt-router',
          "nuxt/: Add 'druxt-router' to modules in nuxt.config.js",
        ],
        notDone: [
          'drupal/: ddev composer require drupal/decoupled_router',
          'drupal/: ddev drush en -y decoupled_router',
        ],
      },
    })
  })
})
