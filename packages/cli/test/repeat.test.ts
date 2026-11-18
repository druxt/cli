import { execFileSync } from 'node:child_process'
import { describe, expect, test } from 'vitest'
import { repeatCommand, shellQuote } from '../src/repeat.js'

describe('shellQuote', () => {
  test.each([
    ['my-site', 'my-site'],
    ['--engine', '--engine'],
    ['https://example.com/a?b=1', "'https://example.com/a?b=1'"],
    ['./sites/a_b.c', './sites/a_b.c'],
    ['my site', "'my site'"],
    ["it's", `'it'\\''s'`],
    ['a "quoted" name', `'a "quoted" name'`],
    ['$HOME', `'$HOME'`],
    ['', "''"],
    ['a;b', "'a;b'"],
  ])('%j becomes %s', (value, quoted) => {
    expect(shellQuote(value)).toBe(quoted)
  })
})

describe('repeatCommand', () => {
  test('joins the arguments after drx', () => {
    expect(repeatCommand(['module', 'info', 'blocks'])).toBe(
      'drx module info blocks'
    )
  })

  // The real check of the quoting: a shell has to hand back the arguments
  // exactly as they went in.
  test.skipIf(process.platform === 'win32')(
    'survives a shell, with a space and both kinds of quote in a directory',
    () => {
      const argv = [
        'init',
        `my "site" isn't here`,
        '--engine',
        'none',
        '--base-url',
        'https://example.com/?a=1&b=$c',
        '--yes',
      ]
      const line = repeatCommand(argv)
      const echoed = execFileSync(
        'sh',
        ['-c', `drx() { printf '%s\\n' "$@"; }; ${line}`],
        { encoding: 'utf8' }
      )
      expect(echoed.trimEnd().split('\n')).toEqual(argv)
    }
  )
})
