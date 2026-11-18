import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { CliContext } from '../../src/context.js'
import type { ToolResult } from '../../src/exec.js'
import { answering } from '../helpers/prompter.js'
import { run } from '../helpers/run.js'
import { closedPort, serve, type TestServer } from '../helpers/server.js'
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

const MANAGERS = ['npm', 'pnpm', 'yarn', 'bun']

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
        [...enabled].map((name) => [
          name,
          { name, path: `modules/contrib/${name}` },
        ])
      )
      return { code: 0, output: JSON.stringify(list) }
    }
    if (args.includes('--simulate')) {
      asked.push(line)
      const name = args.findLast((arg) => !arg.startsWith('-')) as string
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
    if (MANAGERS.includes(command)) {
      const file = join(cwd, 'package.json')
      const manifest = JSON.parse(readFileSync(file, 'utf8'))
      const name = args.at(-1) as string
      if (['install', 'add'].includes(args[0] as string)) {
        manifest.dependencies[name] = '^1.0.0'
      } else delete manifest.dependencies[name]
      writeFileSync(file, JSON.stringify(manifest, null, 2))
    }
    // Composer reads composer.json as it is, changes `require` and writes
    // the whole file again in its own layout.
    const composer = args.slice(args.indexOf('composer') + 1)
    if (
      (command === 'composer' || args.includes('composer')) &&
      ['require', 'remove'].includes(composer[0] as string)
    ) {
      const file = join(cwd, 'composer.json')
      const manifest = JSON.parse(readFileSync(file, 'utf8'))
      const require: Record<string, string> = manifest.require ?? {}
      for (const named of composer.slice(1)) {
        if (named.startsWith('-')) continue
        const [name, constraint] = named.split(/:(.*)/) as [string, string?]
        if (composer[0] === 'require') require[name] = constraint ?? '^1.0'
        else delete require[name]
      }
      manifest.require = Object.fromEntries(
        Object.entries(require).sort(([a], [b]) => a.localeCompare(b))
      )
      writeFileSync(file, JSON.stringify(manifest, null, 4) + '\n')
    }
    const names = args
      .slice(args.indexOf('-y') + 1)
      .filter((name) => name !== '--')
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
  '    run   npm install -- druxt-breadcrumb',
  "    edit  Add 'druxt-breadcrumb' to modules in nuxt.config.js",
  '  drupal/',
  '    edit  Add 1 patch to composer.json',
  '    run   ddev composer require -- cweagans/composer-patches:^2.0@beta',
  '    run   ddev composer patches-relock',
  '    run   ddev composer require -- drupal/decoupled_router',
  '    run   ddev drush en -y -- decoupled_router',
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
            { part: 'nuxt', run: 'npm install -- druxt-blocks' },
            {
              part: 'nuxt',
              edit: "Add 'druxt-blocks' to modules in nuxt.config.js",
            },
            { part: 'drupal', run: 'ddev drush en -y -- block' },
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
      'nuxt$ npm install -- druxt-breadcrumb',
      'drupal$ ddev composer require -- cweagans/composer-patches:^2.0@beta',
      'drupal$ ddev composer patches-relock',
      'drupal$ ddev composer require -- drupal/decoupled_router',
      'drupal$ ddev drush en -y -- decoupled_router',
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
      'nuxt$ npm install -- druxt-blocks',
      'drupal$ vendor/bin/drush en -y -- block',
    ])
  })

  test('adds several modules, one after the other', async () => {
    const root = project()
    const { calls, exec } = tools(root)
    const result = await drx(['add', 'blocks', 'router'], root, { exec })
    expect(result.stdout).toBe('Added blocks.\nAdded router.\n')
    expect(calls.filter((line) => line.startsWith('nuxt$'))).toEqual([
      'nuxt$ npm install -- druxt-blocks',
      'nuxt$ npm install -- druxt-router',
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
    expect(calls).toEqual(['nuxt$ npm install -- druxt-breadcrumb'])
    expect(result.stdout).toBe(
      [
        'Added breadcrumb.',
        '',
        'Left to do:',
        '  The backend of this project is not on this machine. Where it is:',
        '    Patch drupal/decoupled_router with https://example.com/mr/12.diff (Fix the redirect loop)',
        '    composer require -- cweagans/composer-patches:^2.0@beta',
        '    composer patches-relock',
        '    composer require -- drupal/decoupled_router',
        '    drush en -y -- decoupled_router',
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
    expect(calls).toEqual(['nuxt$ npm install -- druxt-blocks'])
    expect(result.stdout).toContain(
      '  This project does not record how drupal/ is run. In it:\n    drush en -y -- block'
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
      on: 'composer require -- drupal/decoupled_router',
      output: 'Your requirements could not be resolved.',
    })
    const result = await drx(['add', 'breadcrumb'], root, { exec })

    expect(result.code).toBe(1)
    expect(calls.at(-1)).toBe(
      'drupal$ ddev composer require -- drupal/decoupled_router'
    )
    expect(result.stderr).toContain(
      [
        'Error: ddev composer require -- drupal/decoupled_router failed in drupal/ with exit code 1.',
        'Your requirements could not be resolved.',
        'Done:',
        '  nuxt/: npm install -- druxt-breadcrumb',
        "  nuxt/: Add 'druxt-breadcrumb' to modules in nuxt.config.js",
        '  drupal/: Add 1 patch to composer.json',
        '  drupal/: ddev composer require -- cweagans/composer-patches:^2.0@beta',
        '  drupal/: ddev composer patches-relock',
        'Not done:',
        '  drupal/: ddev composer require -- drupal/decoupled_router',
        '  drupal/: ddev drush en -y -- decoupled_router',
      ].join('\n')
    )
    // What was done is on the record, for a second run or a remove.
    expect(config(root).modules).toEqual([
      {
        name: 'breadcrumb',
        package: 'druxt-breadcrumb',
        frontend: [{ path: 'nuxt', installed: true, listed: true }],
        backend: [
          {
            path: 'drupal',
            modules: [],
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
      'drupal$ ddev composer require -- drupal/jsonapi_menu_items',
      'drupal$ ddev drush en -y -- jsonapi_menu_items menu_link_content',
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
    expect(result.stderr).toContain('    run   ddev drush en -y -- block')
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
    expect(calls).toEqual(['nuxt$ npm uninstall -- druxt-breadcrumb'])
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
      'nuxt$ npm uninstall -- druxt-breadcrumb',
      'drupal$ ddev drush pmu -y -- decoupled_router',
      'drupal$ ddev composer remove --no-update-with-dependencies -- drupal/decoupled_router',
      'drupal$ ddev composer patches-relock',
    ])
    const composer = JSON.parse(
      readFileSync(join(root, 'drupal/composer.json'), 'utf8')
    )
    // The patches were all that was under `extra`, so it went with them.
    expect(composer.extra).toBeUndefined()
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
    expect(calls).toEqual(['nuxt$ npm uninstall -- druxt-breadcrumb'])
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
        '    run   npm uninstall -- druxt-breadcrumb',
        "    edit  Remove 'druxt-breadcrumb' from modules in nuxt.config.js",
        '  drupal/',
        '    run   ddev drush pmu -y -- decoupled_router',
        '    edit  Remove 1 patch from composer.json',
        '    run   ddev composer remove --no-update-with-dependencies -- drupal/decoupled_router',
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
      'nuxt$ npm install -- druxt-router',
      'drupal$ ddev composer require -- drupal/decoupled_router',
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
      'drupal$ ddev drush pmu -y -- decoupled_router path_alias'
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
      'nuxt$ npm uninstall -- druxt-router',
      'drupal$ ddev drush pmu -y -- decoupled_router',
      'drupal$ ddev composer remove --no-update-with-dependencies -- drupal/decoupled_router',
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
      'drupal$ ddev drush pmu -y -- decoupled_router',
      'drupal$ ddev composer remove --no-update-with-dependencies -- drupal/decoupled_router',
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
      'drupal$ ddev drush pm:uninstall --simulate -- decoupled_router'
    )
    expect(calls).toEqual(['nuxt$ npm uninstall -- druxt-router'])
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
    expect(silent.calls).toEqual(['nuxt$ npm uninstall -- druxt-router'])
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
      'nuxt$ npm uninstall -- druxt-router',
      'drupal$ ddev drush pmu -y -- decoupled_router path_alias',
      'drupal$ ddev composer remove --no-update-with-dependencies -- drupal/decoupled_router',
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
    expect(calls).toContain('drupal$ ddev drush pmu -y -- decoupled_router')
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
    expect(calls).toEqual(['nuxt$ npm uninstall -- druxt-breadcrumb'])
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
      'nuxt$ npm uninstall -- druxt-router',
      'drupal$ ddev drush pmu -y -- decoupled_router',
      'drupal$ ddev composer remove --no-update-with-dependencies -- drupal/decoupled_router',
      'drupal$ ddev composer patches-relock',
    ])
    expect(
      JSON.parse(readFileSync(join(root, 'drupal/composer.json'), 'utf8')).extra
    ).toBeUndefined()
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
        '    run   npm install -- druxt-menu',
        "    edit  Add 'druxt-menu' to modules in nuxt.config.js",
        '  drupal/',
        '    The backend of this project is not on this machine. Where it is:',
        '      composer require -- drupal/jsonapi_menu_items drupal/menu_link_content',
        '      drush en -y -- jsonapi_menu_items menu_link_content',
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
      on: 'composer require -- drupal/decoupled_router',
      output: 'Your requirements could not be resolved.',
    })
    const result = await drx(['add', 'router', '--json'], root, { exec })
    expect(result.code).toBe(1)
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      error: {
        code: 'step-failed',
        message: expect.stringContaining(
          'ddev composer require -- drupal/decoupled_router failed in drupal/ with exit code 1.'
        ),
        failed: {
          part: 'drupal',
          step: 'ddev composer require -- drupal/decoupled_router',
          exitCode: 1,
          output: 'Your requirements could not be resolved.',
        },
        done: [
          'nuxt/: npm install -- druxt-router',
          "nuxt/: Add 'druxt-router' to modules in nuxt.config.js",
        ],
        notDone: [
          'drupal/: ddev composer require -- drupal/decoupled_router',
          'drupal/: ddev drush en -y -- decoupled_router',
        ],
      },
    })
  })
})

