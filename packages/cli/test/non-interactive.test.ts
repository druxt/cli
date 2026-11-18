import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { CliContext, Prompter } from '../src/context.js'
import { validEngines } from './helpers/engines.js'
import { moduleRegistry } from './helpers/modules.js'
import { run } from './helpers/run.js'
import { serve, type TestServer } from './helpers/server.js'
import { fixtureRegistry, type FixtureRegistry } from './helpers/starter.js'
import { cleanTmp, tmp, writeTree } from './helpers/tmp.js'

let modules: TestServer
let starters: FixtureRegistry

beforeEach(async () => {
  vi.stubEnv('XDG_CACHE_HOME', tmp('drx-cache-'))
  vi.stubEnv('GIGET_REGISTRY', undefined)
  vi.stubEnv('GIGET_AUTH', undefined)
  modules = await serve({ '/modules.json': JSON.stringify(moduleRegistry()) })
  starters = await fixtureRegistry(undefined, (entry) => {
    ;(entry.druxt as Record<string, unknown>).engines = validEngines()
  })
})

afterEach(async () => {
  await modules.close()
  await starters.close()
  vi.unstubAllEnvs()
  cleanTmp()
})

/** The four ways a run is told that nobody is there to answer. */
const CONDITIONS = [
  {
    name: '--no-interactive',
    flag: ['--no-interactive'],
    env: {},
    terminal: true,
  },
  {
    name: 'DRX_NO_INTERACTIVE=1',
    flag: [],
    env: { DRX_NO_INTERACTIVE: '1' },
    terminal: true,
  },
  { name: 'CI=true', flag: [], env: { CI: 'true' }, terminal: true },
  { name: 'no terminal', flag: [], env: {}, terminal: false },
] as const

/** Every command and subcommand, with the exit code it has unattended. */
const COMMANDS: { argv: string[]; code: number; says?: string }[] = [
  { argv: [], code: 1, says: 'USAGE drx' },
  { argv: ['--no-banner'], code: 1, says: 'USAGE drx' },
  { argv: ['--help'], code: 0 },
  { argv: ['--version'], code: 0 },
  { argv: ['init'], code: 1, says: 'Pass a directory' },
  { argv: ['init', 'site'], code: 0 },
  { argv: ['init', 'site', '--yes'], code: 0 },
  { argv: ['init', '--yes'], code: 0 },
  { argv: ['init', 'site', '--engine', 'none'], code: 1, says: '--base-url' },
  { argv: ['init', 'site', '--engine', 'php', '--json'], code: 0 },
  { argv: ['info'], code: 0 },
  { argv: ['info', '--json'], code: 0 },
  { argv: ['module'], code: 1, says: 'No command specified' },
  { argv: ['module', 'list'], code: 0 },
  { argv: ['module', '--json', 'list'], code: 0 },
  { argv: ['module', '--refresh', 'search', 'block'], code: 0 },
  { argv: ['module', 'search', 'block'], code: 0 },
  { argv: ['module', 'search'], code: 1, says: 'Give the text to search for' },
  { argv: ['module', 'info', 'blocks'], code: 0 },
  { argv: ['module', 'info'], code: 1, says: 'Give the name of a module' },
  { argv: ['add', 'blocks'], code: 1, says: 'works inside a project' },
  { argv: ['add'], code: 1, says: 'works inside a project' },
  { argv: ['remove', 'blocks'], code: 1, says: 'works inside a project' },
  {
    argv: ['module', 'add', 'blocks'],
    code: 1,
    says: 'works inside a project',
  },
  {
    argv: ['module', 'remove', 'blocks'],
    code: 1,
    says: 'works inside a project',
  },
  {
    argv: ['module', 'configure', 'blocks'],
    code: 1,
    says: 'not available yet',
  },
]

