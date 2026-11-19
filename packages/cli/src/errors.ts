/** What went wrong, for a caller reading `--json` output. */
export type DrxErrorCode =
  | 'usage'
  | 'not-available'
  | 'registry'
  | 'invalid-entry'
  | 'unknown-starter'
  | 'unknown-source'
  | 'unknown-module'
  | 'directory-not-empty'
  | 'config'
  | 'download'
  | 'install'
  | 'refused'
  | 'step-failed'
  | 'cancelled'
  | 'node'

/**
 * A failure the user can act on. Its message is printed as it is, with no
 * stack trace, and the process exits non-zero.
 */
export class DrxError extends Error {
  readonly code: DrxErrorCode
  /**
   * What a caller reading `--json` gets next to the code and the message, as
   * fields of the error. The message says the same in words.
   */
  readonly details?: Record<string, unknown>

  constructor(
    code: DrxErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'DrxError'
    this.code = code
    if (details) this.details = details
  }
}