const patchOf = (name: string) => ({
  description: `Fix ${name}`,
  url: `https://example.com/${name}.diff`,
})
const patched = (name: string) => ({
  name: `mod_${name}`,
  label: `Mod ${name}`,
  patches: [patchOf(name)],
})

/** Modules that each need a backend module of their own, with a patch. */
const PAIR = {
  schemaVersion: 1,
  modules: [
    entry('alpha', { drupal: [patched('alpha')] }),
    entry('beta', { drupal: [patched('beta')] }),
    // Needs the backend module alpha needs, and nothing of its own.
    entry('gamma', { drupal: [{ name: 'mod_alpha', label: 'Mod alpha' }] }),
    // A registry that marks one module as core is taken to mark them all.
    entry('delta', { drupal: [{ name: 'block', label: 'Block', core: true }] }),
  ],
}

/** Serves another registry next to the usual one, and names it. */
const registryOf = (registry: unknown, path = '/other.json') => {
  server.files[path] = JSON.stringify(registry)
  return { defaultModuleRegistry: `${server.url}${path}` }
}

const read = (root: string, file: string) =>
  readFileSync(join(root, file), 'utf8')
const json = (root: string, file: string) => JSON.parse(read(root, file))

/** A site that has the patches plugin, so a patch changes nothing else. */
const PLUGIN = 'cweagans/composer-patches'
const withPlugin = () =>
  project(
    { engine: 'ddev' },
    {
      'drupal/composer.json':
        JSON.stringify(
          {
            require: {
              [PLUGIN]: '^2.0@beta',
              'drupal/core-recommended': '~11',
            },
            config: { 'allow-plugins': { [PLUGIN]: true } },
          },
          null,
          4
        ) + '\n',
    }
  )

