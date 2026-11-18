import { describe, expect, test } from 'vitest'
import { DrxError } from '../../src/errors.js'
import { validateEntry } from '../../src/registry/entry.js'
import { enginesWith, validEngines } from '../helpers/engines.js'
import { entryWith, validEntry } from '../helpers/entry.js'

describe('validateEntry', () => {
  test('returns a valid entry unchanged', () => {
    expect(validateEntry(validEntry(), 'quickstart')).toEqual(validEntry())
  })

  test('accepts an entry with none of the optional fields', () => {
    const entry = validEntry()
    delete entry.defaultDir
    delete entry.url
    delete (entry.druxt as Record<string, unknown>).steps
    expect(validateEntry(entry, 'quickstart')).toEqual(entry)
  })

  test('accepts alternatives of commands the site needs', () => {
    const entry = entryWith('druxt.requires.commands', [
      ['php', 'composer'],
      ['ddev'],
    ])
    expect(validateEntry(entry, 'quickstart')).toEqual(entry)
  })

  test('rejects a value that is not an object', () => {
    expect(() => validateEntry('nope', 'quickstart')).toThrow(
      'Starter entry "quickstart" is invalid: the entry must be an object.'
    )
  })

  test.each([
    ['name', undefined, 'name must be a non-empty string'],
    ['name', '', 'name must be a non-empty string'],
    ['tar', undefined, 'tar must be an http or https URL'],
    ['tar', 'ftp://example.com/x.tar.gz', 'tar must be an http or https URL'],
    ['tar', 'not a url', 'tar must be an http or https URL'],
    ['defaultDir', 7, 'defaultDir must be a string'],
    ['url', 7, 'url must be a string'],
    ['subdir', 7, 'subdir must be a string'],
    ['headers', 'x', 'headers must be an object of strings'],
    ['headers', { a: 1 }, 'headers must be an object of strings'],
    ['druxt', undefined, 'druxt must be an object'],
    ['druxt', [], 'druxt must be an object'],
    ['druxt.line', undefined, 'druxt.line must be a non-empty string'],
    [
      'druxt.layout',
      'pile',
      'druxt.layout must be one of monorepo, split, workspace',
    ],
    ['druxt.parts', undefined, 'druxt.parts must be a non-empty array'],
    ['druxt.parts', [], 'druxt.parts must be a non-empty array'],
    ['druxt.parts', ['x'], 'druxt.parts[0] must be an object'],
    [
      'druxt.parts',
      [{ role: 'middle', kind: 'nuxt', path: 'nuxt' }],
      'druxt.parts[0].role must be one of frontend, backend',
    ],
    [
      'druxt.parts',
      [{ role: 'frontend', kind: '', path: 'nuxt' }],
      'druxt.parts[0].kind must be a non-empty string',
    ],
    [
      'druxt.parts',
      [{ role: 'frontend', kind: 'nuxt' }],
      'druxt.parts[0].path must be a relative path inside the project',
    ],
    [
      'druxt.parts',
      [{ role: 'frontend', kind: 'nuxt', path: '../elsewhere' }],
      'druxt.parts[0].path must be a relative path inside the project',
    ],
    [
      'druxt.parts',
      [{ role: 'frontend', kind: 'nuxt', path: '/etc' }],
      'druxt.parts[0].path must be a relative path inside the project',
    ],
    ['druxt.requires', undefined, 'druxt.requires must be an object'],
    [
      'druxt.requires.node',
      16,
      'druxt.requires.node must be a non-empty string',
    ],
    [
      'druxt.requires.tools',
      'DDEV',
      'druxt.requires.tools must be an array of strings',
    ],
    [
      'druxt.requires.tools',
      [1],
      'druxt.requires.tools must be an array of strings',
    ],
    [
      'druxt.requires.commands',
      'php',
      'druxt.requires.commands must be a non-empty array of alternatives',
    ],
    [
      'druxt.requires.commands',
      [],
      'druxt.requires.commands must be a non-empty array of alternatives',
    ],
    [
      'druxt.requires.commands',
      [['php'], 'ddev'],
      'druxt.requires.commands[1] must be a non-empty array of command names',
    ],
    [
      'druxt.requires.commands',
      [[]],
      'druxt.requires.commands[0] must be a non-empty array of command names',
    ],
    [
      'druxt.requires.commands',
      [['php', '/usr/bin/composer']],
      'druxt.requires.commands[0][1] must be a command name with no path or spaces',
    ],
    [
      'druxt.requires.commands',
      [['php -v']],
      'druxt.requires.commands[0][0] must be a command name with no path or spaces',
    ],
    [
      'druxt.requires.commands',
      [[7]],
      'druxt.requires.commands[0][0] must be a command name with no path or spaces',
    ],
    [
      'druxt.maintained',
      undefined,
      'druxt.maintained must be an ISO date (YYYY-MM-DD)',
    ],
    [
      'druxt.maintained',
      'last week',
      'druxt.maintained must be an ISO date (YYYY-MM-DD)',
    ],
    [
      'druxt.maintained',
      '2026-13-40',
      'druxt.maintained must be an ISO date (YYYY-MM-DD)',
    ],
    ['druxt.default', 'yes', 'druxt.default must be true or false'],
    ['druxt.steps', 'npm run dev', 'druxt.steps must be an array of strings'],
  ])('names the bad field: %s = %j', (path, value, message) => {
    const attempt = () => validateEntry(entryWith(path, value), 'quickstart')
    expect(attempt).toThrow(DrxError)
    expect(attempt).toThrow(
      `Starter entry "quickstart" is invalid: ${message}.`
    )
  })
})

