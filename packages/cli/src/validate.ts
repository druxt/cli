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
