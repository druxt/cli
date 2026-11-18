import { afterEach, describe, expect, test } from 'vitest'
import { runTool } from '../src/exec.js'
import { cleanTmp, tmp } from './helpers/tmp.js'

afterEach(cleanTmp)

describe.skipIf(process.platform === 'win32')('runTool', () => {
  test('returns the exit code and everything the tool printed', async () => {
    const cwd = tmp()
    const result = await runTool(
      'sh',
      ['-c', 'echo out; echo err >&2; pwd; exit 3'],
      { cwd }
    )
    expect(result.code).toBe(3)
    expect(result.output).toContain('out\n')
    expect(result.output).toContain('err\n')
    expect(result.output).toContain(cwd)
  })

  test('reports a tool that is not installed as a failure, with the reason', async () => {
    const result = await runTool('no-such-tool-here', ['x'], { cwd: tmp() })
    expect(result.code).not.toBe(0)
    expect(result.output).toContain('no-such-tool-here')
  })
})
