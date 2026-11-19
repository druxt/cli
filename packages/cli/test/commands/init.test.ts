import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { CliContext, Prompter } from '../../src/context.js'
import { closedPort } from '../helpers/server.js'
import { run } from '../helpers/run.js'
import {
  fixtureRegistry,
  STARTER_FILES,
  type FixtureRegistry,
} from '../helpers/starter.js'
import { cleanTmp, tmp, writeTree } from '../helpers/tmp.js'

let registry: FixtureRegistry
let cwd: string

beforeEach(async () => {
  // giget keeps downloaded tarballs under the user's cache directory.
  vi.stubEnv('XDG_CACHE_HOME', tmp('drx-cache-'))
  vi.stubEnv('GIGET_REGISTRY', undefined)
  vi.stubEnv('GIGET_AUTH', undefined)
  registry = await fixtureRegistry()
  cwd = tmp('drx-cwd-')
})

afterEach(async () => {
  await registry.close()
  vi.unstubAllEnvs()
  cleanTmp()
})

const init = (argv: string[], overrides: Partial<CliContext> = {}) =>
  run(['init', ...argv, '--registry', registry.url], { cwd, ...overrides })

const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8'))

const CONFIG = {
  layout: 'monorepo',
  line: '0.x',
  starter: 'quickstart',
  source: 'npm',
  parts: [
    { role: 'frontend', kind: 'nuxt', path: 'nuxt' },
    { role: 'backend', kind: 'drupal', path: 'drupal' },
  ],
}

/** A prompter that answers from a list and records what it was asked. */
function scripted(answers: unknown[]) {
  const asked: string[] = []
  const next = (message: string) => {
    asked.push(message)
    if (answers.length === 0) throw new Error(`Unexpected prompt: ${message}`)
    return answers.shift()
  }
  const prompter: Prompter = {
    search: async ({ message }) => next(message) as never,
    text: async ({ message }) => next(message) as string,
    select: async ({ message }) => next(message) as never,
    confirm: async ({ message }) => next(message) as boolean,
  }
  return { prompter, asked }
}

describe('drx init', () => {
  test('creates the site and records its layout and parts', async () => {
    const result = await init(['site', '--yes'])
    const site = join(cwd, 'site')

    expect(result.code).toBe(0)
    expect(existsSync(join(site, 'README.md'))).toBe(true)
    expect(readJson(join(site, 'nuxt', 'package.json'))).toEqual(
      STARTER_FILES['nuxt/package.json']
    )
    expect(existsSync(join(site, 'drupal', 'composer.json'))).toBe(true)
    expect(readJson(join(site, 'drx.config.json'))).toEqual(CONFIG)
  })

  test('prints what the site needs and what to run, from the entry', async () => {
    const result = await init(['site', '--yes'])
    expect(result.stdout).toBe(
      [
        `Created a Druxt site in ${join(cwd, 'site')} from the quickstart starter.`,
        '',
        'It needs:',
        '  Node 16.18.1',
        '  DDEV',
        '',
        'Next:',
        '  cd site',
        '  npm run setup',
        '  npm run dev',
        '',
      ].join('\n')
    )
    expect(result.stderr).toContain(`Reading starters from ${registry.url}.`)
  })

  test('--json prints one JSON document on stdout and the rest on stderr', async () => {
    const result = await init(['site', '--yes', '--json'])
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      directory: join(cwd, 'site'),
      registry: { origin: 'remote', location: registry.url },
      ...CONFIG,
      installed: false,
      requires: { node: '16.18.1', tools: ['DDEV'] },
      engine: null,
      database: null,
      baseUrl: null,
      removed: [],
      commands: null,
      notes: [],
      next: ['cd site', 'npm run setup', 'npm run dev'],
    })
    expect(result.stderr).toContain('Reading starters from')
  })

  test('--yes with no directory uses the default the starter names', async () => {
    const result = await init(['--yes'])
    expect(result.code).toBe(0)
    expect(existsSync(join(cwd, 'my-druxt-site', 'drx.config.json'))).toBe(true)
  })

  test('takes --starter by name', async () => {
    const result = await init(['site', '--yes', '--starter', 'quickstart'])
    expect(result.code).toBe(0)
  })

  test('fails on a starter the registry does not have', async () => {
    const result = await init(['site', '--yes', '--starter', 'missing'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      `Could not read ${registry.url}/missing.json: 404 Not Found.`
    )
    expect(existsSync(join(cwd, 'site'))).toBe(false)
  })

  test('fails on an invalid entry, naming the field, before downloading', async () => {
    await registry.close()
    registry = await fixtureRegistry(STARTER_FILES, (entry) => {
      ;(entry.druxt as Record<string, unknown>).maintained = 'recently'
    })
    const result = await init(['site', '--yes', '--starter', 'quickstart'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'Starter entry "quickstart" is invalid: druxt.maintained must be an ISO date (YYYY-MM-DD).'
    )
    expect(
      registry.requests.some(({ path }) => path === '/quickstart.tar.gz')
    ).toBe(false)
  })
})

