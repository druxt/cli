import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Choice, CliContext, Prompter } from '../../src/context.js'
import { validEngines } from '../helpers/engines.js'
import { run } from '../helpers/run.js'
import {
  fixtureRegistry,
  STARTER_FILES,
  type FixtureRegistry,
} from '../helpers/starter.js'
import { cleanTmp, tmp } from '../helpers/tmp.js'

const FILES = {
  ...STARTER_FILES,
  '.env.example':
    '# Backend\nBASE_URL=http://template.example\nOAUTH_CLIENT_ID=\n',
  'drupal/Makefile': 'build:\n',
  'drupal/.devtools/start': '#!/bin/sh\n',
  'drupal/.ddev/config.yaml': 'name: fixture\n',
  'drupal/.ddev/commands/web/drupal-install': '#!/bin/sh\n',
  'drupal/.lando.yml': 'name: fixture\n',
}

let registry: FixtureRegistry
let cwd: string

type Druxt = Record<string, unknown>
const withEngines = (druxt: Druxt) => {
  druxt.engines = validEngines()
  druxt.backendUrl = {
    file: '.env',
    template: '.env.example',
    variable: 'BASE_URL',
  }
}
const serve = async (change: (druxt: Druxt) => void = withEngines) => {
  await registry?.close()
  registry = await fixtureRegistry(FILES, (entry) =>
    change(entry.druxt as Druxt)
  )
}

beforeEach(async () => {
  vi.stubEnv('XDG_CACHE_HOME', tmp('drx-cache-'))
  vi.stubEnv('GIGET_REGISTRY', undefined)
  vi.stubEnv('GIGET_AUTH', undefined)
  await serve()
  cwd = tmp('drx-cwd-')
})

afterEach(async () => {
  await registry.close()
  vi.unstubAllEnvs()
  cleanTmp()
})

const on = (present: string[]) => (name: string) =>
  present.includes(name) ? `/usr/bin/${name}` : undefined
const everything = on(['php', 'composer', 'ddev', 'lando'])

const init = (argv: string[], overrides: Partial<CliContext> = {}) =>
  run(['init', 'site', ...argv, '--registry', registry.url], {
    cwd,
    nodeVersion: '16.18.1',
    findCommand: everything,
    ...overrides,
  })

const site = (...path: string[]) => join(cwd, 'site', ...path)
const has = (...path: string[]) => existsSync(site(...path))
const config = () => JSON.parse(readFileSync(site('drx.config.json'), 'utf8'))
const backend = () =>
  config().parts.find((part: { role: string }) => part.role === 'backend')

/** A prompter that answers by message and records the choices it showed. */
function answering(answers: Record<string, unknown>) {
  const asked: { message: string; choices?: Choice<string>[] }[] = []
  const answer = (message: string, choices?: Choice<string>[]) => {
    asked.push(choices ? { message, choices } : { message })
    if (!(message in answers)) throw new Error(`Unexpected prompt: ${message}`)
    return answers[message]
  }
  const prompter: Prompter = {
    search: async ({ message, choices }) => answer(message, choices) as never,
    pickMany: async ({ message, choices }) => answer(message, choices) as never,
    text: async ({ message }) => answer(message) as string,
    select: async ({ message, choices }) => answer(message, choices) as never,
    confirm: async ({ message }) => answer(message) as boolean,
  }
  return { prompter, asked }
}

