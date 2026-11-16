import type { Role } from './parts.js'

type Env = Record<string, string | undefined>

/** How many colours the terminal a stream is attached to can show. */
export type ColorLevel = 'truecolor' | '256' | '16' | 'none'

/**
 * The colour depth to write a stream in.
 *
 * `--json` output is never coloured. `NO_COLOR` turns colour off and
 * `FORCE_COLOR` turns it on at a depth of 1, 2 or 3, whatever the stream is.
 * Otherwise colour needs a terminal that is not `dumb` and is not under `CI`,
 * and the depth is read from `COLORTERM` and `TERM`.
 */
export function detectColor(options: {
  env: Env
  isTTY: boolean
  json: boolean
}): ColorLevel {
  const { env } = options
  if (options.json || env.NO_COLOR) return 'none'

  const forced = env.FORCE_COLOR
  if (forced !== undefined) {
    if (forced === '0' || forced === 'false') return 'none'
    if (forced === '3') return 'truecolor'
    if (forced === '2') return '256'
    return '16'
  }

  if (!options.isTTY || env.CI || env.TERM === 'dumb') return 'none'
  if (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit') {
    return 'truecolor'
  }
  if (env.TERM?.includes('256color')) return '256'
  return '16'
}

/** True when the terminal can be expected to draw marks and block letters. */
export function supportsUnicode(
  env: Env,
  platform: string = process.platform
): boolean {
  if (platform !== 'win32') return env.TERM !== 'linux'
  return Boolean(
    env.WT_SESSION ||
    env.TERM_PROGRAM === 'vscode' ||
    env.TERM === 'xterm-256color' ||
    env.TERM === 'alacritty'
  )
}

/**
 * The Druxt wordmark, as the quickstart starter prints it. It says DRUXT.JS
 * whatever the frontend is built with, since the frontend is JavaScript.
 */
export const WORDMARK = `██████╗ ██████╗ ██╗   ██╗██╗  ██╗████████╗     ██╗███████╗
██╔══██╗██╔══██╗██║   ██║╚██╗██╔╝╚══██╔══╝     ██║██╔════╝
██║  ██║██████╔╝██║   ██║ ╚███╔╝    ██║        ██║███████╗
██║  ██║██╔══██╗██║   ██║ ██╔██╗    ██║   ██   ██║╚════██║
██████╔╝██║  ██╗╚██████╔╝██╔╝ ██╗   ██║██╗╚█████╔╝███████║
╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝   ╚═╝╚═╝ ╚════╝ ╚══════╝`

export const WORDMARK_WIDTH = Math.max(
  ...WORDMARK.split('\n').map((line) => line.length)
)

/** The brand pair: blue for the backend, green for the frontend. */
const BLUE = { rgb: [52, 152, 219], basic: 34 } as const
const GREEN = { rgb: [65, 184, 131], basic: 32 } as const
const YELLOW = { rgb: [241, 196, 15], basic: 33 } as const
const RED = { rgb: [231, 76, 60], basic: 31 } as const
type Colour = { rgb: readonly [number, number, number]; basic: number }

const ESC = '\u001B['
const RESET = `${ESC}39m`

/** The nearest colour of the 256-colour cube. */
function cube([r, g, b]: readonly [number, number, number]): number {
  const step = (value: number) => Math.round((value / 255) * 5)
  return 16 + 36 * step(r) + 6 * step(g) + step(b)
}

function open(level: ColorLevel, colour: Colour): string {
  if (level === 'truecolor') return `${ESC}38;2;${colour.rgb.join(';')}m`
  if (level === '256') return `${ESC}38;5;${cube(colour.rgb)}m`
  return `${ESC}${colour.basic}m`
}

const MARKS = {
  done: { unicode: '\u2714', ascii: '+', colour: GREEN },
  working: { unicode: '\u25C6', ascii: '*', colour: BLUE },
  warning: { unicode: '\u25B2', ascii: '!', colour: YELLOW },
  failed: { unicode: '\u2716', ascii: 'x', colour: RED },
} as const

export type Mark = keyof typeof MARKS

/** How text is dressed for one stream. Every method returns plain text when colour is off. */
export interface Presentation {
  readonly color: ColorLevel
  readonly unicode: boolean
  /** One of the four marks. Each is a different shape, so it reads without colour. */
  mark(kind: Mark): string
  /** Text in the colour of a part's role: blue for a backend, green for a frontend. */
  role(role: Role, text: string): string
  bold(text: string): string
  dim(text: string): string
  /** The wordmark, running from blue on the left to green on the right. */
  wordmark(): string
}

export function createPresentation(options: {
  color: ColorLevel
  unicode: boolean
}): Presentation {
  const { color, unicode } = options
  const on = color !== 'none'
  const paint = (colour: Colour, text: string) =>
    on ? `${open(color, colour)}${text}${RESET}` : text

  /** The colour of one column of the wordmark. */
  const across = (column: number): Colour => {
    const t = column / (WORDMARK_WIDTH - 1)
    if (color === '16') return t < 0.5 ? BLUE : GREEN
    const mix = (index: 0 | 1 | 2) =>
      Math.round(BLUE.rgb[index] + (GREEN.rgb[index] - BLUE.rgb[index]) * t)
    return { rgb: [mix(0), mix(1), mix(2)], basic: BLUE.basic }
  }

  return {
    color,
    unicode,
    mark: (kind) =>
      paint(
        MARKS[kind].colour,
        unicode ? MARKS[kind].unicode : MARKS[kind].ascii
      ),
    role: (role, text) => paint(role === 'backend' ? BLUE : GREEN, text),
    bold: (text) => (on ? `${ESC}1m${text}${ESC}22m` : text),
    dim: (text) => (on ? `${ESC}2m${text}${ESC}22m` : text),

    wordmark() {
      if (!unicode) return 'DRUXT.JS'
      if (!on) return WORDMARK
      return WORDMARK.split('\n')
        .map((line) => {
          let drawn = ''
          let last = ''
          for (const [column, character] of [...line].entries()) {
            // A new code only where the colour changes keeps the line short.
            const code = open(color, across(column))
            if (code !== last) drawn += code
            last = code
            drawn += character
          }
          return drawn + RESET
        })
        .join('\n')
    },
  }
}

/** The presentation for a stream, from the environment it writes in. */
export function presentationFor(
  stream: { isTTY?: boolean },
  env: Env,
  json: boolean
): Presentation {
  return createPresentation({
    color: detectColor({ env, isTTY: stream.isTTY === true, json }),
    unicode: supportsUnicode(env),
  })
}

/**
 * Whether the wordmark may be shown: in a terminal at least as wide as the
 * art, not under `CI`, not with `--json`, and not turned off by `--no-banner`
 * or by `"banner": false` in the user configuration.
 */
export function bannerAllowed(options: {
  env: Env
  isTTY: boolean
  columns: number | undefined
  json: boolean
  /** The value of the banner flag, when it was given. */
  flag: boolean | undefined
  /** The value of `banner` in the user configuration, when it is set. */
  configured: boolean | undefined
}): boolean {
  return (
    options.isTTY &&
    !options.json &&
    !options.env.CI &&
    options.flag !== false &&
    options.configured !== false &&
    (options.columns ?? 0) >= WORDMARK_WIDTH
  )
}