describe('drx init when the tarball cannot be fetched', () => {
  test('fails, naming the starter', async () => {
    delete registry.files['/quickstart.tar.gz']
    const result = await init(['site', '--yes'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Could not fetch the quickstart starter:')
    expect(existsSync(join(cwd, 'site', 'drx.config.json'))).toBe(false)
  })
})

describe('drx init with no terminal', () => {
  test('fails when no directory is given, saying what to pass', async () => {
    const result = await init([])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'No directory was given and there is no terminal to ask on. Pass a directory, as in "drx init my-site", or --yes to use the default of the starter.'
    )
    expect(registry.requests).toEqual([])
  })

  test('uses the defaults for everything else and asks nothing', async () => {
    const { prompter, asked } = scripted([])
    const result = await init(['site'], { prompter })
    expect(result.code).toBe(0)
    expect(asked).toEqual([])
    expect(readJson(join(cwd, 'site', 'drx.config.json'))).toEqual(CONFIG)
  })

  test('fails on an option with no value, naming it', async () => {
    const result = await init(['site', '--starter='])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('--starter needs a value.')
  })

  test('fails on an unknown option, naming it', async () => {
    const result = await init(['site', '--template', 'x'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'Unknown option --template. Run "drx init --help" for the options.'
    )
  })

  test('fails when no starter is the default and none is named', async () => {
    await registry.close()
    registry = await fixtureRegistry(STARTER_FILES, (entry) => {
      ;(entry.druxt as Record<string, unknown>).default = false
    })
    const result = await init(['site', '--yes'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'The registry marks no starter as the default. Pass --starter with one of: quickstart.'
    )
  })
})

describe('drx init at a terminal', () => {
  test('asks for what the flags left out', async () => {
    const { prompter, asked } = scripted([
      'asked-site',
      'monorepo',
      false,
      true,
    ])
    const result = await init([], { interactive: true, prompter })
    expect(result.code).toBe(0)
    expect(asked).toEqual([
      'Where should the site be created?',
      'Which layout?',
      'Install its dependencies now?',
      'Create the site?',
    ])
    expect(existsSync(join(cwd, 'asked-site', 'drx.config.json'))).toBe(true)
  })

  test('asks which starter when the registry has more than one', async () => {
    registry.files['/index.json'] = JSON.stringify({
      starters: ['quickstart', 'second'],
    })
    registry.files['/second.json'] = JSON.stringify({
      ...registry.entry,
      name: 'second',
    })
    const { prompter, asked } = scripted([
      'site',
      'second',
      'monorepo',
      false,
      true,
    ])
    const result = await init([], { interactive: true, prompter })
    expect(result.code).toBe(0)
    expect(asked.slice(0, 2)).toEqual([
      'Where should the site be created?',
      'Which starter?',
    ])
    expect(readJson(join(cwd, 'site', 'drx.config.json')).starter).toBe(
      'second'
    )
  })

  test('asks nothing a flag answered', async () => {
    const { prompter, asked } = scripted([])
    const result = await init(
      ['site', '--layout', 'monorepo', '--no-install'],
      { interactive: true, prompter }
    )
    expect(result.code).toBe(0)
    expect(asked).toEqual([])
  })

  test('asks nothing with --yes', async () => {
    const { prompter, asked } = scripted([])
    const result = await init(['--yes'], { interactive: true, prompter })
    expect(result.code).toBe(0)
    expect(asked).toEqual([])
  })

  test('says a layout chosen at the prompt is not available yet', async () => {
    const { prompter } = scripted(['workspace'])
    const result = await init(['site'], { interactive: true, prompter })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'The workspace layout is not available yet.'
    )
  })
})

describe('drx init into an existing directory', () => {
  test('refuses one that is not empty', async () => {
    writeTree(cwd, { 'site/notes.txt': 'keep me' })
    const result = await init(['site', '--yes'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      `${join(cwd, 'site')} exists and is not empty. Choose another directory, or pass --force to write into it.`
    )
    expect(existsSync(join(cwd, 'site', 'drx.config.json'))).toBe(false)
    expect(
      registry.requests.some(({ path }) => path === '/quickstart.tar.gz')
    ).toBe(false)
  })

  test('accepts one that is empty', async () => {
    writeTree(cwd, { 'site/.keep': '' })
    const result = await init(['site/empty', '--yes'])
    expect(result.code).toBe(0)
  })

  test('--force writes into it and keeps what was there', async () => {
    writeTree(cwd, { 'site/notes.txt': 'keep me' })
    const result = await init(['site', '--yes', '--force'])
    expect(result.code).toBe(0)
    expect(readFileSync(join(cwd, 'site', 'notes.txt'), 'utf8')).toBe('keep me')
    expect(readJson(join(cwd, 'site', 'drx.config.json'))).toEqual(CONFIG)
  })

  test('refuses a path that is a file', async () => {
    writeTree(cwd, { site: 'a file' })
    const result = await init(['site', '--yes', '--force'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      `${join(cwd, 'site')} is a file, not a directory.`
    )
  })
})

describe('drx init --layout', () => {
  test.each(['split', 'workspace'])(
    'says %s is not available yet',
    async (layout) => {
      const result = await init(['site', '--yes', '--layout', layout])
      expect(result.code).toBe(1)
      expect(result.stderr).toContain(
        `The ${layout} layout is not available yet. Use --layout monorepo.`
      )
      expect(registry.requests).toEqual([])
      expect(existsSync(join(cwd, 'site'))).toBe(false)
    }
  )

  test('rejects a layout that does not exist', async () => {
    const result = await init(['site', '--yes', '--layout', 'pile'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'Invalid value for argument: --layout (pile)'
    )
  })

  test('refuses a starter of another layout', async () => {
    await registry.close()
    registry = await fixtureRegistry(STARTER_FILES, (entry) => {
      ;(entry.druxt as Record<string, unknown>).layout = 'split'
    })
    const result = await init(['site', '--yes', '--layout', 'monorepo'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'The quickstart starter has the split layout and cannot be created as monorepo.'
    )
  })
})

describe('drx init --source', () => {
  test('accepts npm', async () => {
    const result = await init(['site', '--yes', '--source', 'npm'])
    expect(result.code).toBe(0)
  })

  test('says a git source is not available yet', async () => {
    const source = 'git:https://example.com/druxt.git#main'
    const result = await init(['site', '--yes', '--source', source])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      `The source "${source}" is not available yet. Only the npm source works in this version.`
    )
    expect(registry.requests).toEqual([])
  })

  test('says a source named in the user configuration is not available yet', async () => {
    const home = tmp()
    writeTree(home, {
      'config.json': { sources: { next: { type: 'npm', tag: 'next' } } },
    })
    const result = await init(['site', '--yes', '--source', 'next'], {
      env: { DRX_CONFIG: join(home, 'config.json') },
    })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('The source "next" is not available yet.')
  })

  test('fails on a source nothing defines', async () => {
    const result = await init(['site', '--yes', '--source', 'elsewhere'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Unknown source "elsewhere".')
  })
})

describe('drx init --registry', () => {
  test('takes a name defined in the user configuration', async () => {
    const home = tmp()
    writeTree(home, { 'config.json': { registries: { team: registry.url } } })
    const result = await run(['init', 'site', '--yes', '--registry', 'team'], {
      cwd,
      env: { DRX_CONFIG: join(home, 'config.json') },
    })
    expect(result.code).toBe(0)
    expect(result.stderr).toContain(`Reading starters from ${registry.url}.`)
  })

  test('uses the default registry when it answers', async () => {
    const result = await run(['init', 'site', '--yes', '--json'], {
      cwd,
      defaultRegistry: registry.url,
    })
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout).registry).toEqual({
      origin: 'remote',
      location: registry.url,
    })
  })

  test('falls back to the bundled copy and says so', async () => {
    const bundled = tmp('drx-bundled-')
    writeTree(bundled, {
      'index.json': { starters: ['quickstart'] },
      'quickstart.json': registry.entry,
    })
    const unreachable = await closedPort()
    const result = await run(['init', 'site', '--yes', '--json'], {
      cwd,
      defaultRegistry: unreachable,
      bundledRegistryDir: bundled,
    })
    expect(result.code).toBe(0)
    expect(result.stderr).toContain(`Could not read ${unreachable}/index.json`)
    // One line: the fallback is routine while a registry cannot be read.
    expect(
      result.stderr
        .split('\n')
        .filter((line) => line.includes('bundled with this version'))
    ).toEqual([
      expect.stringContaining(`Could not read ${unreachable}/index.json`),
    ])
    expect(JSON.parse(result.stdout).registry).toEqual({
      origin: 'bundled',
      location: bundled,
    })
    expect(existsSync(join(cwd, 'site', 'drx.config.json'))).toBe(true)
  })
})

describe('drx init --install', () => {
  // A starter's install may run its setup only when the tools are there. The entry says how to tell.
  test('keeps a step in Next when the install did not finish it', async () => {
    await registry.close()
    registry = await fixtureRegistry(STARTER_FILES, (entry) => {
      ;(entry.druxt as Record<string, unknown>).install = {
        runs: ['npm run setup'],
        notes: ['npm run dev starts the backend again.'],
        done: { file: '.env', contains: ['BASE_URL='] },
      }
    })
    const skipped = await init(['one', '--yes', '--install', '--json'], {
      install: vi.fn(async () => {}),
    })
    const first = JSON.parse(skipped.stdout)
    expect(first.next).toEqual(['cd one', 'npm run setup', 'npm run dev'])
    expect(first.notes).toEqual([
      'The install did not finish the setup, so it is still listed. It needs what the lines above name.',
    ])

    const finished = await init(['two', '--yes', '--install', '--json'], {
      install: vi.fn(async (dir: string) => {
        writeFileSync(join(dir, '.env'), 'BASE_URL=http://127.0.0.1:8888\n')
      }),
    })
    const second = JSON.parse(finished.stdout)
    expect(second.next).toEqual(['cd two', 'npm run dev'])
    expect(second.notes).toEqual(['npm run dev starts the backend again.'])
  })

  test('warns when the site would sit inside another git repository', async () => {
    mkdirSync(join(cwd, '.git'))
    const result = await init(['site', '--yes', '--json'])
    expect(result.code).toBe(0)
    expect(result.stderr).toContain(
      `${join(cwd, 'site')} is inside the git repository at ${cwd}.`
    )
    const clean = await init(['../elsewhere-' + Date.now(), '--yes', '--json'])
    expect(clean.stderr).not.toContain('is inside the git repository')
  })

  test('installs after the site is written', async () => {
    const install = vi.fn(async (dir: string) => {
      expect(existsSync(join(dir, 'drx.config.json'))).toBe(true)
    })
    const result = await init(['site', '--yes', '--install', '--json'], {
      install,
    })
    expect(result.code).toBe(0)
    expect(install).toHaveBeenCalledExactlyOnceWith(join(cwd, 'site'))
    expect(JSON.parse(result.stdout).installed).toBe(true)
  })

  test('leaves out of Next the steps the install ran, and adds its notes', async () => {
    await registry.close()
    registry = await fixtureRegistry(STARTER_FILES, (entry) => {
      ;(entry.druxt as Record<string, unknown>).install = {
        runs: ['npm run setup'],
        notes: ['npm run dev starts the backend again.'],
      }
    })
    const install = vi.fn(async () => {})
    const result = await init(['site', '--yes', '--install'], { install })
    expect(result.stdout).toBe(
      [
        `Created a Druxt site in ${join(cwd, 'site')} from the quickstart starter.`,
        '',
        'It needs:',
        '  Node 16.18.1',
        '  DDEV',
        '',
        'Next:',
        '  cd site',
        '  npm run dev',
        '',
        'Note:',
        '  npm run dev starts the backend again.',
        '',
      ].join('\n')
    )

    const json = await init(['json', '--yes', '--install', '--json'], {
      install,
    })
    expect(JSON.parse(json.stdout)).toMatchObject({
      next: ['cd json', 'npm run dev'],
      notes: ['npm run dev starts the backend again.'],
    })

    // Without the install, every step is still to run.
    const plain = await init(['plain', '--yes', '--json'], { install })
    expect(JSON.parse(plain.stdout)).toMatchObject({
      next: ['cd plain', 'npm run setup', 'npm run dev'],
      notes: [],
    })
  })

  // A shell reads "cd -" as the previous directory, and quoting does not change that.
  test('prints a directory whose name starts with a hyphen as a path', async () => {
    const dashed = await init(['./-site', '--yes', '--json'])
    expect(JSON.parse(dashed.stdout).next[0]).toBe('cd ./-site')
  })

  test('does not install with --no-install or by default', async () => {
    const install = vi.fn(async () => {})
    await init(['one', '--yes', '--no-install'], { install })
    await init(['two', '--yes'], { install })
    expect(install).not.toHaveBeenCalled()
  })

  test('reports a failed install and leaves the site in place', async () => {
    const install = vi.fn(async () => {
      throw new Error('npm install exited with code 1')
    })
    const result = await init(['site', '--yes', '--install'], { install })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      `The site was created in ${join(cwd, 'site')}, but installing its dependencies failed: npm install exited with code 1`
    )
    expect(existsSync(join(cwd, 'site', 'drx.config.json'))).toBe(true)
  })
})

describe('drx init warnings', () => {
  test('warns when the running Node is not the one the starter needs', async () => {
    const result = await init(['site', '--yes'])
    expect(result.stderr).toContain(
      'Warning: The quickstart starter needs Node 16.18.1 and this is Node 24.18.0. Switch before you install or run the site.'
    )
  })

  test('does not warn when it is', async () => {
    const result = await init(['site', '--yes'], {
      nodeVersion: '16.18.1',
      // A date, so that the fixture's `maintained` never grows a year old.
      now: () => new Date('2026-12-01T00:00:00Z'),
    })
    expect(result.stderr).not.toContain('Warning')
  })

  test('warns when the starter has not been maintained for a year', async () => {
    const result = await init(['site', '--yes'], {
      nodeVersion: '16.18.1',
      now: () => new Date('2028-01-01T00:00:00Z'),
    })
    expect(result.code).toBe(0)
    expect(result.stderr).toContain(
      'Warning: The quickstart starter was last maintained on 2026-11-01 and may no longer work.'
    )
  })

  test('warns when the starter lacks a part its entry names', async () => {
    await registry.close()
    registry = await fixtureRegistry({ 'README.md': '# Only a readme\n' })
    const result = await init(['site', '--yes'], { nodeVersion: '16.18.1' })
    expect(result.code).toBe(0)
    expect(result.stderr).toContain(
      'Warning: The starter has no nuxt/ directory, which its registry entry names as the frontend part.'
    )
  })
})

describe('drx init and the commands a starter needs', () => {
  const needs = (commands: unknown) => async () => {
    await registry.close()
    registry = await fixtureRegistry(STARTER_FILES, (entry) => {
      const druxt = entry.druxt as { requires: Record<string, unknown> }
      druxt.requires.commands = commands
    })
  }
  const on = (present: string[]) => (name: string) =>
    present.includes(name) ? `/usr/bin/${name}` : undefined
  const quiet = { nodeVersion: '16.18.1' }

  describe('with alternatives', () => {
    beforeEach(needs([['php', 'composer'], ['ddev']]))

    test('warns once when no alternative is complete, and still creates the site', async () => {
      const result = await init(['site', '--yes'], {
        ...quiet,
        findCommand: on([]),
      })
      expect(result.code).toBe(0)
      expect(existsSync(join(cwd, 'site', 'drx.config.json'))).toBe(true)
      expect(result.stderr.match(/Warning/g)).toHaveLength(1)
      expect(result.stderr).toContain(
        'Warning: The quickstart starter needs php and composer, or ddev. Not found on PATH: php, composer, ddev. Install the commands of one alternative before you set up the site.'
      )
    })

    test('names only what is missing', async () => {
      const result = await init(['site', '--yes'], {
        ...quiet,
        findCommand: on(['composer']),
      })
      expect(result.stderr).toContain('Not found on PATH: php, ddev.')
    })

    test.each([[['php', 'composer']], [['ddev']]])(
      'does not warn when %j are present',
      async (present) => {
        const result = await init(['site', '--yes'], {
          ...quiet,
          findCommand: on(present),
        })
        expect(result.code).toBe(0)
        expect(result.stderr).not.toContain('Warning')
      }
    )

    test('--json reports what was found and what was missing', async () => {
      const result = await init(['site', '--yes', '--json'], {
        ...quiet,
        findCommand: on(['composer']),
      })
      expect(result.code).toBe(0)
      expect(JSON.parse(result.stdout).commands).toEqual({
        satisfied: false,
        alternatives: [['php', 'composer'], ['ddev']],
        found: ['composer'],
        missing: ['php', 'ddev'],
      })
    })

    test('warns before it installs', async () => {
      const install = vi.fn(async () => {
        throw new Error('npm install exited with code 1')
      })
      const result = await init(['site', '--yes', '--install'], {
        ...quiet,
        install,
        findCommand: on([]),
      })
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('Not found on PATH: php, composer, ddev.')
    })
  })

  describe('with one set of commands', () => {
    beforeEach(needs([['php', 'composer']]))

    test('says to install what is missing', async () => {
      const result = await init(['site', '--yes'], {
        ...quiet,
        findCommand: on(['php']),
      })
      expect(result.stderr).toContain(
        'Warning: The quickstart starter needs php and composer. Not found on PATH: composer. Install what is missing before you set up the site.'
      )
    })
  })

  test('an entry that names no commands is not checked', async () => {
    const findCommand = vi.fn()
    const result = await init(['site', '--yes', '--json'], {
      ...quiet,
      findCommand,
    })
    expect(result.code).toBe(0)
    expect(findCommand).not.toHaveBeenCalled()
    expect(JSON.parse(result.stdout).commands).toBeNull()
    expect(result.stderr).not.toContain('Warning')
  })
})