/** The files of a project but its own record, which a run always rewrites. */
const files = (root: string) =>
  Object.fromEntries(
    Object.entries(snapshot(root)).filter(
      ([file]) => file !== 'drx.config.json'
    )
  )

const backendRecord = (name: string) => ({
  path: 'drupal',
  modules: [
    {
      name: `mod_${name}`,
      package: `drupal/mod_${name}`,
      enabled: true,
      required: true,
    },
  ],
  patches: [
    { package: `drupal/mod_${name}`, ...patchOf(name), module: `mod_${name}` },
  ],
})

describe('several modules in one run', () => {
  test('drx add a b leaves the files with what both wrote', async () => {
    const root = project()
    const { exec, enabled } = tools(root)
    const result = await drx(['add', 'alpha', 'beta'], root, {
      exec,
      ...registryOf(PAIR),
    })
    expect(result.code, result.stderr).toBe(0)

    const config = read(root, 'nuxt/nuxt.config.js')
    expect(config).toContain("'druxt-alpha'")
    expect(config).toContain("'druxt-beta'")
    expect(json(root, 'nuxt/package.json').dependencies).toMatchObject({
      'druxt-alpha': '^1.0.0',
      'druxt-beta': '^1.0.0',
    })
    const composer = json(root, 'drupal/composer.json')
    expect(Object.keys(composer.require)).toEqual([
      PLUGIN,
      'drupal/core-recommended',
      'drupal/mod_alpha',
      'drupal/mod_beta',
    ])
    expect(composer.extra.patches).toEqual({
      'drupal/mod_alpha': { 'Fix alpha': 'https://example.com/alpha.diff' },
      'drupal/mod_beta': { 'Fix beta': 'https://example.com/beta.diff' },
    })
    expect([...enabled]).toEqual(['mod_alpha', 'mod_beta'])
  })

  test('each record holds what its own module did, and no more', async () => {
    const root = project()
    await drx(['add', 'alpha', 'beta'], root, {
      exec: tools(root).exec,
      ...registryOf(PAIR),
    })
    expect(json(root, 'drx.config.json').modules).toEqual([
      {
        name: 'alpha',
        package: 'druxt-alpha',
        frontend: [{ path: 'nuxt', installed: true, listed: true }],
        backend: [backendRecord('alpha')],
      },
      {
        name: 'beta',
        package: 'druxt-beta',
        frontend: [{ path: 'nuxt', installed: true, listed: true }],
        backend: [backendRecord('beta')],
      },
    ])
  })

  test('drx remove a b --backend takes both out and leaves the files as they were', async () => {
    const root = withPlugin()
    const before = files(root)
    const { exec, enabled } = tools(root)
    const overrides = { exec, ...registryOf(PAIR) }
    await drx(['add', 'alpha', 'beta'], root, overrides)
    expect(files(root)).not.toEqual(before)

    const result = await drx(
      ['remove', 'alpha', 'beta', '--backend'],
      root,
      overrides
    )
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toBe('Removed alpha.\nRemoved beta.\n')
    expect(read(root, 'nuxt/nuxt.config.js')).toBe(NUXT_CONFIG)
    expect(json(root, 'nuxt/package.json').dependencies).toEqual({
      nuxt: '2.15.8',
      'druxt-site': '^0.15.1',
    })
    const composer = json(root, 'drupal/composer.json')
    expect(Object.keys(composer.require)).toEqual([
      PLUGIN,
      'drupal/core-recommended',
    ])
    expect(composer.extra).toBeUndefined()
    expect([...enabled]).toEqual([])
    expect(json(root, 'drx.config.json').modules).toBeUndefined()
    expect(files(root)).toEqual(before)
  })

  test('a backend module two of them need is done once, by the first', async () => {
    const root = project()
    const { calls, exec } = tools(root)
    const overrides = { exec, ...registryOf(PAIR) }
    const result = await drx(['add', 'alpha', 'gamma'], root, overrides)
    expect(result.code, result.stderr).toBe(0)
    expect(calls.filter((line) => line.includes('mod_alpha'))).toEqual([
      'drupal$ ddev composer require -- drupal/mod_alpha',
      'drupal$ ddev drush en -y -- mod_alpha',
    ])
    const [alpha, gamma] = json(root, 'drx.config.json').modules
    expect(alpha.backend).toEqual([backendRecord('alpha')])
    expect(gamma.backend).toEqual([])

    calls.length = 0
    const removed = await drx(
      ['remove', 'alpha', 'gamma', '--backend'],
      root,
      overrides
    )
    expect(removed.code, removed.stderr).toBe(0)
    expect(calls.filter((line) => line.includes('mod_alpha'))).toEqual([
      'drupal$ ddev drush pmu -y -- mod_alpha',
      'drupal$ ddev composer remove --no-update-with-dependencies -- drupal/mod_alpha',
    ])
    expect(json(root, 'drx.config.json').modules).toBeUndefined()
  })

  test('the JSON of a run lists the steps that were taken', async () => {
    const root = project()
    const result = await drx(['add', 'alpha', 'gamma', '--json'], root, {
      exec: tools(root).exec,
      ...registryOf(PAIR),
    })
    const [, gamma] = JSON.parse(result.stdout).modules
    expect(gamma.steps).toEqual([
      { part: 'nuxt', run: 'npm install -- druxt-gamma' },
      { part: 'nuxt', edit: "Add 'druxt-gamma' to modules in nuxt.config.js" },
    ])
  })
})

