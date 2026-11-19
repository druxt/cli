import { describe, expect, test } from 'vitest'
import { trimEndSlashes } from '../src/slashes.js'

describe('trimEndSlashes', () => {
  test('removes every slash at the end and none elsewhere', () => {
    expect(trimEndSlashes('https://example.com/a//')).toBe(
      'https://example.com/a'
    )
    expect(trimEndSlashes('a/b')).toBe('a/b')
    expect(trimEndSlashes('///')).toBe('')
    expect(trimEndSlashes('')).toBe('')
  })

  test('takes time in proportion to a long run of slashes that does not end the text', () => {
    const text = `${'/'.repeat(200_000)}x`
    const started = performance.now()
    expect(trimEndSlashes(text)).toBe(text)
    expect(performance.now() - started).toBeLessThan(200)
  })
})
