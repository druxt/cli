import type { Readable, Writable } from 'node:stream'
import {
  autocomplete,
  autocompleteMultiselect,
  confirm,
  isCancel,
  select,
  text,
} from '@clack/prompts'
import type { Choice, Prompter } from './context.js'
import { DrxError } from './errors.js'

/** The value a prompt returned, or an error when the user cancelled it. */
function answered<T>(value: T | symbol): T {
  if (isCancel(value)) throw new DrxError('cancelled', 'Cancelled.')
  return value as T
}

function clackOptions(choices: Choice<string>[]) {
  return choices.map(({ value, label, hint, disabled }) => ({
    value: value as string,
    label,
    ...(hint === undefined ? {} : { hint }),
    ...(disabled ? { disabled } : {}),
  }))
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
      const options = clackOptions(choices)
      const value = await select<string>({
        message,
        options,
        input,
        output,
        ...(initial === undefined ? {} : { initialValue: initial }),
      })
      return answered<string>(value) as (typeof choices)[number]['value']
    },

    search: async ({ message, choices }) => {
      const value = await autocomplete<string>({
        message,
        options: clackOptions(choices),
        maxItems: 10,
        input,
        output,
      })
      return answered<string>(value) as (typeof choices)[number]['value']
    },

    pickMany: async ({ message, choices }) => {
      const values = await autocompleteMultiselect<string>({
        message,
        options: clackOptions(choices),
        maxItems: 10,
        required: true,
        input,
        output,
      })
      return answered<string[]>(values) as (typeof choices)[number]['value'][]
    },

    confirm: async ({ message, initial }) =>
      answered<boolean>(
        await confirm({ message, initialValue: initial, input, output })
      ),
  }
}
