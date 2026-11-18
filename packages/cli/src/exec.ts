import { spawn } from 'node:child_process'
import { extname } from 'node:path'
import { findCommandFile } from './commands-on-path.js'

export interface ToolResult {
  code: number
  /** What the tool printed, stdout and stderr together in order. */
  output: string
}

/** Runs a tool and waits for it, keeping its output to show if it fails. */
export type RunTool = (
  command: string,
  args: string[],
  options: { cwd: string }
) => Promise<ToolResult>

/** What to start, and how its arguments are handed over. */
export interface Spawn {
  file: string
  args: string[]
  /** True when the arguments are a command line, to pass on as written. */
  verbatim: boolean
}

/** The extensions of a file Windows runs with its command interpreter. */
const BATCH = ['.cmd', '.bat']

/**
 * What the command interpreter still reads inside double quotes: a quote
 * ends them, a percent sign expands a variable, and a line ends the command.
 */
const READ_IN_QUOTES = /["%\r\n]/

/** An argument in double quotes, which the interpreter then reads as text. */
const quoted = (value: string) => `"${value.replace(/(\\+)$/, '$1$1')}"`

/**
 * How a command is started, so that no argument is ever read as anything
 * but an argument.
 *
 * Everywhere but Windows that is the command and its arguments, with no
 * shell. On Windows a program is started by its file in the same way. A
 * batch file, which is what `npm`, `composer` and the like are there, can
 * only be run by the command interpreter. It is given one command line
 * with every argument in double quotes, where `&`, `|`, `<`, `>` and `^`
 * are plain characters. An argument with a character that is read even
 * there is refused, since there is no way to pass it on unchanged.
 */
export function spawnOf(
  command: string,
  args: string[],
  on: {
    platform: string
    /** The file a command resolves to, or undefined. */
    find: (command: string) => string | undefined
    /** The command interpreter, where the system names one. */
    shell?: string
  }
): Spawn | { refused: string } {
  if (on.platform !== 'win32') return { file: command, args, verbatim: false }
  const file = on.find(command)
  if (!file || !BATCH.includes(extname(file).toLowerCase())) {
    return { file: file ?? command, args, verbatim: false }
  }
  const unsafe = [file, ...args].find((value) => READ_IN_QUOTES.test(value))
  if (unsafe !== undefined) {
    return {
      refused: `${command} is a batch file on Windows, and ${JSON.stringify(unsafe)} cannot be handed to one as it is: it has a quote, a percent sign or a line break in it.`,
    }
  }
  const line = [file, ...args].map(quoted).join(' ')
  // /d runs no AutoRun command, and /s takes the line between the outer
  // quotes as it is written.
  return {
    file: on.shell ?? 'cmd.exe',
    args: ['/d', '/s', '/c', `"${line}"`],
    verbatim: true,
  }
}

/**
 * A `RunTool` for a platform and its environment. A tool that cannot be
 * started is a failure like any other, with the reason as its output.
 */
export function runToolOn(
  platform: string,
  env: Record<string, string | undefined>
): RunTool {
  return (command, args, { cwd }) =>
    new Promise((resolve) => {
      const plan = spawnOf(command, args, {
        platform,
        find: (name) => findCommandFile(name, cwd, env, platform),
        ...(env.ComSpec ? { shell: env.ComSpec } : {}),
      })
      if ('refused' in plan) {
        resolve({ code: 126, output: plan.refused })
        return
      }
      let output = ''
      const child = spawn(plan.file, plan.args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsVerbatimArguments: plan.verbatim,
      })
      child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
      child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
      child.on('error', (error) =>
        resolve({
          code: 127,
          output: `${command} could not be started: ${error.message}`,
        })
      )
      child.on('close', (code) => resolve({ code: code ?? 1, output }))
    })
}

/** Runs a command with no shell that reads its arguments. */
export const runTool: RunTool = runToolOn(process.platform, process.env)