describe.each(CONDITIONS)('with $name', (condition) => {
  test.each(COMMANDS)(
    'drx $argv asks nothing',
    async ({ argv, code, says }) => {
      const ask = vi.fn(() => {
        throw new Error('A prompt was shown.')
      })
      const prompter = {
        text: ask,
        select: ask,
        search: ask,
        confirm: ask,
      } as unknown as Prompter
      const cwd = tmp('drx-cwd-')

      const result = await run(
        [...argv, ...condition.flag],
        {
          cwd,
          env: { XDG_CONFIG_HOME: tmp('drx-config-'), ...condition.env },
          defaultRegistry: starters.url,
          defaultModuleRegistry: `${modules.url}/modules.json`,
          prompter,
          findCommand: () => undefined,
        },
        condition.terminal ? { columns: 100 } : undefined
      )

      expect(ask).not.toHaveBeenCalled()
      expect(result.stderr).not.toContain('A prompt was shown.')
      expect(result.raw.stderr).not.toContain('█')
      expect(result.code, result.stderr).toBe(code)
      if (says) expect(result.stderr).toContain(says)
      if (argv[0] === 'init' && code === 0) {
        const dir = argv.includes('site') ? 'site' : 'my-druxt-site'
        expect(existsSync(join(cwd, dir, 'drx.config.json'))).toBe(true)
      }
    }
  )
})

/** A project with one frontend and one backend part, and nothing added. */
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
        { role: 'backend', kind: 'drupal', path: 'drupal', engine: 'ddev' },
      ],
    },
    'nuxt/package.json': { dependencies: { druxt: '^0.25.1' } },
    'nuxt/node_modules/druxt/package.json': { version: '0.25.2' },
    'nuxt/nuxt.config.js': 'export default {\n  modules: [],\n}\n',
    'drupal/composer.json': { require: { 'drupal/core-recommended': '~11' } },
  })
  return root
}

/** Stand-ins for the tools: a package manager and a backend with a memory. */
function tools() {
  const calls: string[] = []
  const enabled = new Set<string>()
  const exec: CliContext['exec'] = async (command, args, { cwd }) => {
    if (args.includes('pm:list')) {
      const list = [...enabled].map((name) => [name, { name, path: '' }])
      return { code: 0, output: JSON.stringify(Object.fromEntries(list)) }
    }
    const name = args.at(-1) as string
    if (args.includes('--simulate')) {
      return enabled.has(name)
        ? {
            code: 0,
            output: `The following extensions will be uninstalled: ${name}\n`,
          }
        : { code: 1, output: `not installed: ${name}` }
    }
    calls.push(`${command} ${args.join(' ')}`)
    if (command === 'npm') {
      const file = join(cwd, 'package.json')
      const manifest = JSON.parse(readFileSync(file, 'utf8'))
      if (args[0] === 'install') manifest.dependencies[name] = '^1.0.0'
      else delete manifest.dependencies[name]
      writeFileSync(file, JSON.stringify(manifest, null, 2))
    }
    if (args.includes('en')) enabled.add(name)
    if (args.includes('pmu')) enabled.delete(name)
    return { code: 0, output: '' }
  }
  return { calls, exec }
}

