import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { CliContext } from '../../src/context.js'
import { cliVersion } from '../../src/package-root.js'
import { WORDMARK } from '../../src/presentation.js'
import { moduleRegistry } from '../helpers/modules.js'
import { answering } from '../helpers/prompter.js'
import { run } from '../helpers/run.js'
import { serve, type TestServer } from '../helpers/server.js'
import { fixtureRegistry, type FixtureRegistry } from '../helpers/starter.js'
import { cleanTmp, tmp, writeTree } from '../helpers/tmp.js'

const MENU = 'What would you like to do?'
const BLUE = '\u001B[38;2;52;152;219m'
const GREEN = '\u001B[38;2;65;184;131m'
const RESET = '\u001B[39m'
const ART = WORDMARK.split('\n')[0] as string

let modules: TestServer
let starters: FixtureRegistry

beforeEach(async () => {
  vi.stubEnv('XDG_CACHE_HOME', tmp('drx-cache-'))
  vi.stubEnv('GIGET_REGISTRY', undefined)
  vi.stubEnv('GIGET_AUTH', undefined)
  modules = await serve({ '/modules.json': JSON.stringify(moduleRegistry()) })
  starters = await fixtureRegistry()
})

afterEach(async () => {
  await modules.close()
  await starters.close()
  vi.unstubAllEnvs()
  cleanTmp()
})

/** Bare `drx`, or any command, in a terminal with colour off. */
const terminal = (
  argv: string[],
  answers: Record<string, unknown>,
  overrides: Partial<CliContext> = {},
  options: { cancelAt?: number } = {}
) => {
  const { prompter, asked } = answering(answers, options)
  return run(
    argv,
    {
      env: { XDG_CONFIG_HOME: tmp('drx-config-'), NO_COLOR: '1' },
      defaultModuleRegistry: `${modules.url}/modules.json`,
      defaultRegistry: starters.url,
      nodeVersion: '16.18.1',
      prompter,
      ...overrides,
    },
    { columns: 100 }
  ).then((result) => ({ ...result, asked }))
}

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
    'nuxt/package.json': { dependencies: { nuxt: '2.15.8' } },
  })
  return root
}

describe('bare drx with no terminal', () => {
  test('prints the usage and asks nothing', async () => {
    const { prompter, asked } = answering({})
    const result = await run([], { prompter })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('USAGE drx')
    expect(result.stderr).not.toContain('█')
    expect(asked).toEqual([])
  })
})

describe('bare drx in a terminal, outside a project', () => {
  test('draws the wordmark, says there is no project and offers to create a site', async () => {
    const cwd = tmp()
    const result = await terminal([], { [MENU]: 'quit' }, { cwd })
    expect(result.code).toBe(0)
    expect(result.stderr.startsWith(`\n${WORDMARK}\n`)).toBe(true)
    expect(result.stderr).toContain(`No Druxt project in ${cwd}.`)
    expect(result.asked).toEqual([
      {
        message: MENU,
        choices: [
          { value: 'init', label: 'Create a site' },
          { value: 'quit', label: 'Quit' },
        ],
      },
    ])
    expect(result.stdout).toBe('')
  })

  test('runs init from the menu, with the wordmark drawn once', async () => {
    const cwd = tmp()
    const result = await terminal(
      [],
      {
        [MENU]: 'init',
        'Where should the site be created?': 'from-menu',
        'Which layout?': 'monorepo',
        'Install its dependencies now?': false,
        'Create the site?': true,
      },
      { cwd }
    )
    expect(result.code).toBe(0)
    expect(existsSync(join(cwd, 'from-menu', 'drx.config.json'))).toBe(true)
    expect(result.stderr.split(ART)).toHaveLength(2)
    expect(result.stderr).toContain('Repeat this with: drx init from-menu ')
  })

  test('--no-banner leaves the small header', async () => {
    const result = await terminal(['--no-banner'], { [MENU]: 'quit' })
    expect(result.code).toBe(0)
    expect(result.stderr).not.toContain('█')
    expect(result.stderr.startsWith(`◆ druxt ${cliVersion()}\n`)).toBe(true)
  })

  test('exits with one line when the menu is cancelled', async () => {
    const result = await terminal([], {}, {}, { cancelAt: 0 })
    expect(result.code).toBe(1)
    expect(result.stderr.trimEnd().split('\n').at(-1)).toBe(
      '✖ Error: Cancelled.'
    )
  })
})

