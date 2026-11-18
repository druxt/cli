/** Small checks shared by everything that reads JSON it did not write. */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

/**
 * True for a relative path that names something inside the directory it is
 * resolved against: not absolute, not the directory itself, and with no
 * segment that climbs out.
 */
export function isInsidePath(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false
  if (/^[\\/]/.test(value) || /^[a-z]:/i.test(value)) return false
  const segments = value.split(/[\\/]/).filter((segment) => segment !== '.')
  return segments.some(Boolean) && !segments.includes('..')
}

/** npm's own limit on the length of a package name. */
const NPM_NAME_LENGTH = 214
const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/

/**
 * True for a name npm takes for a new package: lower case, URL-safe, with an
 * optional scope, and starting with a letter or a digit. A name is handed to
 * a package manager as an argument, so one that starts with a hyphen, or has
 * a space or a character a shell reads, is not a name.
 */
export function isNpmName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= NPM_NAME_LENGTH &&
    NPM_NAME.test(value)
  )
}
