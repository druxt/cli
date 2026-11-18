import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { run } from '../helpers/run.js'
import {
  fixtureRegistry,
  STARTER_FILES,
  type FixtureRegistry,
} from '../helpers/starter.js'
import { cleanTmp, tmp } from '../helpers/tmp.js'

let registries: FixtureRegistry[] = []
let cwd: string

const registryWith = async (readme: string) => {
  const registry = await fixtureRegistry({
    ...STARTER_FILES,
    'README.md': readme,
  })
  registries.push(registry)
  return registry
}

beforeEach(() => {
  // One cache for the whole test, as one user has.
  vi.stubEnv('XDG_CACHE_HOME', tmp('drx-cache-'))
  vi.stubEnv('GIGET_REGISTRY', undefined)
  vi.stubEnv('GIGET_AUTH', undefined)
  cwd = tmp('drx-cwd-')
})

afterEach(async () => {
  await Promise.all(registries.map((registry) => registry.close()))
  registries = []
  vi.unstubAllEnvs()
  cleanTmp()
})

describe('drx init, the archive it unpacks', () => {
  // giget keeps each archive it fetches, and unpacks the kept one when a
  // fetch fails. Two registries can each have a starter called quickstart.
  test('is never one kept from another registry with a starter of the same name', async () => {
    const first = await registryWith('# From the first registry\n')
    const second = await registryWith('# From the second registry\n')
    delete second.files['/quickstart.tar.gz']

    await run(['init', 'one', '--yes', '--registry', first.url], { cwd })
    const result = await run(
      ['init', 'two', '--yes', '--registry', second.url],
      { cwd }
    )

    expect(result.stderr).toContain('Could not fetch the quickstart starter')
    expect(result.code).toBe(1)
    expect(existsSync(join(cwd, 'two', 'README.md'))).toBe(false)
  })

  test('is the kept one when the same registry cannot be reached again', async () => {
    const registry = await registryWith('# Fixture starter\n')
    await run(['init', 'one', '--yes', '--registry', registry.url], { cwd })
    delete registry.files['/quickstart.tar.gz']
    const result = await run(
      ['init', 'two', '--yes', '--registry', registry.url],
      { cwd }
    )
    expect(result.code).toBe(0)
    expect(readFileSync(join(cwd, 'two', 'README.md'), 'utf8')).toBe(
      '# Fixture starter\n'
    )
  })
})

describe('drx init, the directory in its next steps', () => {
  test('is quoted when a shell would split it', async () => {
    const registry = await registryWith('# Fixture starter\n')
    const result = await run(
      ['init', 'my site', '--yes', '--registry', registry.url],
      { cwd }
    )
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("cd 'my site'")
    expect(result.stdout).not.toContain('cd my site')
  })

  test('is quoted in the JSON result too', async () => {
    const registry = await registryWith('# Fixture starter\n')
    const result = await run(
      ['init', 'my site', '--yes', '--json', '--registry', registry.url],
      { cwd }
    )
    expect(JSON.parse(result.stdout).next[0]).toBe("cd 'my site'")
  })

  test('is left bare when it is plain', async () => {
    const registry = await registryWith('# Fixture starter\n')
    const result = await run(
      ['init', 'site', '--yes', '--registry', registry.url],
      { cwd }
    )
    expect(result.stdout).toContain('cd site')
  })
})