describe.each(CONDITIONS)(
  'adding and removing a module with $name',
  (condition) => {
    const ask = vi.fn(() => {
      throw new Error('A prompt was shown.')
    })
    const unattended = (
      argv: string[],
      cwd: string,
      exec: CliContext['exec']
    ) =>
      run(
        [...argv, ...condition.flag],
        {
          cwd,
          env: { XDG_CONFIG_HOME: tmp('drx-config-'), ...condition.env },
          defaultModuleRegistry: `${modules.url}/modules.json`,
          prompter: {
            text: ask,
            select: ask,
            search: ask,
            pickMany: ask,
            confirm: ask,
          } as unknown as Prompter,
          exec,
        },
        condition.terminal ? { columns: 100 } : undefined
      )
    const recorded = (root: string) =>
      JSON.parse(readFileSync(join(root, 'drx.config.json'), 'utf8')).modules

    // Braces, so the mock is not handed back to be called as a cleanup.
    beforeEach(() => {
      ask.mockClear()
    })

    test('drx add and drx remove run to the end and ask nothing', async () => {
      const root = project()
      const { calls, exec } = tools()
      const added = await unattended(['add', 'blocks'], root, exec)
      expect(added.code, added.stderr).toBe(0)
      expect(added.stdout).toBe('Added blocks.\n')
      expect(recorded(root)).toHaveLength(1)
      expect(readFileSync(join(root, 'nuxt/nuxt.config.js'), 'utf8')).toContain(
        'druxt-blocks'
      )

      const removed = await unattended(
        ['remove', 'blocks', '--backend'],
        root,
        exec
      )
      expect(removed.code, removed.stderr).toBe(0)
      expect(removed.stdout).toBe('Removed blocks.\n')
      expect(recorded(root)).toBeUndefined()
      expect(calls).toEqual([
        'npm install -- druxt-blocks',
        'ddev drush en -y -- block',
        'npm uninstall -- druxt-blocks',
        'ddev drush pmu -y -- block',
      ])
      expect(ask).not.toHaveBeenCalled()
      expect(added.stderr + removed.stderr).not.toContain('A prompt was shown.')
    })

    test('drx module add --json prints one document and asks nothing', async () => {
      const root = project()
      const result = await unattended(
        ['module', 'add', 'blocks', '--json'],
        root,
        tools().exec
      )
      expect(result.code, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true,
        dryRun: false,
        modules: [{ name: 'blocks', package: 'druxt-blocks' }],
      })
      expect(ask).not.toHaveBeenCalled()
    })

    test.each([
      [['add'], 'Give the name of a module, as in "drx add blocks".'],
      [['remove'], 'Give the name of a module, as in "drx remove blocks".'],
      [['remove', 'blocks'], 'Cannot remove blocks: druxt-blocks is not in'],
      [['add', 'legacy'], 'Cannot add legacy: legacy is archived.'],
    ])('drx %j fails with a message, and asks nothing', async (argv, says) => {
      const result = await unattended(argv, project(), tools().exec)
      expect(result.code).toBe(1)
      expect(result.stderr).toContain(says)
      expect(ask).not.toHaveBeenCalled()
    })
  }
)

describe('an option given before the command of a group', () => {
  const unattended = (argv: string[]) =>
    run(argv, {
      cwd: tmp('drx-cwd-'),
      env: { XDG_CONFIG_HOME: tmp('drx-config-') },
      defaultModuleRegistry: `${modules.url}/modules.json`,
      now: () => new Date('2026-11-18T00:00:00Z'),
    })

  test.each([
    [
      ['module', '--json', 'list'],
      ['module', 'list', '--json'],
    ],
    [
      ['module', '--json', 'search', 'block'],
      ['module', 'search', 'block', '--json'],
    ],
    [
      ['module', '--json', 'info', 'blocks'],
      ['module', 'info', 'blocks', '--json'],
    ],
    [
      ['module', '--json', '--refresh', 'list', '--all'],
      ['module', 'list', '--all', '--json', '--refresh'],
    ],
  ])('drx %j is drx %j', async (before, after) => {
    const [first, second] = [await unattended(before), await unattended(after)]
    expect(first.code, first.stderr).toBe(0)
    expect(JSON.parse(first.stdout)).toEqual(JSON.parse(second.stdout))
    expect(first.stdout).toBe(second.stdout)
  })

  test('drx module --module-registry <url> list reads that registry', async () => {
    const other = await serve({
      '/other.json': JSON.stringify({
        schemaVersion: 1,
        modules: [moduleRegistry().modules[1]],
      }),
    })
    try {
      const url = `${other.url}/other.json`
      for (const form of [
        ['module', '--module-registry', url, 'list'],
        ['module', `--module-registry=${url}`, 'list'],
        ['module', '--module-registry', url, '--json', 'list'],
      ]) {
        const before = await unattended(form)
        const after = await unattended([
          'module',
          'list',
          '--module-registry',
          url,
          ...(form.includes('--json') ? ['--json'] : []),
        ])
        expect(before.code, before.stderr).toBe(0)
        expect(before.stdout).toBe(after.stdout)
        expect(before.stdout).toContain('blocks')
        expect(before.stdout).not.toContain('druxt-auth')
        expect(before.stderr).toContain(url)
      }
    } finally {
      await other.close()
    }
  })

  test('drx module add takes its registry and --json from before the command', async () => {
    const other = await serve({
      '/other.json': JSON.stringify({
        schemaVersion: 1,
        modules: [moduleRegistry().modules[1]],
      }),
    })
    try {
      const url = `${other.url}/other.json`
      const result = await run(
        ['module', '--module-registry', url, '--json', 'add', 'blocks'],
        {
          cwd: project(),
          defaultModuleRegistry: `${modules.url}/modules.json`,
          exec: tools().exec,
        }
      )
      expect(result.code, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout).modules[0].name).toBe('blocks')
      expect(other.requests).toHaveLength(1)
      expect(modules.requests).toHaveLength(0)
    } finally {
      await other.close()
    }
  })

  test('an option the command does not have is refused, wherever it is', async () => {
    const result = await unattended(['module', '--bogus', 'list'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Unknown option --bogus')
  })

  test('a failure with --json before the command is still JSON', async () => {
    const result = await unattended(['module', '--json', 'info', 'nothing'])
    expect(result.code).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: 'unknown-module' },
    })
  })
})