describe('drx init --engine', () => {
  test('keeps the chosen engine and removes the files of the others', async () => {
    const result = await init(['--yes', '--engine', 'ddev'])
    expect(result.code).toBe(0)
    expect(has('drupal/.ddev/config.yaml')).toBe(true)
    expect(has('drupal/.ddev/commands/web/drupal-install')).toBe(true)
    expect(has('drupal/.devtools')).toBe(false)
    expect(has('drupal/Makefile')).toBe(false)
    expect(has('drupal/.lando.yml')).toBe(false)
    expect(has('drupal/composer.json')).toBe(true)
    expect(result.stderr).toContain(
      'Removed the files of the engines not chosen: drupal/.devtools, drupal/Makefile, drupal/.lando.yml.'
    )
  })

  test('keeps a path the chosen engine shares, inside a directory it does not', async () => {
    const result = await init(['--yes', '--engine', 'lando'])
    expect(result.code).toBe(0)
    expect(has('drupal/.lando.yml')).toBe(true)
    expect(has('drupal/.ddev/commands/web/drupal-install')).toBe(true)
    expect(has('drupal/.ddev/config.yaml')).toBe(false)
    expect(has('drupal/.devtools')).toBe(false)
  })

  test('records the engine and its database on the backend part', async () => {
    await init(['--yes', '--engine', 'ddev'])
    expect(config().parts).toEqual([
      { role: 'frontend', kind: 'nuxt', path: 'nuxt' },
      {
        role: 'backend',
        kind: 'drupal',
        path: 'drupal',
        engine: 'ddev',
        database: 'mariadb',
      },
    ])
  })

  test('writes the URL the engine serves at where the starter reads it', async () => {
    const result = await init(['--yes', '--engine', 'ddev'])
    expect(readFileSync(site('.env'), 'utf8')).toBe(
      '# Backend\nBASE_URL=http://fixture.ddev.site\nOAUTH_CLIENT_ID=\n'
    )
    expect(result.stderr).toContain(
      'Wrote BASE_URL=http://fixture.ddev.site to .env.'
    )
  })

  test('writes no URL for an engine that has none of its own', async () => {
    await init(['--yes', '--engine', 'php'])
    expect(has('.env')).toBe(false)
  })

  test('prints what the engine needs, its steps and its notes', async () => {
    const result = await init(['--yes', '--engine', 'ddev'])
    expect(result.stdout).toBe(
      [
        `Created a Druxt site in ${site()} from the quickstart starter.`,
        '',
        'It needs:',
        '  Node 16.18.1',
        '  DDEV',
        '',
        'Next:',
        '  cd site',
        '  npm run setup',
        '  cd drupal',
        '  ddev start',
        '  ddev drupal-install',
        '  cd ..',
        '  npm run dev',
        '',
        'Note:',
        '  Copy the printed OAUTH_CLIENT_ID into .env.',
        '',
      ].join('\n')
    )
  })

  test('--json has the engine, the database and what was removed', async () => {
    const result = await init(['--yes', '--engine', 'ddev', '--json'])
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      engine: 'ddev',
      database: 'mariadb',
      baseUrl: null,
      removed: ['drupal/.devtools', 'drupal/Makefile', 'drupal/.lando.yml'],
      notes: ['Copy the printed OAUTH_CLIENT_ID into .env.'],
      next: [
        'cd site',
        'npm run setup',
        'cd drupal',
        'ddev start',
        'ddev drupal-install',
        'cd ..',
        'npm run dev',
      ],
      commands: {
        satisfied: true,
        alternatives: [['ddev']],
        found: ['ddev'],
        missing: [],
      },
    })
  })

  test('fails on an engine the starter does not offer, naming the ones it does', async () => {
    const result = await init(['--yes', '--engine', 'docker'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'The quickstart starter has no engine named "docker". It offers: php, ddev, lando, none.'
    )
    expect(has()).toBe(false)
  })

  test('--keep-engines removes nothing', async () => {
    const result = await init(['--yes', '--engine', 'ddev', '--keep-engines'])
    expect(result.code).toBe(0)
    expect(has('drupal/.devtools/start')).toBe(true)
    expect(has('drupal/.lando.yml')).toBe(true)
    expect(result.stderr).not.toContain('Removed')
    expect(backend().engine).toBe('ddev')
  })
})

describe('drx init --database', () => {
  test('records a database the engine offers', async () => {
    await init(['--yes', '--engine', 'php', '--database', 'mysql'])
    expect(backend()).toMatchObject({ engine: 'php', database: 'mysql' })
  })

  test('defaults to the first the engine offers', async () => {
    await init(['--yes', '--engine', 'php'])
    expect(backend().database).toBe('sqlite')
  })

  test('fails on one the engine does not offer, naming the ones it does', async () => {
    const result = await init([
      '--yes',
      '--engine',
      'php',
      '--database',
      'oracle',
    ])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'The php engine of the quickstart starter has no database named "oracle". It offers: sqlite, mysql.'
    )
  })

  test('fails for an engine with no databases to choose from', async () => {
    const result = await init([
      '--yes',
      '--engine',
      'lando',
      '--database',
      'mariadb',
    ])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'The lando engine of the quickstart starter offers no choice of database.'
    )
    await init(['--yes', '--engine', 'lando', '--force'])
    expect(backend()).toEqual({
      role: 'backend',
      kind: 'drupal',
      path: 'drupal',
      engine: 'lando',
    })
  })
})

