import { describe, expect, test } from 'vitest'
import { MINIMUM_NODE, nodeTooOld } from '../src/node-version.js'

describe('the Node version drx runs on', () => {
  test('is accepted at the minimum and above', () => {
    expect(nodeTooOld(MINIMUM_NODE)).toBeUndefined()
    expect(nodeTooOld('24.2.0')).toBeUndefined()
    expect(nodeTooOld('22.13.0')).toBeUndefined()
  })

  // A 0.x site pins Node 16, and a version manager switches to it in the site's directory.
  test('is refused below it, with both versions and a way to run drx', () => {
    const message = nodeTooOld('16.18.1')
    expect(message).toContain(`drx needs Node ${MINIMUM_NODE} or later`)
    expect(message).toContain('this is Node 16.18.1')
    expect(message).toContain('mise exec node@')
    expect(nodeTooOld('22.11.0')).toBeDefined()
    expect(nodeTooOld('20.19.0')).toBeDefined()
  })
})

describe('launching drx', () => {
  const sink = () => {
    let text = ''
    return { write: (chunk: string) => (text += chunk), read: () => text }
  }

  test('stops on an old Node before any command is loaded', async () => {
    const { launch } = await import('../src/launch.js')
    const stderr = sink()
    expect(await launch('16.18.1', ['--version'], stderr)).toBe(1)
    expect(stderr.read()).toContain('this is Node 16.18.1')
  })

  test('runs the command on a Node that is new enough', async () => {
    const { launch } = await import('../src/launch.js')
    const stderr = sink()
    expect(await launch(process.versions.node, ['--version'], stderr)).toBe(0)
    expect(stderr.read()).toBe('')
  })
})
