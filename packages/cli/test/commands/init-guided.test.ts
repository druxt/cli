import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { CliContext } from '../../src/context.js'
import { cliVersion } from '../../src/package-root.js'
import { WORDMARK } from '../../src/presentation.js'
import { validEngines } from '../helpers/engines.js'
import { answering } from '../helpers/prompter.js'
import { run } from '../helpers/run.js'
import {
  fixtureRegistry,
  STARTER_FILES,
  type FixtureRegistry,
} from '../helpers/starter.js'
import { cleanTmp, tmp, writeTree } from '../helpers/tmp.js'

const FILES = {
  ...STARTER_FILES,
  '.env.example': 'BASE_URL=http://template.example\n',
  'drupal/.ddev/config.yaml': 'name: fixture\n',
  'drupal/.lando.yml': 'name: fixture\n',
}

let registry: FixtureRegistry
let cwd: string

beforeEach(async () => {
  vi.stubEnv('XDG_CACHE_HOME', tmp('drx-cache-'))
  vi.stubEnv('GIGET_REGISTRY', undefined)
  vi.stubEnv('GIGET_AUTH', undefined)
  registry = await fixtureRegistry(FILES, (entry) => {
    const druxt = entry.druxt as Record<string, unknown>
    druxt.description = 'A fixture site'
    druxt.engines = validEngines()
    druxt.backendUrl = {
      file: '.env',
      template: '.env.example',
      variable: 'BASE_URL',
    }
  })
  cwd = tmp('drx-cwd-')
})

afterEach(async () => {
  await registry.close()
  vi.unstubAllEnvs()
  cleanTmp()
})

const ANSWERS = {
  'Where should the site be created?': 'guided',
  'Which layout?': 'monorepo',
  'How should the backend run?': 'ddev',
  'Install its dependencies now?': false,
  'Create the site?': true,
}

/** `drx init` in a terminal 100 columns wide, with colour off. */
const guided = (
  argv: string[],
  answers: Record<string, unknown> = ANSWERS,
  overrides: Partial<CliContext> = {},
  options: { cancelAt?: number; columns?: number } = {}
) => {
  const { prompter, asked } = answering(answers, options)
  return run(
    ['init', ...argv, '--registry', registry.url],
    {
      cwd,
      env: { XDG_CONFIG_HOME: tmp('drx-config-'), NO_COLOR: '1' },
      nodeVersion: '16.18.1',
      findCommand: (name) => `/usr/bin/${name}`,
      prompter,
      ...overrides,
    },
    { columns: options.columns ?? 100 }
  ).then((result) => ({ ...result, asked }))
}

const fetched = () =>
  registry.requests.some(({ path }) => path === '/quickstart.tar.gz')

describe('a guided drx init', () => {
  test('asks in order, shows what it will do, and asks before it writes', async () => {
    const result = await guided([])
    expect(result.code).toBe(0)
    expect(result.asked.map(({ message }) => message)).toEqual([
      'Where should the site be created?',
      'Which layout?',
      'How should the backend run?',
      'Install its dependencies now?',
      'Create the site?',
    ])
    expect(result.stderr).toContain(
      [
        'This will:',
        `  Create   ${join(cwd, 'guided')}`,
        '  From     the quickstart starter (0.x), monorepo layout',
        '  Backend  ddev engine, mariadb database',
        '  Remove   the files of the other engines',
        '  Write    BASE_URL=http://fixture.ddev.site to .env',
        '  Install  no',
        '',
      ].join('\n')
    )
    expect(existsSync(join(cwd, 'guided', 'drx.config.json'))).toBe(true)
  })

  test('starts with the wordmark', async () => {
    const result = await guided([])
    expect(result.stderr.startsWith(`\n${WORDMARK}\n`)).toBe(true)
    expect(result.stdout).not.toContain('█')
  })

  test('ends with the command that repeats it, every choice a flag', async () => {
    const result = await guided([])
    expect(result.stderr.trimEnd().split('\n').at(-1)).toBe(
      `Repeat this with: drx init guided --starter quickstart --layout monorepo --engine ddev --database mariadb --registry ${registry.url} --no-install --yes`
    )
  })

  test('quotes a directory with a space and quotes in it', async () => {
    const dir = `my "site" isn't`
    const result = await guided([], {
      ...ANSWERS,
      'Where should the site be created?': dir,
    })
    expect(result.code).toBe(0)
    expect(existsSync(join(cwd, dir, 'drx.config.json'))).toBe(true)
    expect(result.stderr).toContain(
      `Repeat this with: drx init 'my "site" isn'\\''t' --starter quickstart`
    )
  })

  test('repeats a backend that exists already with its URL, and the other flags', async () => {
    writeTree(cwd, { 'guided/notes.txt': 'keep' })
    const result = await guided(
      ['--force', '--keep-engines'],
      {
        ...ANSWERS,
        'How should the backend run?': 'none',
        'What is the URL of the backend?': 'https://cms.example.com/?a=1',
        'Install its dependencies now?': true,
      },
      { install: async () => {} }
    )
    expect(result.code).toBe(0)
    expect(result.stderr).toContain(
      `--engine none --base-url 'https://cms.example.com/?a=1' --registry ${registry.url} --keep-engines --install --force --yes`
    )
    expect(result.stderr).toContain('  Keep     the files of every engine')
    expect(result.stderr).toContain('  Install  yes')
  })

  test('lists a starter with its line, what it needs and its description', async () => {
    registry.files['/index.json'] = JSON.stringify({
      starters: ['quickstart', 'second'],
    })
    registry.files['/second.json'] = JSON.stringify({
      ...registry.entry,
      name: 'second',
    })
    const result = await guided([], { ...ANSWERS, 'Which starter?': 'second' })
    expect(result.code).toBe(0)
    expect(result.asked.slice(0, 2).map(({ message }) => message)).toEqual([
      'Where should the site be created?',
      'Which starter?',
    ])
    expect(result.asked[1]?.choices?.[0]).toEqual({
      value: 'quickstart',
      label: 'quickstart',
      hint: '0.x, Node 16.18.1. A fixture site',
    })
  })

  test('shows the layouts that are not built as unavailable', async () => {
    const result = await guided([])
    expect(result.asked[1]?.choices).toEqual([
      { value: 'monorepo', label: 'monorepo' },
      {
        value: 'split',
        label: 'split',
        hint: 'not available yet',
        disabled: true,
      },
      {
        value: 'workspace',
        label: 'workspace',
        hint: 'not available yet',
        disabled: true,
      },
    ])
  })

  test('marks each step as it finishes', async () => {
    const result = await guided(
      [],
      { ...ANSWERS, 'Install its dependencies now?': true },
      {
        install: async () => {},
      }
    )
    for (const line of [
      `✔ Read the starters from ${registry.url}.`,
      '✔ Fetched the quickstart starter.',
      '✔ Installed dependencies.',
    ]) {
      expect(result.stderr).toContain(line)
    }
  })
})