describe('drx init --engine none', () => {
  const URL = 'https://example.com'

  test('points the site at the backend and removes the files of every engine', async () => {
    const result = await init(['--yes', '--engine', 'none', '--base-url', URL])
    expect(result.code).toBe(0)
    for (const path of ['.devtools', 'Makefile', '.ddev', '.lando.yml']) {
      expect(has('drupal', path), path).toBe(false)
    }
    expect(has('drupal/composer.json')).toBe(true)
    expect(readFileSync(site('.env'), 'utf8')).toBe(
      `# Backend\nBASE_URL=${URL}\nOAUTH_CLIENT_ID=\n`
    )
    expect(backend()).toEqual({
      role: 'backend',
      kind: 'drupal',
      path: 'drupal',
      engine: 'none',
      baseUrl: URL,
    })
  })

  test('prints the steps of the starter and checks no commands', async () => {
    const findCommand = vi.fn()
    const result = await init(
      ['--yes', '--engine', 'none', '--base-url', URL],
      {
        findCommand,
      }
    )
    expect(findCommand).not.toHaveBeenCalled()
    expect(result.stderr).not.toContain('Warning')
    expect(result.stdout).toBe(
      [
        `Created a Druxt site in ${site()} from the quickstart starter.`,
        '',
        'It needs:',
        '  Node 16.18.1',
        `  A backend that exists already, at ${URL}`,
        '',
        'Next:',
        '  cd site',
        '  npm run setup',
        '  npm run dev',
        '',
      ].join('\n')
    )
  })

  test('fails without --base-url when there is nobody to ask', async () => {
    const result = await init(['--yes', '--engine', 'none'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      '--engine none needs --base-url, the URL of the backend that exists already.'
    )
    expect(has()).toBe(false)
  })

  test.each(['example.com', 'ftp://example.com', ''])(
    'fails on --base-url %j before reading anything',
    async (url) => {
      const result = await init([
        '--yes',
        '--engine',
        'none',
        `--base-url=${url}`,
      ])
      expect(result.code).toBe(1)
      expect(result.stderr).toMatch(
        /--base-url (must be an http or https URL|needs a value)/
      )
      expect(registry.requests).toEqual([])
    }
  )

  test('fails on --base-url with another engine', async () => {
    const result = await init(['--yes', '--engine', 'ddev', '--base-url', URL])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      '--base-url goes with --engine none. The ddev engine serves the backend itself.'
    )
  })

  test('fails on --database', async () => {
    const result = await init([
      '--yes',
      '--engine',
      'none',
      '--base-url',
      URL,
      '--database',
      'sqlite',
    ])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      '--database does not go with --engine none. The backend has its database already.'
    )
  })

  test('is offered by a starter that lists no engines', async () => {
    await serve(() => {})
    const result = await init(['--yes', '--engine', 'none', '--base-url', URL])
    expect(result.code).toBe(0)
    expect(backend()).toMatchObject({ engine: 'none', baseUrl: URL })
    expect(result.stderr).toContain(
      `Warning: The quickstart starter does not say where it reads its backend URL from. Point it at ${URL} yourself.`
    )
    expect(has('drupal/.ddev/config.yaml')).toBe(true)
  })

  test('is the only engine of a starter that lists none', async () => {
    await serve(() => {})
    const result = await init(['--yes', '--engine', 'ddev'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'The quickstart starter has no engine named "ddev". It offers: none.'
    )
  })
})

describe('drx init with no engine named', () => {
  test('takes the first engine whose commands are all present', async () => {
    await init(['--yes'], { findCommand: on(['php', 'lando']) })
    expect(backend().engine).toBe('lando')
  })

  test('takes the first engine of the starter when none is present, and warns of its commands only', async () => {
    const result = await init([], { findCommand: on(['composer']) })
    expect(result.code).toBe(0)
    expect(backend().engine).toBe('php')
    expect(result.stderr.match(/Warning/g)).toHaveLength(1)
    expect(result.stderr).toContain(
      'Warning: The php engine needs php and composer. Not found on PATH: php. Install what is missing before you set up the site.'
    )
  })

  test('records no engine for a starter that lists none', async () => {
    await serve(() => {})
    await init(['--yes'])
    expect(backend()).toEqual({
      role: 'backend',
      kind: 'drupal',
      path: 'drupal',
    })
  })
})

