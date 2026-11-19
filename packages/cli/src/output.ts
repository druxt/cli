import type { CliContext } from './context.js'
import { cliVersion } from './package-root.js'
import {
  bannerAllowed,
  presentationFor,
  type Presentation,
} from './presentation.js'

/**
 * The streams that already have the wordmark or the small header. The menu
 * draws one and then runs a command, which makes an output of its own.
 */
const HEADED = new WeakSet<object>()

/**
 * Where a command writes. The result goes to stdout: text, or JSON with
 * `--json`. Everything said along the way goes to stderr, so stdout can be
 * piped or parsed whichever form it takes.
 *
 * In a terminal the lines on stderr carry a mark. Anywhere else they are the
 * plain sentences, with nothing added, so a log reads the same as before.
 */
export interface Output {
  readonly json: boolean
  /** True when stderr is a terminal a person is reading. */
  readonly decorated: boolean
  /** How to dress text for stdout. */
  readonly out: Presentation
  /** How to dress text for stderr. */
  readonly err: Presentation
  /** A step that is starting, on stderr. */
  note(message: string): void
  /** A step that finished. Printed in a terminal only. */
  done(message: string): void
  /** Something that was done, said once it is done. Printed everywhere. */
  did(message: string): void
  /** Something the user should know that does not stop the command. */
  warn(message: string): void
  /** A line on stderr with nothing added. */
  line(message?: string): void
  /**
   * The small header, `druxt` and the version, for a command that prints
   * more than a line or two. Printed once, in a terminal only.
   */
  header(): void
  /**
   * The wordmark, when the terminal and the settings allow it. Returns
   * whether it was drawn. The small header is not printed after it.
   */
  banner(settings: { flag?: boolean; configured?: boolean }): boolean
  /** The result, on stdout. `text` is used unless `--json` was given. */
  result(data: unknown, text: string): void
}

export function createOutput(context: CliContext, json: boolean): Output {
  const { stdout, stderr, env } = context
  const out = presentationFor(stdout, env, json)
  const err = presentationFor(stderr, env, json)
  const decorated = stderr.isTTY === true && !json
  const write = (text: string) => stderr.write(`${text}\n`)
  const marked = (kind: Parameters<Presentation['mark']>[0], text: string) =>
    decorated ? `${err.mark(kind)} ${text}` : text
  let headed = false

  return {
    json,
    decorated,
    out,
    err,
    note: (message) => write(marked('working', message)),
    done: (message) => {
      if (decorated) write(marked('done', message))
    },
    did: (message) => write(marked('done', message)),
    warn: (message) => write(marked('warning', `Warning: ${message}`)),
    line: (message = '') => write(message),
    header() {
      if (!decorated || headed || HEADED.has(stderr)) return
      headed = true
      HEADED.add(stderr)
      write(marked('working', err.bold(`druxt ${cliVersion()}`)))
    },
    banner({ flag, configured }) {
      const allowed = bannerAllowed({
        env,
        isTTY: stderr.isTTY === true,
        columns: stderr.columns,
        json,
        flag,
        configured,
      })
      if (!allowed) return false
      headed = true
      HEADED.add(stderr)
      write(`\n${err.wordmark()}\n`)
      return true
    },
    result: (data, text) =>
      stdout.write(json ? `${JSON.stringify(data, null, 2)}\n` : `${text}\n`),
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