describe('bare drx in a terminal, inside a project', () => {
  test('says what the project is and lists what can be done, built or not', async () => {
    const cwd = project()
    const result = await terminal([], { [MENU]: 'quit' }, { cwd })
    expect(result.stderr).toContain(
      [
        `Project  ${cwd}`,
        '  quickstart starter, monorepo layout, 0.x',
        '  frontend  nuxt  nuxt/',
        '  backend  drupal  drupal/  ddev engine',
        '',
      ].join('\n')
    )
    const unavailable = { hint: 'not available yet', disabled: true }
    expect(result.asked[0]?.choices).toEqual([
      { value: 'list', label: 'List the modules' },
      { value: 'search', label: 'Search the modules' },
      { value: 'show', label: "View a module's details" },
      { value: 'info', label: "View this project's details" },
      { value: 'add', label: 'Add a module' },
      { value: 'remove', label: 'Remove a module' },
      { value: 'configure', label: 'Configure a module', ...unavailable },
      { value: 'patches', label: 'Manage patches', ...unavailable },
      { value: 'quit', label: 'Quit' },
    ])
  })

  test('lists the modules, as drx module list does, and says how to repeat it', async () => {
    const cwd = project()
    const menu = await terminal([], { [MENU]: 'list' }, { cwd })
    const direct = await terminal(['module', 'list'], {}, { cwd })
    expect(menu.code).toBe(0)
    expect(menu.stdout).toBe(direct.stdout)
    expect(menu.stdout).toContain('blocks')
    expect(menu.stderr.trimEnd().split('\n').at(-1)).toBe(
      'Repeat this with: drx module list'
    )
  })

  test('searches the modules for what is typed', async () => {
    const result = await terminal(
      [],
      { [MENU]: 'search', 'Search for what?': 'unsaved content' },
      { cwd: project() }
    )
    expect(result.stdout).toContain('node-preview')
    expect(result.stdout).not.toContain('blocks')
    expect(result.stderr).toContain(
      "Repeat this with: drx module search 'unsaved content'"
    )
  })

  test('shows a module picked from a list', async () => {
    const result = await terminal(
      [],
      { [MENU]: 'show', 'Which module?': 'blocks' },
      { cwd: project() }
    )
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('Package     druxt-blocks')
    expect(result.stderr).toContain('Repeat this with: drx module info blocks')
  })

  test('shows the project, as drx info does', async () => {
    const cwd = project()
    const menu = await terminal([], { [MENU]: 'info' }, { cwd })
    const direct = await terminal(['info'], {}, { cwd })
    expect(menu.stdout).toBe(direct.stdout)
    expect(menu.stderr).toContain('Repeat this with: drx info')
  })

  test('adds the modules picked from a list, as drx add does', async () => {
    const cwd = project()
    writeTree(cwd, {
      'nuxt/nuxt.config.js': 'export default { modules: [] }\n',
    })
    const calls: string[] = []
    const result = await terminal(
      [],
      {
        [MENU]: 'add',
        'Which modules?': ['blocks'],
        'Make these changes?': true,
      },
      {
        cwd,
        exec: async (command, args) => {
          calls.push([command, ...args].join(' '))
          return { code: 0, output: '' }
        },
      }
    )
    expect(result.code).toBe(0)
    expect(calls[0]).toBe('npm install -- druxt-blocks')
    expect(result.stdout).toContain('Added blocks.')
    expect(result.stderr).toContain('Repeat this with: drx add blocks --yes')
  })

  test('offers to remove only what the project has', async () => {
    const result = await terminal([], { [MENU]: 'remove' }, { cwd: project() })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'There is no module to remove in this project.'
    )
  })

  test.each(['configure', 'patches'])(
    'says %s is not available yet if it is chosen all the same',
    async (choice) => {
      const result = await terminal([], { [MENU]: choice }, { cwd: project() })
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('is not available yet')
    }
  )
})

