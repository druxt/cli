export const ROLES = ['frontend', 'backend'] as const
export type Role = (typeof ROLES)[number]

/**
 * One side of a site. The role says what it is for and the kind says what it
 * is built with. The kind is a plain string, so a new one needs an adapter
 * and no change to this type.
 */
export interface Part {
  role: Role
  kind: string
  /** Relative to the project root, with forward slashes. */
  path: string
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/** True for a path that stays inside the directory it is resolved against. */
function isInsidePath(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false
  if (value.startsWith('/') || /^[a-z]:/i.test(value)) return false
  return !value.split(/[\\/]/).includes('..')
}

/**
 * The first problem with a list of parts, as "<label>... must be ...", or
 * undefined when the list is valid.
 */
export function partsProblem(
  value: unknown,
  label: string
): string | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return `${label} must be a non-empty array`
  }
  for (const [index, part] of value.entries()) {
    const at = `${label}[${index}]`
    if (!isRecord(part)) return `${at} must be an object`
    if (!ROLES.includes(part.role as Role)) {
      return `${at}.role must be one of ${ROLES.join(', ')}`
    }
    if (!isNonEmptyString(part.kind)) {
      return `${at}.kind must be a non-empty string`
    }
    if (!isInsidePath(part.path)) {
      return `${at}.path must be a relative path inside the project`
    }
  }
  return undefined
}
