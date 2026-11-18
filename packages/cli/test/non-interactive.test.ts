import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Prompter } from '../src/context.js'
import { validEngines } from './helpers/engines.js'
import { moduleRegistry } from './helpers/modules.js'
import { run } from './helpers/run.js'
import { serve, type TestServer } from './helpers/server.js'
import { fixtureRegistry, type FixtureRegistry } from './helpers/starter.js'
import { cleanTmp, tmp } from './helpers/tmp.js'

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
