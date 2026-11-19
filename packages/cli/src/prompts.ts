import type { Readable, Writable } from 'node:stream'
import { confirm, isCancel, select, text } from '@clack/prompts'
import type { Prompter } from './context.js'
import { DrxError } from './errors.js'

/** The value a prompt returned, or an error when the user cancelled it. */
function answered<T>(value: T | symbol): T {
  if (isCancel(value)) throw new DrxError('cancelled', 'Cancelled.')
  return value as T
}

/**
 * Prompts on the terminal. They are drawn on stderr, so stdout holds only
 * the result of the command.
 */
export function terminalPrompter(
  input: Readable = process.stdin,
  output: Writable = process.stderr
): Prompter {
  return {
    text: async ({ message, initial }) =>
      answered<string>(
        await text({
          message,
          input,
          output,
          ...(initial === undefined
            ? {}
            : { placeholder: initial, defaultValue: initial }),
        })
      ),

    select: async ({ message, choices, initial }) => {
      const options = choices.map(({ value, label, hint }) => ({
        value: value as string,
        label,
        ...(hint === undefined ? {} : { hint }),
      }))
      const value = await select<string>({
        message,
        options,
        input,
        output,
        ...(initial === undefined ? {} : { initialValue: initial }),
      })
      return answered<string>(value) as (typeof choices)[number]['value']
    },

    confirm: async ({ message, initial }) =>
      answered<boolean>(
        await confirm({ message, initialValue: initial, input, output })
      ),
  }
}