describe('a guided drx init that is not confirmed', () => {
  test('writes nothing when the answer is no', async () => {
    const result = await guided([], { ...ANSWERS, 'Create the site?': false })
    expect(result.code).toBe(1)
    expect(result.stderr.trimEnd().split('\n').at(-1)).toBe(
      '✖ Error: Cancelled. Nothing was written.'
    )
    expect(readdirSync(cwd)).toEqual([])
    expect(fetched()).toBe(false)
  })

  test.each([0, 1, 2, 3, 4])(
    'writes nothing when prompt %i is cancelled',
    async (cancelAt) => {
      const result = await guided([], ANSWERS, {}, { cancelAt })
      expect(result.asked).toHaveLength(cancelAt + 1)
      expect(result.code).toBe(1)
      expect(result.stderr.match(/Error/g)).toHaveLength(1)
      expect(result.stderr).toContain('Error: Cancelled. Nothing was written.')
      expect(readdirSync(cwd)).toEqual([])
      expect(fetched()).toBe(false)
    }
  )
})

describe('the wordmark at init', () => {
  const small = `◆ druxt ${cliVersion()}\n`

  test.each([
    ['--no-banner', ['--no-banner'], {}, {}],
    ['a terminal narrower than the art', [], {}, { columns: 57 }],
    [
      'CI',
      [],
      { env: { CI: '1', NO_COLOR: '1', XDG_CONFIG_HOME: '/nonexistent' } },
      {},
    ],
  ])(
    'gives way to the small header with %s',
    async (_name, argv, overrides, options) => {
      const result = await guided(argv, ANSWERS, overrides, options)
      expect(result.code).toBe(0)
      expect(result.stderr).not.toContain('█')
      expect(result.stderr.startsWith(small)).toBe(true)
    }
  )

  test('gives way when the user configuration turns it off', async () => {
    const home = tmp('drx-config-')
    writeTree(home, { 'drx/config.json': { banner: false } })
    const result = await guided([], ANSWERS, {
      env: { XDG_CONFIG_HOME: home, NO_COLOR: '1' },
    })
    expect(result.stderr).not.toContain('█')
    expect(result.stderr.startsWith(small)).toBe(true)
  })

  test('is not drawn when every value came from a flag, and nothing is confirmed', async () => {
    const result = await guided(
      ['site', '--layout', 'monorepo', '--engine', 'ddev', '--no-install'],
      {}
    )
    expect(result.code).toBe(0)
    expect(result.asked).toEqual([])
    expect(result.stderr).not.toContain('█')
    expect(result.stderr.startsWith(small)).toBe(true)
    expect(result.stderr).not.toContain('This will:')
    expect(result.stderr).not.toContain('Repeat this with')
  })

  test('is not drawn with --json, which asks nothing and prints JSON alone', async () => {
    const result = await guided(['site', '--json'], {})
    expect(result.asked).toEqual([])
    expect(result.stderr).not.toContain('█')
    expect(result.stderr).not.toContain('druxt ')
    expect(JSON.parse(result.stdout).ok).toBe(true)
  })
})
