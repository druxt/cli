import { readFile } from 'node:fs/promises'
import { isRecord } from '../validate.js'

/** A JSON file's object, or undefined when it is missing or not an object. */
export async function readJsonObject(
  file: string
): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/** The string values of one key of an object, such as `dependencies`. */
export function stringMap(
  object: Record<string, unknown> | undefined,
  key: string
): Record<string, string> {
  const value = object?.[key]
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  )
}
