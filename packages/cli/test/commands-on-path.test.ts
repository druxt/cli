import { chmodSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  checkCommands,
  describeAlternatives,
  findOnPath,
} from '../src/commands-on-path.js'
import { cleanTmp, tmp, writeTree } from './helpers/tmp.js'

afterEach(cleanTmp)

/** A directory holding the named files, each executable unless listed. */
function bin(names: string[], notExecutable: string[] = []): string {
  const dir = tmp('drx-path-')
  writeTree(dir, Object.fromEntries(names.map((name) => [name, '#!/bin/sh\n'])))
  for (const name of names) {
    chmodSync(join(dir, name), notExecutable.includes(name) ? 0o644 : 0o755)
  }
  return dir
}

describe.skipIf(process.platform === 'win32')('findOnPath on POSIX', () => {
  test('finds an executable in a directory on PATH', () => {
    const first = bin([])
    const second = bin(['php'])
    expect(findOnPath('php', { PATH: `${first}:${second}` }, 'linux')).toBe(
      join(second, 'php')
    )
  })

  test('is undefined for a command no directory holds', () => {
    expect(findOnPath('ddev', { PATH: bin(['php']) }, 'linux')).toBeUndefined()
  })

  test('passes over a file that is not executable, and a directory', () => {
    const dir = bin(['php'], ['php'])
    writeTree(dir, { 'composer/README': '' })
    expect(findOnPath('php', { PATH: dir }, 'linux')).toBeUndefined()
    expect(findOnPath('composer', { PATH: dir }, 'linux')).toBeUndefined()
  })

  test('is undefined when PATH is empty or not set', () => {
    expect(findOnPath('php', { PATH: '' }, 'linux')).toBeUndefined()
    expect(findOnPath('php', {}, 'linux')).toBeUndefined()
  })

  test('does not add the extensions Windows would', () => {
    const dir = bin(['php.exe'])
    expect(
      findOnPath('php', { PATH: dir, PATHEXT: '.EXE' }, 'linux')
    ).toBeUndefined()
  })
})

// The Windows rules, exercised with the platform passed in: `;` between
// directories, the PATH variable under any casing, and PATHEXT extensions.
describe('findOnPath on Windows', () => {
  test('tries each extension in PATHEXT, in order', () => {
    const dir = bin(['composer.bat', 'composer.cmd'])
    expect(
      findOnPath(
        'composer',
        { Path: `${bin([])};${dir}`, PATHEXT: '.EXE;.CMD;.BAT' },
        'win32'
      )
    ).toBe(join(dir, 'composer.cmd'))
  })

  test('uses the usual extensions when PATHEXT is not set', () => {
    const dir = bin(['php.exe'], ['php.exe'])
    expect(findOnPath('php', { PATH: dir }, 'win32')).toBe(join(dir, 'php.exe'))
  })

  test('accepts a name that already has its extension', () => {
    const dir = bin(['ddev.exe'])
    expect(findOnPath('ddev.exe', { PATH: dir }, 'win32')).toBe(
      join(dir, 'ddev.exe')
    )
  })

  test('does not match a file with no extension', () => {
    expect(findOnPath('php', { PATH: bin(['php']) }, 'win32')).toBeUndefined()
  })
})

describe('checkCommands', () => {
  const on = (present: string[]) => (name: string) =>
    present.includes(name) ? `/usr/bin/${name}` : undefined
  const alternatives = [['php', 'composer'], ['ddev']]

  test('is satisfied when every command of one alternative is found', () => {
    expect(checkCommands(alternatives, on(['php', 'composer']))).toEqual({
      satisfied: true,
      alternatives,
      found: ['php', 'composer'],
      missing: ['ddev'],
    })
    expect(checkCommands(alternatives, on(['ddev'])).satisfied).toBe(true)
  })

  test('is not satisfied when every alternative lacks a command', () => {
    expect(checkCommands(alternatives, on(['composer']))).toEqual({
      satisfied: false,
      alternatives,
      found: ['composer'],
      missing: ['php', 'ddev'],
    })
  })

  test('looks a command named twice up once', () => {
    const looked: string[] = []
    const result = checkCommands(
      [
        ['php', 'composer'],
        ['php', 'ddev'],
      ],
      (name) => {
        looked.push(name)
        return undefined
      }
    )
    expect(looked).toEqual(['php', 'composer', 'ddev'])
    expect(result.missing).toEqual(['php', 'composer', 'ddev'])
  })
})

describe('describeAlternatives', () => {
  test('joins commands with and, and alternatives with or', () => {
    expect(describeAlternatives([['php', 'composer'], ['ddev']])).toBe(
      'php and composer, or ddev'
    )
    expect(describeAlternatives([['ddev']])).toBe('ddev')
    expect(describeAlternatives([['php', 'composer', 'drush']])).toBe(
      'php, composer and drush'
    )
  })
})