describe('drx add when a tool fails part way', () => {
  const FAILS = { on: 'drush en', output: 'Drush could not start.' }
  const DONE = [
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
              enabled: false,
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
  ]

  test('records the steps that were done, and not the one that failed', async () => {
    const root = project()
    const result = await drx(['add', 'breadcrumb'], root, {
      exec: tools(root, FAILS).exec,
    })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Drush could not start.')
    expect(config(root).modules).toEqual(DONE)
  })

  test('records nothing when nothing was done', async () => {
    const root = project()
    const result = await drx(['add', 'breadcrumb'], root, {
      exec: tools(root, { on: 'npm install', output: 'E404' }).exec,
    })
    expect(result.code).toBe(1)
    expect(config(root).modules).toBeUndefined()
  })

  test('keeps the record of a module added before the one that failed', async () => {
    const root = project()
    const result = await drx(['add', 'blocks', 'breadcrumb'], root, {
      exec: tools(root, { ...FAILS, on: 'decoupled_router' }).exec,
    })
    expect(result.code).toBe(1)
    expect(config(root).modules.map((m: { name: string }) => m.name)).toEqual([
      'blocks',
      'breadcrumb',
    ])
    expect(result.stderr).toContain(
      [
        'Done:',
        '  nuxt/: npm install -- druxt-blocks',
        "  nuxt/: Add 'druxt-blocks' to modules in nuxt.config.js",
        '  drupal/: ddev drush en -y -- block',
        '  nuxt/: npm install -- druxt-breadcrumb',
      ].join('\n')
    )
    // blocks is whole, and breadcrumb is what its steps did.
    expect(config(root).modules[1].backend[0].patches).toHaveLength(1)
    expect(config(root).modules[1].backend[0].modules).toEqual([])
  })

  test('a second run finishes the job, with the record of a run that never failed', async () => {
    const clean = project()
    await drx(['add', 'breadcrumb'], clean, { exec: tools(clean).exec })

    const root = project()
    await drx(['add', 'breadcrumb'], root, { exec: tools(root, FAILS).exec })
    const { calls, exec } = tools(root)
    const again = await drx(['add', 'breadcrumb'], root, { exec })
    expect(again.code, again.stderr).toBe(0)
    // Only the step that failed was left to take.
    expect(calls).toEqual(['drupal$ ddev drush en -y -- decoupled_router'])
    expect(config(root).modules).toEqual(config(clean).modules)
    expect(files(root)).toEqual(files(clean))
  })

  test('a remove after the failure undoes what was done', async () => {
    const root = withPlugin()
    const before = files(root)
    await drx(['add', 'breadcrumb'], root, { exec: tools(root, FAILS).exec })
    expect(files(root)).not.toEqual(before)

    const { calls, exec } = tools(root)
    const result = await drx(['remove', 'breadcrumb', '--backend'], root, {
      exec,
    })
    expect(result.code, result.stderr).toBe(0)
    expect(calls).toEqual([
      'nuxt$ npm uninstall -- druxt-breadcrumb',
      'drupal$ ddev composer remove --no-update-with-dependencies -- drupal/decoupled_router',
      'drupal$ ddev composer patches-relock',
    ])
    expect(config(root).modules).toBeUndefined()
    expect(files(root)).toEqual(before)
  })

  test('a failure, a second run and a remove end where the project started', async () => {
    const root = withPlugin()
    const before = files(root)
    await drx(['add', 'breadcrumb'], root, { exec: tools(root, FAILS).exec })
    const { exec } = tools(root)
    expect((await drx(['add', 'breadcrumb'], root, { exec })).code).toBe(0)
    const result = await drx(['remove', 'breadcrumb', '--backend'], root, {
      exec,
    })
    expect(result.code, result.stderr).toBe(0)
    expect(config(root).modules).toBeUndefined()
    expect(files(root)).toEqual(before)
  })
})

