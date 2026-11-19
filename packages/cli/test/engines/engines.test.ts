import { describe, expect, test } from 'vitest'
import { engineFor, knownEngines } from '../../src/engines/index.js'
import { DrxError } from '../../src/errors.js'
import type { Part } from '../../src/parts.js'

const part: Part = { role: 'backend', kind: 'drupal', path: 'drupal' }

describe('engineFor', () => {
  test('knows the engines this version can run tools through', () => {
    expect(knownEngines()).toEqual(['php', 'ddev', 'lando', 'none'])
    expect(engineFor('docker-compose')).toBeUndefined()
  })
})

describe('the php engine', () => {
  const php = engineFor('php')!

  test('runs composer as it is, in the part', () => {
    expect(php.run(part, 'composer', ['require', 'drupal/druxt'])).toEqual({
      command: 'composer',
      args: ['require', 'drupal/druxt'],
      cwd: 'drupal',
    })
  })

  test('runs another tool from the bin directory Composer installs into', () => {
    expect(php.run(part, 'drush', ['en', 'druxt', '-y'])).toEqual({
      command: 'vendor/bin/drush',
      args: ['en', 'druxt', '-y'],
      cwd: 'drupal',
    })
  })
})

describe.each(['ddev', 'lando'])('the %s engine', (name) => {
  test('runs a tool through its own command, in the part', () => {
    const engine = engineFor(name)!
    expect(engine.name).toBe(name)
    expect(engine.run(part, 'composer', ['require', 'drupal/druxt'])).toEqual({
      command: name,
      args: ['composer', 'require', 'drupal/druxt'],
      cwd: 'drupal',
    })
    expect(engine.run(part, 'drush', ['en', 'druxt'])).toEqual({
      command: name,
      args: ['drush', 'en', 'druxt'],
      cwd: 'drupal',
    })
  })
})

describe('the none engine', () => {
  test('cannot run a tool, and says the backend is elsewhere', () => {
    const attempt = () => engineFor('none')!.run(part, 'drush', ['en', 'druxt'])
    expect(attempt).toThrow(DrxError)
    expect(attempt).toThrow(
      'The backend of this project is not on this machine, so drush cannot be run from here. Run "drush en druxt" where the backend is.'
    )
  })
})
