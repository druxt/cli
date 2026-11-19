import { afterEach, describe, expect, test, vi } from 'vitest'
import { createDruxt, initArguments } from '../src/index.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('create-druxt', () => {
  test('puts init in front of the arguments it was given', () => {
    expect(
      initArguments(['my-site', '--yes', '--starter', 'quickstart'])
    ).toEqual(['init', 'my-site', '--yes', '--starter', 'quickstart'])
    expect(initArguments([])).toEqual(['init'])
  })

  test('runs the CLI with them and returns its exit code', async () => {
    const run = vi.fn(async () => 3)
    expect(await createDruxt(['my-site', '--no-install'], run)).toBe(3)
    expect(run).toHaveBeenCalledExactlyOnceWith([
      'init',
      'my-site',
      '--no-install',
    ])
  })

  test('reaches the init command of @druxt/cli', async () => {
    let printed = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      printed += String(chunk)
      return true
    })
    expect(await createDruxt(['--help'])).toBe(0)
    expect(printed).toContain('--starter')
    // The usage is headed by the name it was started under.
    expect(printed).toContain('create-druxt [OPTIONS]')
    expect(printed).not.toContain('drx init')
  })
})
