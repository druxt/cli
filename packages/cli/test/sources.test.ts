import { describe, expect, test } from 'vitest'
import { DrxError } from '../src/errors.js'
import { assertSourceAvailable, resolveSource } from '../src/sources.js'
import type { UserConfig } from '../src/user-config.js'

const config: UserConfig = {
  path: '/home/me/.config/drx/config.json',
  registries: {},
  sources: {
    next: { type: 'npm', tag: 'next' },
    branch: { type: 'git', url: 'https://example.com/druxt.git', ref: 'x' },
  },
}

describe('resolveSource', () => {
  test('knows npm with no configuration', () => {
    expect(resolveSource('npm', config)).toEqual({
      name: 'npm',
      type: 'npm',
      tag: 'latest',
    })
  })

  test('reads a git reference with a ref', () => {
    expect(
      resolveSource('git:https://example.com/druxt.git#feature/x', config)
    ).toEqual({
      name: 'git:https://example.com/druxt.git#feature/x',
      type: 'git',
      url: 'https://example.com/druxt.git',
      ref: 'feature/x',
    })
  })

  test('reads a git reference with no ref', () => {
    expect(resolveSource('git:https://example.com/druxt.git', config)).toEqual({
      name: 'git:https://example.com/druxt.git',
      type: 'git',
      url: 'https://example.com/druxt.git',
    })
  })

  test('looks a name up in the user configuration', () => {
    expect(resolveSource('next', config)).toEqual({
      name: 'next',
      type: 'npm',
      tag: 'next',
    })
    expect(resolveSource('branch', config)).toEqual({
      name: 'branch',
      type: 'git',
      url: 'https://example.com/druxt.git',
      ref: 'x',
    })
  })

  test('fails on an unknown name, saying where names are defined', () => {
    const attempt = () => resolveSource('elsewhere', config)
    expect(attempt).toThrow(DrxError)
    expect(attempt).toThrow(
      'Unknown source "elsewhere". Use npm, git:<url>#<ref>, or a name defined in /home/me/.config/drx/config.json (branch, next).'
    )
  })
})

describe('assertSourceAvailable', () => {
  test('accepts the built-in npm source', () => {
    expect(() =>
      assertSourceAvailable(resolveSource('npm', config))
    ).not.toThrow()
  })

  test.each(['next', 'branch', 'git:https://example.com/druxt.git#x'])(
    'says %s is not available yet',
    (name) => {
      expect(() => assertSourceAvailable(resolveSource(name, config))).toThrow(
        `The source "${name}" is not available yet. Only the npm source works in this version.`
      )
    }
  )
})