describe('drx init at a terminal with engines', () => {
  const base = {
    'Which layout?': 'monorepo',
    'Install its dependencies now?': false,
    'Create the site?': true,
  }

  test('lists the installed engines first, marks the others, and ends with none', async () => {
    const { prompter, asked } = answering({
      ...base,
      'How should the backend run?': 'ddev',
    })
    const result = await init([], {
      interactive: true,
      prompter,
      findCommand: on(['ddev', 'composer']),
    })
    expect(result.code).toBe(0)
    const engine = asked.find(({ message }) => message.startsWith('How'))
    expect(engine?.choices).toEqual([
      { value: 'ddev', label: 'DDEV' },
      {
        value: 'php',
        label: 'Local PHP with Composer',
        hint: 'not installed: php',
      },
      { value: 'lando', label: 'Lando', hint: 'not installed: lando' },
      { value: 'none', label: 'None: use a backend that exists already' },
    ])
    expect(backend().engine).toBe('ddev')
    // DDEV offers one database, so there is nothing to ask.
    expect(asked.map(({ message }) => message)).toEqual([
      'Which layout?',
      'How should the backend run?',
      'Install its dependencies now?',
      'Create the site?',
    ])
  })

  test('asks for the database when the engine offers more than one', async () => {
    const { prompter, asked } = answering({
      ...base,
      'How should the backend run?': 'php',
      'Which database?': 'mysql',
    })
    await init([], { interactive: true, prompter })
    expect(
      asked.find(({ message }) => message === 'Which database?')?.choices
    ).toEqual([
      { value: 'sqlite', label: 'sqlite' },
      { value: 'mysql', label: 'mysql' },
    ])
    expect(backend().database).toBe('mysql')
  })

  test('asks for the URL of a backend that exists already', async () => {
    const { prompter } = answering({
      ...base,
      'How should the backend run?': 'none',
      'What is the URL of the backend?': 'https://cms.example.com',
    })
    const result = await init([], { interactive: true, prompter })
    expect(result.code).toBe(0)
    expect(backend().baseUrl).toBe('https://cms.example.com')
  })

  test('refuses an answer that is not a URL', async () => {
    const { prompter } = answering({
      ...base,
      'How should the backend run?': 'none',
      'What is the URL of the backend?': 'cms',
    })
    const result = await init([], { interactive: true, prompter })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      '--base-url must be an http or https URL: "cms".'
    )
  })

  test('asks nothing the flags answered', async () => {
    const { prompter, asked } = answering(base)
    await init(['--engine', 'php', '--database', 'sqlite'], {
      interactive: true,
      prompter,
    })
    expect(asked.map(({ message }) => message)).toEqual([
      'Which layout?',
      'Install its dependencies now?',
      'Create the site?',
    ])
  })
})

describe('drx init --setup', () => {
  test('says it is not available yet, and creates nothing', async () => {
    const result = await init(['--yes', '--setup'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      '--setup is not available yet. init prints the steps for you to run.'
    )
    expect(registry.requests).toEqual([])
    expect(has()).toBe(false)
  })
})

describe('drx info after an engine was chosen', () => {
  test('prints the engine, the database and the URL of the backend', async () => {
    await init(['--yes', '--engine', 'ddev'])
    const ddev = await run(['info'], { cwd: site() })
    expect(ddev.stdout).toContain(
      [
        'backend  drupal  drupal/',
        '  Engine    ddev',
        '  Database  mariadb',
      ].join('\n')
    )

    const again = await init([
      '--yes',
      '--force',
      '--engine',
      'none',
      '--base-url',
      'https://example.com',
    ])
    expect(again.stderr).not.toContain('Error')
    expect(again.code).toBe(0)
    const none = await run(['info', '--json'], { cwd: site() })
    expect(JSON.parse(none.stdout).project.parts[1]).toMatchObject({
      engine: 'none',
      baseUrl: 'https://example.com',
    })
    const text = await run(['info'], { cwd: site() })
    expect(text.stdout).toContain(
      ['  Engine       none', '  Backend URL  https://example.com'].join('\n')
    )
  })
})
