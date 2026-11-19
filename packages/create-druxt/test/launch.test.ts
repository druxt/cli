import { describe, expect, test } from 'vitest'
import { launch, MINIMUM_NODE, tooOld } from '../src/launch.js'

describe('launching create-druxt', () => {
  test('knows a Node older than the minimum', () => {
    expect(tooOld('16.18.1')).toBe(true)
    expect(tooOld('22.11.9')).toBe(true)
    expect(tooOld(MINIMUM_NODE.join('.'))).toBe(false)
    expect(tooOld('24.2.0')).toBe(false)
  })

  test('stops on an old Node before @druxt/cli is loaded', async () => {
    let text = ''
    const code = await launch('16.18.1', ['site'], {
      write: (chunk: string) => (text += chunk),
    })
    expect(code).toBe(1)
    expect(text).toContain('create-druxt needs Node 22.12.0 or later')
    expect(text).toContain('this is Node 16.18.1')
  })
})
