import type { Choice, CliContext } from '../context.js'
import { DrxError } from '../errors.js'
import { createOutput } from '../output.js'
import { findProjectRoot, loadProjectConfig } from '../project.js'
import { repeatCommand } from '../repeat.js'
import { loadUserConfig } from '../user-config.js'

const NOT_YET = { hint: 'not available yet', disabled: true }

const OUTSIDE: Choice<string>[] = [
  { value: 'init', label: 'Create a site' },
  { value: 'quit', label: 'Quit' },
]

/** What can be done in a project. What is not built is shown, and says so. */
const INSIDE: Choice<string>[] = [
  { value: 'list', label: 'List the modules' },
  { value: 'search', label: 'Search the modules' },
  { value: 'show', label: "View a module's details" },
  { value: 'info', label: "View this project's details" },
  { value: 'add', label: 'Add a module' },
  { value: 'remove', label: 'Remove a module' },
  { value: 'configure', label: 'Configure a module', ...NOT_YET },
  { value: 'patches', label: 'Manage patches', ...NOT_YET },
  { value: 'quit', label: 'Quit' },
]

/**
 * What bare `drx` shows a person at a terminal: the wordmark, the project
 * they are in, and the actions that apply there. Each action is run as the
 * command it stands for, through `run`, so the menu has no behaviour of its
 * own to keep in step.
 */
export async function runMenu(
  context: CliContext,
  options: { banner: boolean },
  run: (argv: string[]) => Promise<number>
): Promise<number> {
  const output = createOutput(context, false)
  const userConfig = await loadUserConfig(context.env)
  const drawn = output.banner({
    ...(options.banner ? {} : { flag: false }),
    ...(userConfig.banner === undefined
      ? {}
      : { configured: userConfig.banner }),
  })
  if (!drawn) output.header()

  const root = findProjectRoot(context.cwd)
  if (root) {
    const config = await loadProjectConfig(root)
    output.line(`Project  ${root}`)
    output.line(
      `  ${config.starter} starter, ${config.layout} layout, ${config.line}`
    )
    for (const part of config.parts) {
      const engine = part.engine ? `  ${part.engine} engine` : ''
      output.line(
        `  ${output.err.role(part.role, `${part.role}  ${part.kind}  ${part.path}/`)}${engine}`
      )
    }
  } else {
    output.line(`No Druxt project in ${context.cwd}.`)
  }
  output.line()

  const choice = await context.prompter.select({
    message: 'What would you like to do?',
    choices: root ? INSIDE : OUTSIDE,
  })

  /** Runs a command and then says how to run it without the menu. */
  const repeatable = async (argv: string[]) => {
    const code = await run(argv)
    if (code === 0) {
      output.line()
      output.line(`Repeat this with: ${repeatCommand(argv)}`)
    }
    return code
  }

  switch (choice) {
    case 'quit':
      return 0
    // The wordmark is on the screen already. These two say how to repeat
    // themselves, since only they know what was chosen along the way.
    case 'init':
      return run(['init', '--no-banner'])
    case 'show':
      return run(['module'])
    case 'list':
      return repeatable(['module', 'list'])
    case 'info':
      return repeatable(['info'])
    case 'search': {
      const text = await context.prompter.text({ message: 'Search for what?' })
      return repeatable(['module', 'search', text])
    }
    // Each of these picks its modules and says how to repeat itself.
    case 'add':
    case 'remove':
      return run([choice])
    case 'configure':
      return run(['module', choice])
    default:
      throw new DrxError('not-available', `"${choice}" is not available yet.`)
  }
}
