import {
  isHttpUrl,
  isInsidePath,
  isNonEmptyString,
  isRecord,
} from './validate.js'

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
  /** How a backend part is run on this machine, by the name of its engine. */
  engine?: string
  /** The database the engine was set up with, where it offers a choice. */
  database?: string
  /** The URL of a backend that is not run on this machine. */
  baseUrl?: string
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
    for (const key of ['engine', 'database']) {
      if (part[key] !== undefined && !isNonEmptyString(part[key])) {
        return `${at}.${key} must be a non-empty string`
      }
    }
    if (part.baseUrl !== undefined && !isHttpUrl(part.baseUrl)) {
      return `${at}.baseUrl must be an http or https URL`
    }
  }
  return undefined
}
