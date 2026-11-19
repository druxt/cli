import { PassThrough } from 'node:stream'
import { describe, expect, test } from 'vitest'
import { DrxError } from '../src/errors.js'
import { terminalPrompter } from '../src/prompts.js'

/** A prompter on streams the test controls, and a way to press keys. */
function terminal() {
  const input = new PassThrough()
  const output = new PassThrough()
  let drawn = ''
  output.on('data', (chunk: Buffer) => (drawn += chunk.toString()))
  return {
    prompter: terminalPrompter(input, output),
    /** Sends keys once the prompt has had a turn to start listening. */
    press: (keys: string) => setTimeout(() => input.write(keys), 20),
    drawn: () => drawn,
  }
}

const ENTER = '\r'
const DOWN = '\u001B[B'
const CTRL_C = '\u0003'

describe('terminalPrompter', () => {
  test('text returns what was typed', async () => {
    const { prompter, press, drawn } = terminal()
    press(`my-site${ENTER}`)
    expect(await prompter.text({ message: 'Where?' })).toBe('my-site')
    expect(drawn()).toContain('Where?')
  })

  test('text returns the initial value when nothing is typed', async () => {
    const { prompter, press } = terminal()
    press(ENTER)
    expect(await prompter.text({ message: 'Where?', initial: 'site' })).toBe(
      'site'
    )
  })

  test('select starts on the initial choice and moves with the arrows', async () => {
    const choices = [
      { value: 'monorepo', label: 'monorepo' },
      { value: 'split', label: 'split', hint: 'not available yet' },
    ] as const
    const first = terminal()
    first.press(ENTER)
    expect(
      await first.prompter.select({
        message: 'Which layout?',
        choices: [...choices],
        initial: 'monorepo',
      })
    ).toBe('monorepo')

    const second = terminal()
    second.press(`${DOWN}${ENTER}`)
    expect(
      await second.prompter.select({
        message: 'Which layout?',
        choices: [...choices],
      })
    ).toBe('split')
  })

  test('confirm returns the initial answer on enter', async () => {
    const { prompter, press } = terminal()
    press(ENTER)
    expect(
      await prompter.confirm({ message: 'Install?', initial: false })
    ).toBe(false)
  })

  test('a cancelled prompt is an error, not an answer', async () => {
    const { prompter, press } = terminal()
    press(CTRL_C)
    const answer = prompter.confirm({ message: 'Install?', initial: true })
    await expect(answer).rejects.toThrow(DrxError)
    await expect(answer).rejects.toThrow('Cancelled.')
  })
})