describe('drx add and the plugins a site allows', () => {
  const composerWith = (config: Record<string, unknown> | undefined) =>
    project(
      { engine: 'ddev' },
      {
        'drupal/composer.json':
          JSON.stringify(
            {
              require: { 'drupal/core-recommended': '~11' },
              ...(config ? { config } : {}),
            },
            null,
            4
          ) + '\n',
      }
    )
  const allowed = async (config: Record<string, unknown> | undefined) => {
    const root = composerWith(config)
    const result = await drx(['add', 'breadcrumb'], root, {
      exec: tools(root).exec,
    })
    expect(result.code, result.stderr).toBe(0)
    return json(root, 'drupal/composer.json').config?.['allow-plugins']
  }

  test('leaves allow-plugins alone when it is true, which allows every plugin', async () => {
    expect(await allowed({ 'allow-plugins': true })).toBe(true)
  })

  test('adds one key to a list of allowed plugins', async () => {
    expect(
      await allowed({
        'allow-plugins': { 'composer/installers': true, 'a/b': false },
      })
    ).toEqual({ 'composer/installers': true, 'a/b': false, [PLUGIN]: true })
  })

  test('starts the list when the site has none', async () => {
    expect(await allowed(undefined)).toEqual({ [PLUGIN]: true })
    expect(await allowed({ 'sort-packages': true })).toEqual({
      [PLUGIN]: true,
    })
  })

  test('refuses the patch when allow-plugins is false, and writes nothing', async () => {
    const root = composerWith({ 'allow-plugins': false })
    const before = snapshot(root)
    const result = await drx(['add', 'breadcrumb'], root)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'Cannot add breadcrumb: composer.json sets allow-plugins to false, which turns every Composer plugin off, and the patch "Fix the redirect loop" needs cweagans/composer-patches. Allow the plugin there, or pass --no-patches to add the module without the patch.'
    )
    expect(snapshot(root)).toEqual(before)
  })

  test('--no-patches adds the module whatever allow-plugins is', async () => {
    const root = composerWith({ 'allow-plugins': false })
    const result = await drx(['add', 'breadcrumb', '--no-patches'], root, {
      exec: tools(root).exec,
    })
    expect(result.code, result.stderr).toBe(0)
    expect(json(root, 'drupal/composer.json').config).toEqual({
      'allow-plugins': false,
    })
  })
})

describe("drx add and a site's own patch of the same name", () => {
  const OWN = 'https://example.com/the-sites-own.patch'
  const owning = (patches: Record<string, Record<string, string>>) =>
    project(
      { engine: 'ddev' },
      {
        'drupal/composer.json':
          JSON.stringify(
            {
              require: {
                [PLUGIN]: '^2.0@beta',
                'drupal/core-recommended': '~11',
                'drupal/decoupled_router': '^2.0',
              },
              extra: { patches },
            },
            null,
            4
          ) + '\n',
      }
    )

  test('is refused before anything is written, naming the package and the patch', async () => {
    const root = owning({
      'drupal/decoupled_router': { [PATCH.description]: OWN },
    })
    const before = snapshot(root)
    const result = await drx(['add', 'breadcrumb', '--json'], root)
    expect(result.code).toBe(1)
    expect(JSON.parse(result.stdout).error.code).toBe('refused')
    expect(result.stderr).toContain(
      `Cannot add breadcrumb: composer.json already has a patch for drupal/decoupled_router named "Fix the redirect loop", from ${OWN}. It is the site's own, and drx add does not replace it. Rename it, or pass --no-patches to add the module without the patch from the registry.`
    )
    expect(snapshot(root)).toEqual(before)
  })

  test('goes in beside a patch of another name', async () => {
    const root = owning({ 'drupal/decoupled_router': { 'Our fix': OWN } })
    const result = await drx(['add', 'breadcrumb'], root, {
      exec: tools(root, undefined, { enabled: ['decoupled_router'] }).exec,
    })
    expect(result.code, result.stderr).toBe(0)
    expect(json(root, 'drupal/composer.json').extra.patches).toEqual({
      'drupal/decoupled_router': {
        'Our fix': OWN,
        [PATCH.description]: PATCH.url,
      },
    })
  })

  test('drx remove --backend leaves a patch the record does not own', async () => {
    const root = owning({ 'drupal/decoupled_router': { 'Our fix': OWN } })
    const { exec } = tools(root, undefined, { enabled: ['decoupled_router'] })
    await drx(['add', 'breadcrumb'], root, { exec })
    // The site's owner then points the registry's patch at a copy of it.
    const composer = json(root, 'drupal/composer.json')
    composer.extra.patches['drupal/decoupled_router'][PATCH.description] = OWN
    writeFileSync(
      join(root, 'drupal/composer.json'),
      JSON.stringify(composer, null, 4) + '\n'
    )
    const result = await drx(['remove', 'breadcrumb', '--backend'], root, {
      exec,
    })
    expect(result.code, result.stderr).toBe(0)
    expect(json(root, 'drupal/composer.json').extra.patches).toEqual({
      'drupal/decoupled_router': {
        'Our fix': OWN,
        [PATCH.description]: OWN,
      },
    })
  })
})

