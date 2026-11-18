import type { EngineAdapter } from './engine.js'

/**
 * PHP on the machine itself. Composer is on PATH. Every other tool is one
 * Composer installed for the project, so it is run from Composer's bin
 * directory and needs no global install.
 */
export const phpEngine: EngineAdapter = {
  name: 'php',
  run: (part, command, args) => ({
    command: command === 'composer' ? command : `vendor/bin/${command}`,
    args,
    cwd: part.path,
  }),
}