describe('validateEntry and engines', () => {
  const E = 'druxt.engines'
  const backendUrl = {
    file: '.env',
    template: '.env.example',
    variable: 'BASE_URL',
  }

  test('accepts engines and where the backend URL goes', () => {
    const entry = entryWith(E, validEngines())
    ;(entry.druxt as Record<string, unknown>).backendUrl = backendUrl
    expect(validateEntry(entry, 'quickstart')).toEqual(entry)
  })

  test.each([
    ['php', `${E} must be a non-empty array`],
    [[], `${E} must be a non-empty array`],
    [['php'], `${E}[0] must be an object`],
    [
      enginesWith(1, 'name', undefined),
      `${E}[1].name must be a lower-case name`,
    ],
    [
      enginesWith(1, 'name', 'My Engine'),
      `${E}[1].name must be a lower-case name`,
    ],
    [
      enginesWith(1, 'name', 'none'),
      `${E}[1].name cannot be none, which every starter has`,
    ],
    [enginesWith(1, 'name', 'php'), `${E}[1].name repeats the name php`],
    [enginesWith(0, 'label', ''), `${E}[0].label must be a non-empty string`],
    [
      enginesWith(0, 'commands', undefined),
      `${E}[0].commands must be an array of command names`,
    ],
    [
      enginesWith(0, 'commands', ['php', 'bin/composer']),
      `${E}[0].commands[1] must be a command name with no path or spaces`,
    ],
    [
      enginesWith(0, 'databases', []),
      `${E}[0].databases must be a non-empty array of names`,
    ],
    [
      enginesWith(0, 'databases', ['sqlite', 7]),
      `${E}[0].databases must be a non-empty array of names`,
    ],
    [enginesWith(0, 'steps', undefined), `${E}[0].steps must be an array`],
    [
      enginesWith(0, 'steps', [7]),
      `${E}[0].steps[0] must be a command, or an object with run and dir`,
    ],
    [
      enginesWith(0, 'steps', [{ run: 'x' }]),
      `${E}[0].steps[0].dir must be a relative path inside the starter`,
    ],
    [
      enginesWith(0, 'steps', [{ run: '', dir: 'drupal' }]),
      `${E}[0].steps[0].run must be a non-empty string`,
    ],
    [
      enginesWith(0, 'steps', [{ run: 'x', dir: '../up' }]),
      `${E}[0].steps[0].dir must be a relative path inside the starter`,
    ],
    [
      enginesWith(1, 'notes', 'a note'),
      `${E}[1].notes must be an array of strings`,
    ],
    [
      enginesWith(1, 'baseUrl', 'fixture.ddev.site'),
      `${E}[1].baseUrl must be an http or https URL`,
    ],
    [
      enginesWith(2, 'files', 'drupal/.lando.yml'),
      `${E}[2].files must be an array of paths`,
    ],
    [
      enginesWith(2, 'files', ['/etc/passwd']),
      `${E}[2].files[0] must be a relative path inside the starter`,
    ],
    [
      enginesWith(2, 'files', ['drupal/.lando.yml', 'drupal/../../outside']),
      `${E}[2].files[1] must be a relative path inside the starter`,
    ],
    [
      enginesWith(2, 'files', ['C:\\Windows']),
      `${E}[2].files[0] must be a relative path inside the starter`,
    ],
    [
      enginesWith(2, 'files', ['.']),
      `${E}[2].files[0] must be a relative path inside the starter`,
    ],
  ])('names the bad engine field in %j', (engines, message) => {
    expect(() => validateEntry(entryWith(E, engines), 'quickstart')).toThrow(
      `Starter entry "quickstart" is invalid: ${message}.`
    )
  })

  test.each([
    ['.env', 'druxt.backendUrl must be an object'],
    [
      { variable: 'BASE_URL' },
      'druxt.backendUrl.file must be a relative path inside the starter',
    ],
    [
      { file: '../.env', variable: 'BASE_URL' },
      'druxt.backendUrl.file must be a relative path inside the starter',
    ],
    [
      { file: '.env', variable: 'BASE URL' },
      'druxt.backendUrl.variable must be the name of a variable',
    ],
    [
      { file: '.env', variable: 'BASE_URL', template: '/etc/env' },
      'druxt.backendUrl.template must be a relative path inside the starter',
    ],
  ])('names the bad backendUrl field in %j', (value, message) => {
    expect(() =>
      validateEntry(entryWith('druxt.backendUrl', value), 'quickstart')
    ).toThrow(`Starter entry "quickstart" is invalid: ${message}.`)
  })
})
