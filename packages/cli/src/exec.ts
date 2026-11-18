import { spawn } from 'node:child_process'

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

/**
 * Runs a command with no shell. A tool that cannot be started is a failure
 * like any other, with the reason as its output.
 */
export const runTool: RunTool = (command, args, { cwd }) =>
  new Promise((resolve) => {
    let output = ''
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
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
