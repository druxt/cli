import { stripVTControlCharacters } from 'node:util'
import { describe, expect, test } from 'vitest'
import {
  bannerAllowed,
  createPresentation,
  detectColor,
  supportsUnicode,
  WORDMARK,
  WORDMARK_WIDTH,
} from '../src/presentation.js'

const tty = { isTTY: true, json: false }

describe('detectColor', () => {
  test.each([
    [{ COLORTERM: 'truecolor' }, 'truecolor'],
    [{ COLORTERM: '24bit' }, 'truecolor'],
    [{ TERM: 'xterm-256color' }, '256'],
    [{ TERM: 'xterm' }, '16'],
    [{}, '16'],
  ])('in a terminal with %j is %s', (env, level) => {
    expect(detectColor({ env, ...tty })).toBe(level)
  })

  test.each([
    ['NO_COLOR', { NO_COLOR: '1', COLORTERM: 'truecolor' }],
    ['a dumb terminal', { TERM: 'dumb' }],
    ['CI', { CI: 'true', COLORTERM: 'truecolor' }],
    ['FORCE_COLOR=0', { FORCE_COLOR: '0', COLORTERM: 'truecolor' }],
  ])('is off under %s', (_name, env) => {
    expect(detectColor({ env, ...tty })).toBe('none')
  })

  test('is off without a terminal, and with --json', () => {
    const env = { COLORTERM: 'truecolor' }
    expect(detectColor({ env, isTTY: false, json: false })).toBe('none')
    expect(detectColor({ env, isTTY: true, json: true })).toBe('none')
  })

  test('NO_COLOR wins over FORCE_COLOR, and an empty NO_COLOR is not set', () => {
    expect(
      detectColor({ env: { NO_COLOR: '1', FORCE_COLOR: '3' }, ...tty })
    ).toBe('none')
    expect(detectColor({ env: { NO_COLOR: '' }, ...tty })).toBe('16')
  })

  test.each([
    ['1', '16'],
    ['2', '256'],
    ['3', 'truecolor'],
    ['true', '16'],
  ])(
    'FORCE_COLOR=%s turns it on with no terminal and under CI, as %s',
    (value, level) => {
      expect(
        detectColor({
          env: { FORCE_COLOR: value, CI: 'true' },
          isTTY: false,
          json: false,
        })
      ).toBe(level)
    }
  )

  test('--json is plain even when colour is forced', () => {
    expect(
      detectColor({ env: { FORCE_COLOR: '3' }, isTTY: true, json: true })
    ).toBe('none')
  })
})

describe('supportsUnicode', () => {
  test('is true for a usual terminal and false for the Linux console', () => {
    expect(supportsUnicode({ TERM: 'xterm-256color' }, 'linux')).toBe(true)
    expect(supportsUnicode({ TERM: 'linux' }, 'linux')).toBe(false)
  })

  test('on Windows needs a terminal known to draw it', () => {
    expect(supportsUnicode({}, 'win32')).toBe(false)
    expect(supportsUnicode({ WT_SESSION: '1' }, 'win32')).toBe(true)
    expect(supportsUnicode({ TERM_PROGRAM: 'vscode' }, 'win32')).toBe(true)
  })
})

