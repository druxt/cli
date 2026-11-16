import { describe, expect, test } from 'vitest'
import type { CliContext } from '../src/context.js'
import { createOutput } from '../src/output.js'
import { cliVersion } from '../src/package-root.js'

function context(options: { tty: boolean; env?: Record<string, string> }) {
  let stdout = ''
  let stderr = ''
  const made = {
    env: options.env ?? {},
    stdout: { write: (chunk: string) => (stdout += chunk), isTTY: options.tty },
    stderr: {
      write: (chunk: string) => (stderr += chunk),
      isTTY: options.tty,
      columns: 80,
    },
  } as unknown as CliContext
  return { made, read: () => ({ stdout, stderr }) }
}

describe('output without a terminal', () => {
  test('writes plain lines, with no marks, header or done lines', () => {
    const { made, read } = context({ tty: false })
    const output = createOutput(made, false)
    output.header()
    output.note('Reading.')
    output.done('Read.')
    output.warn('Careful.')
    expect(read().stderr).toBe('Reading.\nWarning: Careful.\n')
    expect(output.decorated).toBe(false)
  })
})

describe('output in a terminal', () => {
  test('marks each line, and says Warning in words as well', () => {
    const { made, read } = context({ tty: true, env: { NO_COLOR: '1' } })
    const output = createOutput(made, false)
    output.header()
    output.header()
    output.note('Reading.')
    output.done('Read.')
    output.warn('Careful.')
    expect(read().stderr).toBe(
      [
        `◆ druxt ${cliVersion()}`,
        '◆ Reading.',
        '✔ Read.',
        '▲ Warning: Careful.',
        '',
      ].join('\n')
    )
  })

  test('uses ASCII marks where Unicode cannot be drawn', () => {
    const { made, read } = context({
      tty: true,
      env: { NO_COLOR: '1', TERM: 'linux' },
    })
    const output = createOutput(made, false)
    output.note('Reading.')
    output.done('Read.')
    expect(read().stderr).toBe('* Reading.\n+ Read.\n')
  })

  test('is plain with --json, and the result is JSON alone', () => {
    const { made, read } = context({ tty: true })
    const output = createOutput(made, true)
    output.header()
    output.note('Reading.')
    output.done('Read.')
    output.result({ ok: true }, 'text')
    expect(read().stderr).toBe('Reading.\n')
    expect(JSON.parse(read().stdout)).toEqual({ ok: true })
    expect(output.out.color).toBe('none')
  })

  test('colours stderr and stdout by what each is attached to', () => {
    const { made } = context({ tty: true, env: { COLORTERM: 'truecolor' } })
    const output = createOutput(made, false)
    expect(output.err.color).toBe('truecolor')
    expect(output.out.color).toBe('truecolor')
  })
})

describe('the banner', () => {
  test('is drawn on stderr in a terminal wide enough, once', () => {
    const { made, read } = context({ tty: true, env: { NO_COLOR: '1' } })
    const output = createOutput(made, false)
    expect(output.banner({})).toBe(true)
    expect(read().stderr).toContain('██████╗')
    expect(read().stdout).toBe('')
    // The small header would say the same thing twice.
    output.header()
    expect(read().stderr).not.toContain('druxt ')
  })

  test('is not drawn when the flag or the configuration says no', () => {
    const { made, read } = context({ tty: true })
    const output = createOutput(made, false)
    expect(output.banner({ flag: false })).toBe(false)
    expect(output.banner({ configured: false })).toBe(false)
    expect(read().stderr).toBe('')
  })

  test('is not drawn without a terminal', () => {
    const { made, read } = context({ tty: false })
    expect(createOutput(made, false).banner({})).toBe(false)
    expect(read().stderr).toBe('')
  })
})
