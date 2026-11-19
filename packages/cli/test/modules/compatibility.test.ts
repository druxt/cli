import { describe, expect, test } from 'vitest'
import { compatibility } from '../../src/modules/compatibility.js'

const druxt = (range: string | null, installed: string | null) => ({
  name: 'druxt',
  range,
  installed,
})

describe('compatibility', () => {
  test('compares the installed version with the range', () => {
    expect(compatibility('^0.25.1', druxt('^0.25.0', '0.25.2'))).toBe(
      'compatible'
    )
    expect(compatibility('^0.25.1', druxt('^0.25.0', '0.25.0'))).toBe(
      'incompatible'
    )
    expect(compatibility('>=0.21.0 <1', druxt(null, '0.25.2'))).toBe(
      'compatible'
    )
    expect(compatibility('>=0.26.0 <1', druxt(null, '0.25.2'))).toBe(
      'incompatible'
    )
  })

  test('counts a prerelease of a version inside the range', () => {
    expect(compatibility('>=0.25.0 <1', druxt(null, '0.26.0-next.1'))).toBe(
      'compatible'
    )
  })

  test('compares the range asked for when nothing is installed', () => {
    expect(compatibility('^0.25.1', druxt('^0.25.0', null))).toBe('compatible')
    expect(compatibility('^0.25.1', druxt('^0.24.0', null))).toBe(
      'incompatible'
    )
  })

  test.each([undefined, 'unknown', 'whenever', ''])(
    'is unknown, never compatible, when the module states %j',
    (range) => {
      expect(compatibility(range, druxt('^0.25.0', '0.25.2'))).toBe('unknown')
    }
  )

  test('is unknown when the part has no Druxt version to compare', () => {
    expect(compatibility('^0.25.1', undefined)).toBe('unknown')
    expect(compatibility('^0.25.1', druxt(null, null))).toBe('unknown')
    expect(compatibility('^0.25.1', druxt('github:druxt/druxt.js', null))).toBe(
      'unknown'
    )
    expect(compatibility('^0.25.1', druxt(null, 'not-a-version'))).toBe(
      'unknown'
    )
  })
})