describe('the wordmark', () => {
  test('is six lines, each as wide as the widest', () => {
    const lines = WORDMARK.split('\n')
    expect(lines).toHaveLength(6)
    expect(new Set(lines.map((line) => line.length))).toEqual(
      new Set([WORDMARK_WIDTH])
    )
    expect(WORDMARK_WIDTH).toBe(58)
  })

  test('with colour off is the art and nothing else', () => {
    const plain = createPresentation({ color: 'none', unicode: true })
    expect(plain.wordmark()).toBe(WORDMARK)
  })

  test('with colour on is the same art under the codes', () => {
    for (const color of ['16', '256', 'truecolor'] as const) {
      const drawn = createPresentation({ color, unicode: true }).wordmark()
      expect(drawn).not.toBe(WORDMARK)
      expect(stripVTControlCharacters(drawn)).toBe(WORDMARK)
    }
  })

  test('runs from the backend blue on the left to the frontend green on the right', () => {
    const drawn = createPresentation({ color: 'truecolor', unicode: true })
      .wordmark()
      .split('\n')[0] as string
    expect(drawn.startsWith('\u001B[38;2;52;152;219m')).toBe(true)
    expect(drawn).toContain('\u001B[38;2;65;184;131m')
    expect(drawn.endsWith('\u001B[39m')).toBe(true)
  })

  test('in 16 colours is blue on the left half and green on the right', () => {
    const line = createPresentation({ color: '16', unicode: true })
      .wordmark()
      .split('\n')[0] as string
    expect(line.startsWith('\u001B[34m')).toBe(true)
    expect(line).toContain('\u001B[32m')
  })

  test('falls back to the name in a terminal that cannot draw the blocks', () => {
    expect(
      createPresentation({ color: 'none', unicode: false }).wordmark()
    ).toBe('DRUXT.JS')
  })
})

describe('marks', () => {
  test('are four different shapes, with or without Unicode', () => {
    for (const unicode of [true, false]) {
      const p = createPresentation({ color: 'none', unicode })
      const marks = (['done', 'working', 'warning', 'failed'] as const).map(
        (kind) => p.mark(kind)
      )
      expect(new Set(marks).size).toBe(4)
      if (!unicode) expect(marks.join('')).toMatch(/^[\x20-\x7E]+$/)
    }
  })

  test('are coloured when colour is on, and the shape stays', () => {
    const plain = createPresentation({ color: 'none', unicode: true })
    const colour = createPresentation({ color: '16', unicode: true })
    expect(colour.mark('failed')).not.toBe(plain.mark('failed'))
    expect(stripVTControlCharacters(colour.mark('failed'))).toBe(
      plain.mark('failed')
    )
  })
})

describe('role colouring', () => {
  test('makes a backend blue and a frontend green, in each depth', () => {
    const p16 = createPresentation({ color: '16', unicode: true })
    expect(p16.role('backend', 'B')).toBe('\u001B[34mB\u001B[39m')
    expect(p16.role('frontend', 'F')).toBe('\u001B[32mF\u001B[39m')

    const p256 = createPresentation({ color: '256', unicode: true })
    expect(stripVTControlCharacters(p256.role('backend', 'B'))).toBe('B')
    expect(p256.role('backend', 'B').startsWith('\u001B[38;5;')).toBe(true)

    const full = createPresentation({ color: 'truecolor', unicode: true })
    expect(full.role('backend', 'B')).toBe('\u001B[38;2;52;152;219mB\u001B[39m')
    expect(full.role('frontend', 'F')).toBe(
      '\u001B[38;2;65;184;131mF\u001B[39m'
    )
  })

  test('leaves the text alone with colour off', () => {
    const plain = createPresentation({ color: 'none', unicode: true })
    expect(plain.role('backend', 'B')).toBe('B')
    expect(plain.bold('x')).toBe('x')
    expect(plain.dim('x')).toBe('x')
  })
})

describe('bannerAllowed', () => {
  const yes = {
    env: {},
    isTTY: true,
    columns: 80,
    json: false,
    flag: undefined,
    configured: undefined,
  }

  test('is true in a terminal wide enough', () => {
    expect(bannerAllowed(yes)).toBe(true)
    expect(bannerAllowed({ ...yes, columns: 58 })).toBe(true)
  })

  test.each([
    ['--json', { json: true }],
    ['no terminal', { isTTY: false }],
    ['CI', { env: { CI: '1' } }],
    ['a narrow terminal', { columns: 57 }],
    ['a terminal of unknown width', { columns: undefined }],
    ['--no-banner', { flag: false }],
    ['"banner": false in the user configuration', { configured: false }],
  ])('is false with %s', (_name, change) => {
    expect(bannerAllowed({ ...yes, ...change })).toBe(false)
  })
})
