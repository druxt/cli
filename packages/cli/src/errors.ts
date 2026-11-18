/** What went wrong, for a caller reading `--json` output. */
export type DrxErrorCode =
  | 'usage'
  | 'not-available'
  | 'registry'
  | 'invalid-entry'
  | 'unknown-starter'
  | 'unknown-source'
  | 'directory-not-empty'
  | 'config'
  | 'download'
  | 'install'
  | 'cancelled'

/**
 * A failure the user can act on. Its message is printed as it is, with no
 * stack trace, and the process exits non-zero.
 */
export class DrxError extends Error {
  readonly code: DrxErrorCode

  constructor(code: DrxErrorCode, message: string) {
    super(message)
    this.name = 'DrxError'
    this.code = code
  }
}