describe('drx add and the version of the patches plugin', () => {
  const installed = (version: string) => ({
    'drupal/composer.json':
      JSON.stringify(
        {
          require: { [PLUGIN]: '^1.7', 'drupal/core-recommended': '~11' },
          config: { 'allow-plugins': { [PLUGIN]: true } },
        },
        null,
        4
      ) + '\n',
    'drupal/vendor/composer/installed.json': {
      packages: [{ name: PLUGIN, version, 'install-path': `../${PLUGIN}` }],
    },
  })

  test('refuses a patch on a site with version 1 of the plugin, naming the version', async () => {
    const root = project({ engine: 'ddev' }, installed('1.7.3'))
    const before = snapshot(root)
    const result = await drx(['add', 'breadcrumb'], root)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'Cannot add breadcrumb: This site has cweagans/composer-patches 1.7.3, and the patch "Fix the redirect loop" is written for version 2 of the plugin, which keeps patches in a lock file. Update the plugin to version 2, or pass --no-patches to add the module without the patch.'
    )
    expect(snapshot(root)).toEqual(before)
  })

  test('goes by what is installed, and not by what the site asks for', async () => {
    const { 'drupal/composer.json': manifest } = installed('1.7.3')
    const root = project(
      { engine: 'ddev' },
      { 'drupal/composer.json': manifest }
    )
    const result = await drx(['add', 'breadcrumb'], root, {
      exec: tools(root).exec,
    })
    expect(result.code, result.stderr).toBe(0)
  })

  test.each(['2.0.0-beta2', '2.0.0', 'v2.1.0'])(
    'writes the patch with version %s',
    async (version) => {
      const root = project({ engine: 'ddev' }, installed(version))
      const result = await drx(['add', 'breadcrumb'], root, {
        exec: tools(root).exec,
      })
      expect(result.code, result.stderr).toBe(0)
      expect(json(root, 'drupal/composer.json').extra.patches).toBeDefined()
    }
  )

  test('adds a module with no patch whatever the version', async () => {
    const root = project({ engine: 'ddev' }, installed('1.7.3'))
    const result = await drx(['add', 'router'], root, {
      exec: tools(root).exec,
    })
    expect(result.code, result.stderr).toBe(0)
  })

  test('--no-patches adds the module on version 1', async () => {
    const root = project({ engine: 'ddev' }, installed('1.7.3'))
    const result = await drx(['add', 'breadcrumb', '--no-patches'], root, {
      exec: tools(root).exec,
    })
    expect(result.code, result.stderr).toBe(0)
  })
})

