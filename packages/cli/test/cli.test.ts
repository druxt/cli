import { afterEach, describe, expect, test } from 'vitest'
import { cliVersion } from '../src/package-root.js'
import { run } from './helpers/run.js'
import { cleanTmp } from './helpers/tmp.js'

afterEach(cleanTmp)

describe('drx', () => {
  test('--version prints the version and nothing else', async () => {
    const result = await run(['--version'])
    expect(result).toEqual({ code: 0, stdout: `${cliVersion()}\n`, stderr: '' })
  })

  test('--help lists the commands', async () => {
    const result = await run(['--help'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('USAGE drx')
    expect(result.stdout).toMatch(/init\s+Create a Druxt site from a starter/)
    expect(result.stdout).toMatch(/info\s+Print the versions/)
    expect(result.stderr).toBe('')
  })

  test('<command> --help describes that command', async () => {
    const result = await run(['info', '--help'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('USAGE drx info')
    expect(result.stdout).toContain('--json')
  })

  test('with no command prints the usage and fails', async () => {
    const result = await run([])
    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('USAGE drx')
  })

  test('fails on an unknown command', async () => {
    const result = await run(['launch'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Unknown command launch')
    expect(result.stderr).toContain('drx --help')
  })

  test('fails on an unknown option, naming it', async () => {
    const result = await run(['info', '--colour'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'Unknown option --colour. Run "drx info --help" for the options.'
    )
  })

  test('reports a failure as JSON on stdout when --json is given', async () => {
    const result = await run(['info', '--json', '--colour'])
    expect(result.code).toBe(1)
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      error: {
        code: 'usage',
        message:
          'Unknown option --colour. Run "drx info --help" for the options.',
      },
    })
  })
})