describe('drx module with no subcommand', () => {
  test('in a terminal is a searchable list that shows the module picked', async () => {
    const result = await terminal(['module'], { 'Which module?': 'auth' })
    expect(result.code).toBe(0)
    expect(result.asked[0]?.choices?.slice(0, 3)).toEqual([
      {
        value: 'auth',
        label: 'auth',
        hint: 'druxt-auth. Authentication module for DruxtJS',
      },
      {
        value: 'blocks',
        label: 'blocks',
        hint: 'druxt-blocks. Drupal Blocks, Block Regions and more',
      },
      {
        value: 'ckeditor',
        label: 'ckeditor',
        hint: 'not published. Render CKEditor content with components',
      },
    ])
    expect(result.asked[0]?.choices?.map(({ value }) => value)).not.toContain(
      'legacy'
    )
    expect(result.stdout).toContain('Package     druxt-auth')
    expect(result.stderr.trimEnd().split('\n').at(-1)).toBe(
      'Repeat this with: drx module info auth'
    )
    expect(result.stderr.startsWith(`◆ druxt ${cliVersion()}\n`)).toBe(true)
  })

  test('with no terminal fails and asks nothing', async () => {
    const { prompter, asked } = answering({})
    const result = await run(['module'], { prompter })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('No command specified')
    expect(asked).toEqual([])
  })

  test('with --json fails as JSON and asks nothing', async () => {
    const result = await terminal(['module', '--json'], {})
    expect(result.code).toBe(1)
    expect(result.asked).toEqual([])
    expect(JSON.parse(result.stdout).error.code).toBe('usage')
  })
})

describe('the look of a command in a terminal', () => {
  test('a command that prints a report starts with the small header', async () => {
    const cwd = project()
    for (const argv of [
      ['info'],
      ['module', 'list'],
      ['module', 'info', 'blocks'],
    ]) {
      const result = await terminal(argv, {}, { cwd })
      expect(
        result.stderr.startsWith(`◆ druxt ${cliVersion()}\n`),
        argv.join(' ')
      ).toBe(true)
      expect(result.stderr).not.toContain('█')
    }
  })

  test('--version and --help print neither header nor wordmark', async () => {
    for (const argv of [['--version'], ['--help'], ['info', '--help']]) {
      const result = await terminal(argv, {})
      expect(result.stderr).toBe('')
      expect(result.stdout).not.toContain('█')
    }
  })

  test('a part is in the colour of its role, and still says its role', async () => {
    const result = await terminal(
      ['info'],
      {},
      {
        cwd: project(),
        env: { XDG_CONFIG_HOME: tmp('drx-config-'), COLORTERM: 'truecolor' },
      }
    )
    expect(result.raw.stdout).toContain(`${GREEN}frontend  nuxt  nuxt/${RESET}`)
    expect(result.raw.stdout).toContain(
      `${BLUE}backend  drupal  drupal/${RESET}`
    )
  })

  test('nothing is coloured with NO_COLOR', async () => {
    const result = await terminal(['info'], {}, { cwd: project() })
    expect(result.raw.stdout).toBe(result.stdout)
    expect(result.raw.stderr).toBe(result.stderr)
  })
})

describe('--json in a terminal, with the banner settings at their defaults', () => {
  test.each([
    [['info', '--json']],
    [['module', 'list', '--json']],
    [['module', 'list', '--all', '--type', 'contrib', '--json']],
    [['module', 'search', 'block', '--json']],
    [['module', 'info', 'blocks', '--json']],
    [['module', 'info', 'nothing-like-it', '--json']],
    [['add', 'blocks', '--dry-run', '--json']],
    [['module', 'add', 'blocks', '--dry-run', '--json']],
    [['remove', 'blocks', '--dry-run', '--json']],
    [['add', '--json']],
    [['module', 'configure', 'blocks', '--json']],
    [['module', '--json']],
    [['init', 'site', '--yes', '--json']],
    [['init', 'site', '--json']],
    [['init', '--json']],
    [['init', 'site', '--yes', '--layout', 'split', '--json']],
    [['init', 'site', '--yes', '--setup', '--json']],
    [['info', '--json', '--unknown']],
  ])('drx %j prints one JSON document on stdout', async (argv) => {
    for (const cwd of [tmp(), project()]) {
      const result = await terminal(
        argv,
        {},
        {
          cwd,
          env: { XDG_CONFIG_HOME: tmp('drx-config-'), COLORTERM: 'truecolor' },
        }
      )
      expect(result.asked).toEqual([])
      expect(
        () => JSON.parse(result.raw.stdout),
        result.raw.stdout
      ).not.toThrow()
      expect(result.raw.stderr).not.toContain('█')
      expect(result.raw.stderr).not.toContain('\u001B[')
    }
  })
})
