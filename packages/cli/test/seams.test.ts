import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'
import { bundledRegistryDir, packageRoot } from '../src/package-root.js'

const KIND_WORD = /nuxt|drupal/i

/** Every file under a directory, as paths relative to it. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
}

/** Every key of a JSON value, at any depth. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf)
  if (typeof value !== 'object' || value === null) return []
  return Object.entries(value).flatMap(([key, inner]) => [
    key,
    ...keysOf(inner),
  ])
}

// A kind is a value, and what is specific to it is in its adapter. Nothing
// else may name one, or a later kind would need changes outside adapters/.
describe('the names of kinds', () => {
  test('appear in the sources only inside adapters/', () => {
    const src = join(packageRoot(), 'src')
    const offenders = filesUnder(src)
      .filter((file) => !file.startsWith('adapters'))
      .filter((file) => KIND_WORD.test(readFileSync(join(src, file), 'utf8')))
    expect(offenders).toEqual([])
  })

  test('are never a key in a registry file', () => {
    const dir = bundledRegistryDir()
    const keys = filesUnder(dir).flatMap((file) =>
      keysOf(JSON.parse(readFileSync(join(dir, file), 'utf8')))
    )
    expect(keys.length).toBeGreaterThan(0)
    expect(keys.filter((key) => KIND_WORD.test(key))).toEqual([])
  })
})
