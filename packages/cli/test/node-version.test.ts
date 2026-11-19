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
    expect(nodeTooOld('22.11.0')).toBeDefined()
    expect(nodeTooOld('20.19.0')).toBeDefined()
  })
})
