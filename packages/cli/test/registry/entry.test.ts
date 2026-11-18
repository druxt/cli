import { describe, expect, test } from 'vitest'
import { DrxError } from '../../src/errors.js'
import { validateEntry } from '../../src/registry/entry.js'
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
    ['druxt.install', 'npm install', 'druxt.install must be an object'],
    [
      'druxt.install',
      { runs: 'npm run setup' },
      'druxt.install.runs must be an array of strings',
    ],
    [
      'druxt.install',
      { notes: [1] },
      'druxt.install.notes must be an array of strings',
    ],
  ])('names the bad field: %s = %j', (path, value, message) => {
    const attempt = () => validateEntry(entryWith(path, value), 'quickstart')
    expect(attempt).toThrow(DrxError)
    expect(attempt).toThrow(
      `Starter entry "quickstart" is invalid: ${message}.`
    )
  })
})