describe('drx remove with a registry that does not have the module', () => {
  /** A project with breadcrumb added while the registry had it. */
  async function added() {
    const root = withPlugin()
    const before = files(root)
    const { exec } = tools(root)
    expect((await drx(['add', 'breadcrumb'], root, { exec })).code).toBe(0)
    return { root, before, exec }
  }
  const WITHOUT = {
    schemaVersion: 1,
    modules: REGISTRY.modules.filter(({ name }) => name !== 'breadcrumb'),
  }

  test.each([['breadcrumb'], ['druxt-breadcrumb']])(
    'works from the record alone, by %s',
    async (name) => {
      const { root, before, exec } = await added()
      const result = await drx(['remove', name, '--backend'], root, {
        exec,
        ...registryOf(WITHOUT),
      })
      expect(result.code, result.stderr).toBe(0)
      expect(result.stdout).toBe('Removed breadcrumb.\n')
      expect(config(root).modules).toBeUndefined()
      expect(files(root)).toEqual(before)
    }
  )

  test('works when the registry cannot be read and there is no copy of it', async () => {
    const { root, before, exec } = await added()
    const result = await drx(['remove', 'breadcrumb', '--backend'], root, {
      exec,
      defaultModuleRegistry: `${await closedPort()}/modules.json`,
      cacheDir: tmp('drx-cache-'),
    })
    expect(result.code, result.stderr).toBe(0)
    expect(result.stderr).toContain(
      'drx remove goes by the record in drx.config.json.'
    )
    expect(result.stderr).toContain(
      'Warning: Without the module registry, drx remove cannot tell whether another module of the project needs what it takes out of the backend.'
    )
    expect(config(root).modules).toBeUndefined()
    expect(files(root)).toEqual(before)
  })

  test('works when the registry is invalid', async () => {
    const { root, exec } = await added()
    const result = await drx(['remove', 'breadcrumb'], root, {
      exec,
      ...registryOf({ schemaVersion: 1, modules: [{ name: 'broken' }] }),
    })
    expect(result.code, result.stderr).toBe(0)
  })

  test('still refuses a name that neither the registry nor the record has', async () => {
    const { root, exec } = await added()
    const result = await drx(['remove', 'nothing'], root, {
      exec,
      ...registryOf(WITHOUT),
    })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('There is no module named "nothing"')
    const offline = await drx(['remove', 'nothing'], root, {
      exec,
      defaultModuleRegistry: `${await closedPort()}/modules.json`,
      cacheDir: tmp('drx-cache-'),
    })
    expect(offline.code).toBe(1)
    expect(offline.stderr).toContain(
      'drx add recorded no module named "nothing" in this project.'
    )
  })

  test('drx add still needs the registry', async () => {
    const root = project()
    const result = await drx(['add', 'breadcrumb'], root, {
      defaultModuleRegistry: `${await closedPort()}/modules.json`,
      cacheDir: tmp('drx-cache-'),
    })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('There is no cached copy to use.')
  })
})

describe('drx add when no part takes what the module needs', () => {
  const parts = (...list: Record<string, unknown>[]) => ({
    'drx.config.json': {
      layout: 'monorepo',
      line: '0.x',
      starter: 'quickstart',
      source: 'npm',
      parts: list,
    },
  })
  const NUXT = { role: 'frontend', kind: 'nuxt', path: 'nuxt' }
  const DRUPAL = { role: 'backend', kind: 'drupal', path: 'drupal' }

  test('refuses when the frontend part is of a kind it has no way to add to', async () => {
    const root = project(
      undefined,
      parts({ role: 'frontend', kind: 'astro', path: 'nuxt' }, DRUPAL)
    )
    const before = snapshot(root)
    const result = await drx(['add', 'blocks', '--json'], root)
    expect(result.code).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: 'refused' },
    })
    expect(result.stderr).toContain(
      'Cannot add blocks: No frontend part of this project can take druxt-blocks. nuxt/ is of the kind astro, which this version cannot add a module to.'
    )
    expect(snapshot(root)).toEqual(before)
  })

  test('refuses when the directory of the frontend part is not there', async () => {
    const root = project(
      undefined,
      parts({ role: 'frontend', kind: 'nuxt', path: 'web' }, DRUPAL)
    )
    const result = await drx(['add', 'blocks'], root)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'Cannot add blocks: No frontend part of this project can take druxt-blocks. web/ does not exist.'
    )
    expect(config(root).modules).toBeUndefined()
  })

  test('--force does not add it either', async () => {
    const root = project(undefined, parts(DRUPAL))
    const result = await drx(['add', 'blocks', '--force'], root)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'Cannot add blocks: No frontend part of this project can take druxt-blocks. The project has no frontend part.'
    )
  })

  test('lists what the module needs of a backend the project does not have', async () => {
    const root = project(undefined, parts(NUXT))
    const { calls, exec } = tools(root)
    const result = await drx(['add', 'breadcrumb'], root, { exec })
    expect(result.code, result.stderr).toBe(0)
    expect(calls).toEqual(['nuxt$ npm install -- druxt-breadcrumb'])
    expect(result.stdout).toBe(
      [
        'Added breadcrumb.',
        '',
        'Left to do:',
        '  breadcrumb needs a backend, and this project has no backend part that can take what it needs. Where the backend is:',
        '    Enable Decoupled Router (decoupled_router)',
        '    Patch Decoupled Router with https://example.com/mr/12.diff (Fix the redirect loop)',
        '',
      ].join('\n')
    )
  })

  test('a dry run lists it too', async () => {
    const root = project(undefined, parts(NUXT))
    const result = await drx(['add', 'auth', '--dry-run', '--json'], root)
    expect(JSON.parse(result.stdout).modules[0].leftToDo).toEqual([
      'auth needs a backend, and this project has no backend part that can take what it needs. Where the backend is:',
      '  Enable Simple OAuth (simple_oauth)',
      '  Simple OAuth: Generate the keys',
      '    drush simple-oauth:generate-keys ../keys',
    ])
  })

  test('says nothing of a backend for a module that needs none', async () => {
    const root = project(undefined, parts(NUXT))
    const result = await drx(['add', 'node-preview', '--force'], root, {
      exec: tools(root).exec,
    })
    expect(result.stdout).toBe('Added node-preview.\n')
  })
})

