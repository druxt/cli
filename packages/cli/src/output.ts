import type { CliContext } from './context.js'

/**
 * Where a command writes. The result goes to stdout: text, or JSON with
 * `--json`. Everything said along the way goes to stderr, so stdout can be
 * piped or parsed whichever form it takes.
 */
export interface Output {
  readonly json: boolean
  /** Progress, on stderr. */
  note(message: string): void
  /** Something the user should know that does not stop the command. */
  warn(message: string): void
  /** The result, on stdout. `text` is used unless `--json` was given. */
  result(data: unknown, text: string): void
}

export function createOutput(context: CliContext, json: boolean): Output {
  return {
    json,
    note: (message) => context.stderr.write(`${message}\n`),
    warn: (message) => context.stderr.write(`Warning: ${message}\n`),
    result: (data, text) =>
      context.stdout.write(
        json ? `${JSON.stringify(data, null, 2)}\n` : `${text}\n`
      ),
  }
}

/** Lines of cells, with every column padded to its widest cell. */
export function columns(rows: string[][], indent = ''): string[] {
  const widths: number[] = []
  for (const row of rows) {
    for (const [index, cell] of row.entries()) {
      widths[index] = Math.max(widths[index] ?? 0, cell.length)
    }
  }
  return rows.map(
    (row) =>
      indent +
      row
        .map((cell, index) => cell.padEnd(widths[index] ?? 0))
        .join('  ')
        .trimEnd()
  )
}
