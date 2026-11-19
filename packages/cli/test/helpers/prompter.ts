import type { Choice, Prompter } from '../../src/context.js'
import { DrxError } from '../../src/errors.js'

export interface Asked {
  message: string
  choices?: Choice<string>[]
}

/**
 * A prompter that answers each question by its message and records what it
 * was asked. `cancelAt` makes the prompt at that position behave as Ctrl-C
 * does, and an unexpected question fails the test.
 */
export function answering(
  answers: Record<string, unknown>,
  options: { cancelAt?: number } = {}
): { prompter: Prompter; asked: Asked[] } {
  const asked: Asked[] = []
  const answer = (message: string, choices?: Choice<string>[]) => {
    if (asked.length === options.cancelAt) {
      asked.push({ message })
      throw new DrxError('cancelled', 'Cancelled.')
    }
    asked.push(choices ? { message, choices } : { message })
    if (!(message in answers)) throw new Error(`Unexpected prompt: ${message}`)
    return answers[message]
  }
  return {
    asked,
    prompter: {
      text: async ({ message }) => answer(message) as string,
      select: async ({ message, choices }) => answer(message, choices) as never,
      search: async ({ message, choices }) => answer(message, choices) as never,
      pickMany: async ({ message, choices }) =>
        answer(message, choices) as never,
      confirm: async ({ message }) => answer(message) as boolean,
    },
  }
}