describe('a file that changes between the plan and the step', () => {
  /** Tools whose install also writes to the config, as a script of it may. */
  const installing = (root: string, write: (source: string) => string) => {
    const { exec } = tools(root)
    const wrapped: CliContext['exec'] = async (command, args, options) => {
      const result = await exec(command, args, options)
      if (command === 'npm') {
        const file = join(root, 'nuxt/nuxt.config.js')
        writeFileSync(file, write(readFileSync(file, 'utf8')))
      }
      return result
    }
    return wrapped
  }

  test('an edit is made to the file as the step finds it', async () => {
    const root = project()
    const result = await drx(['add', 'blocks'], root, {
      exec: installing(root, (source) =>
        source.replace(
          '    localhostListenURL',
          "    'by-the-install',\n    localhostListenURL"
        )
      ),
    })
    expect(result.code, result.stderr).toBe(0)
    const config = read(root, 'nuxt/nuxt.config.js')
    expect(config).toContain("'by-the-install'")
    expect(config).toContain("'druxt-blocks'")
  })

  test('a file that no longer takes the edit fails the step, and the record says what was done', async () => {
    const root = project()
    const result = await drx(['add', 'blocks', '--json'], root, {
      exec: installing(root, () => 'export default () => ({ modules: [] })\n'),
    })
    expect(result.code).toBe(1)
    expect(JSON.parse(result.stdout).error).toMatchObject({
      code: 'step-failed',
      failed: {
        part: 'nuxt',
        step: "Add 'druxt-blocks' to modules in nuxt.config.js",
        exitCode: 1,
        output:
          'nuxt.config.js has changed since it was read, and its modules can no longer be edited safely.',
      },
      done: ['nuxt/: npm install -- druxt-blocks'],
      notDone: [
        "nuxt/: Add 'druxt-blocks' to modules in nuxt.config.js",
        'drupal/: ddev drush en -y -- block',
      ],
    })
    expect(config(root).modules).toEqual([
      {
        name: 'blocks',
        package: 'druxt-blocks',
        frontend: [{ path: 'nuxt', installed: true, listed: false }],
        backend: [],
      },
    ])
  })

  test('the record is added to the config file as it is by then', async () => {
    const root = project()
    const { exec } = tools(root)
    // Something else writes to the file while the tools run.
    const wrapped: CliContext['exec'] = async (command, args, options) => {
      if (command === 'npm') {
        const file = join(root, 'drx.config.json')
        const now = JSON.parse(readFileSync(file, 'utf8'))
        writeFileSync(file, JSON.stringify({ ...now, line: '2.x' }))
      }
      return exec(command, args, options)
    }
    await drx(['add', 'blocks'], root, { exec: wrapped })
    expect(config(root).line).toBe('2.x')
    expect(config(root).modules).toHaveLength(1)
  })
})

describe('a record that names something no tool should be given', () => {
  test('is refused as the file is read, and nothing is run', async () => {
    const root = project()
    const file = join(root, 'drx.config.json')
    const hostile = JSON.parse(readFileSync(file, 'utf8'))
    hostile.modules = [
      {
        name: 'blocks',
        package: 'druxt-blocks',
        frontend: [{ path: 'nuxt', installed: true, listed: true }],
        backend: [
          {
            path: 'drupal',
            modules: [
              {
                name: 'block',
                package: '--working-dir=/',
                enabled: true,
                required: true,
              },
            ],
            patches: [],
          },
        ],
      },
    ]
    writeFileSync(file, JSON.stringify(hostile))
    const before = snapshot(root)
    const result = await drx(['remove', 'blocks', '--backend', '--json'], root)
    expect(result.code).toBe(1)
    expect(JSON.parse(result.stdout).error).toMatchObject({
      code: 'config',
      message: `${file} is invalid: modules[0].backend[0].modules[0].package must be the name of a Composer package, as in vendor/name.`,
    })
    expect(result.stderr).not.toContain('A command was run')
    expect(snapshot(root)).toEqual(before)
  })
})

describe('drx remove in a terminal with no name', () => {
  test('offers what is on the record, in the registry or not', async () => {
    const root = project()
    const { exec } = tools(root)
    await drx(['add', 'breadcrumb', 'blocks'], root, { exec })
    const { prompter, asked } = answering({
      'Which modules?': ['breadcrumb'],
      'Make these changes?': true,
    })
    const result = await run(
      ['remove'],
      {
        cwd: root,
        env: { XDG_CONFIG_HOME: tmp(), NO_COLOR: '1' },
        exec,
        prompter,
        ...registryOf({
          schemaVersion: 1,
          modules: REGISTRY.modules.filter(({ name }) => name !== 'breadcrumb'),
        }),
      },
      { columns: 100 }
    )
    expect(result.code, result.stderr).toBe(0)
    expect(asked[0]?.choices?.map(({ value }) => value)).toEqual([
      'blocks',
      'breadcrumb',
    ])
    expect(result.stdout).toContain('Removed breadcrumb.')
    expect(json(root, 'nuxt/package.json').dependencies).not.toHaveProperty(
      'druxt-breadcrumb'
    )
  })
})
