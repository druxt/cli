import type { Part } from '../parts.js'

/** A command line, and the directory to run it in, from the project root. */
export interface EngineCommand {
  command: string
  args: string[]
  cwd: string
}

/**
 * How the tools of a backend part are run when the part is run a certain
 * way. A command that changes the backend asks the part's engine for the
 * command line, and never names an engine itself. A new engine is a new file
 * in this directory and a line in index.ts.
 */
export interface EngineAdapter {
  /** The value a part's `engine` holds. */
  readonly name: string
  /** False when the backend is somewhere this machine cannot run tools in. */
  readonly local: boolean
  /**
   * The command line that runs a backend tool, such as its package manager,
   * with the given arguments.
   */
  run(part: Part, command: string, args: string[]): EngineCommand
}

/**
 * An engine that runs every tool as an argument of its own command, in the
 * part's directory, as container tools do.
 */
export function wrappingEngine(name: string): EngineAdapter {
  return {
    name,
    local: true,
    run: (part, command, args) => ({
      command: name,
      args: [command, ...args],
      cwd: part.path,
    }),
  }
}