describe('drx init with no directory says why it did not ask', () => {
  const TAIL =
    ' Pass a directory, as in "drx init my-site", or --yes to use the default of the starter.'
  test.each([
    [
      '--no-interactive',
      ['--no-interactive'],
      {},
      true,
      'No directory was given, and --no-interactive turns the questions off.',
    ],
    [
      'DRX_NO_INTERACTIVE=1',
      [],
      { DRX_NO_INTERACTIVE: '1' },
      true,
      'No directory was given, and DRX_NO_INTERACTIVE turns the questions off.',
    ],
    [
      'CI=true',
      [],
      { CI: 'true' },
      true,
      'No directory was given, and CI turns the questions off.',
    ],
    [
      '--json',
      ['--json'],
      {},
      true,
      'No directory was given, and nothing is asked with --json.',
    ],
    [
      'no terminal',
      [],
      {},
      false,
      'No directory was given and there is no terminal to ask on.',
    ],
    [
      'no terminal and DRX_NO_INTERACTIVE=1',
      [],
      { DRX_NO_INTERACTIVE: '1' },
      false,
      'No directory was given and there is no terminal to ask on.',
    ],
  ] as const)('with %s', async (_name, flag, env, terminal, message) => {
    const result = await run(
      ['init', ...flag],
      {
        cwd: tmp('drx-cwd-'),
        env: { XDG_CONFIG_HOME: tmp('drx-config-'), ...env },
        defaultRegistry: starters.url,
      },
      terminal ? { columns: 100 } : undefined
    )
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(`Error: ${message}${TAIL}`)
  })
})

describe('--no-interactive', () => {
  test('goes before or after the command, and with --yes', async () => {
    for (const argv of [
      ['--no-interactive', 'init', '--yes'],
      ['init', '--no-interactive', '--yes'],
      ['init', '--yes', '--no-interactive'],
    ]) {
      const cwd = tmp('drx-cwd-')
      const result = await run(
        argv,
        { cwd, defaultRegistry: starters.url },
        { columns: 100 }
      )
      expect(result.code, argv.join(' ')).toBe(0)
      expect(existsSync(join(cwd, 'my-druxt-site'))).toBe(true)
    }
  })

  test.each(['0', 'false', ''])(
    'DRX_NO_INTERACTIVE=%j leaves a terminal interactive',
    async (value) => {
      const ask = vi.fn(async () => 'quit')
      const result = await run(
        [],
        {
          env: { XDG_CONFIG_HOME: tmp(), DRX_NO_INTERACTIVE: value },
          prompter: { select: ask } as unknown as Prompter,
        },
        { columns: 100 }
      )
      expect(result.code).toBe(0)
      expect(ask).toHaveBeenCalledOnce()
    }
  )
})
