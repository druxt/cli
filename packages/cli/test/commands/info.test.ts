import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { cliVersion } from '../../src/package-root.js'
import { run } from '../helpers/run.js'
import { cleanTmp, tmp, writeTree } from '../helpers/tmp.js'

afterEach(cleanTmp)

/** A project with an installed frontend part and a backend part. */
function project(): string {
  const root = tmp()
  writeTree(root, {
    'drx.config.json': {
      layout: 'monorepo',
      line: '0.x',
      starter: 'quickstart',
      source: 'npm',
      parts: [
        { role: 'frontend', kind: 'nuxt', path: 'nuxt' },
        { role: 'backend', kind: 'drupal', path: 'drupal' },
      ],
    },
    'nuxt/package.json': {
      dependencies: { nuxt: '2.15.8', 'druxt-site': '^0.14.3' },
    },
    'nuxt/node_modules/nuxt/package.json': { version: '2.15.8' },
    'drupal/composer.json': { require: { 'drupal/core-recommended': '~11' } },
  })
  return root
}

describe('drx info outside a project', () => {
  test('says so and still prints the versions', async () => {
    const cwd = tmp()
    const result = await run(['info'], { cwd })
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe(
      [
        `drx   ${cliVersion()}`,
        'Node  24.18.0',
        '',
        `Not inside a Druxt project: no drx.config.json in ${cwd} or above it.`,
        '',
      ].join('\n')
    )
  })

  test('--json has a null project', async () => {
    const result = await run(['info', '--json'])
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      cli: { name: '@druxt/cli', version: cliVersion() },
      node: '24.18.0',
      project: null,
    })
  })
})

describe('drx info inside a project', () => {
  test('prints the layout, the parts and their packages', async () => {
    const root = project()
    const result = await run(['info'], { cwd: root })
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe(
      [
        `drx   ${cliVersion()}`,
        'Node  24.18.0',
        '',
        `Project  ${root}`,
        'Layout   monorepo',
        'Line     0.x',
        'Starter  quickstart',
        'Source   npm',
        '',
        'frontend  nuxt  nuxt/',
        '  nuxt        2.15.8   installed 2.15.8',
        '  druxt-site  ^0.14.3  not installed',
        '',
        'backend  drupal  drupal/',
        '  drupal/core-recommended  ~11  not installed',
        '',
      ].join('\n')
    )
  })

  test('finds the project from a directory inside a part', async () => {
    const root = project()
    const cwd = join(root, 'nuxt', 'pages')
    mkdirSync(cwd)
    const result = await run(['info', '--json'], { cwd })
    expect(JSON.parse(result.stdout).project.root).toBe(root)
  })

  test('--json reports the same as data', async () => {
    const root = project()
    const result = await run(['info', '--json'], { cwd: root })
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual({
      cli: { name: '@druxt/cli', version: cliVersion() },
      node: '24.18.0',
      project: {
        root,
        layout: 'monorepo',
        line: '0.x',
        starter: 'quickstart',
        source: 'npm',
        parts: [
          {
            role: 'frontend',
            kind: 'nuxt',
            path: 'nuxt',
            exists: true,
            detected: true,
            packages: [
              { name: 'nuxt', range: '2.15.8', installed: '2.15.8' },
              { name: 'druxt-site', range: '^0.14.3', installed: null },
            ],
          },
          {
            role: 'backend',
            kind: 'drupal',
            path: 'drupal',
            exists: true,
            detected: true,
            packages: [
              {
                name: 'drupal/core-recommended',
                range: '~11',
                installed: null,
              },
            ],
          },
        ],
      },
    })
  })

  test('says when a part is missing, unrecognised or of an unknown kind', async () => {
    const root = tmp()
    writeTree(root, {
      'drx.config.json': {
        layout: 'monorepo',
        line: '3.x',
        starter: 'future',
        source: 'npm',
        parts: [
          { role: 'frontend', kind: 'nuxt', path: 'web' },
          { role: 'frontend', kind: 'nuxt', path: 'empty' },
          { role: 'backend', kind: 'wordpress', path: 'cms' },
        ],
      },
      'empty/README.md': 'Nothing here yet.',
      'cms/index.php': '<?php',
    })
    const result = await run(['info'], { cwd: root })
    expect(result.code).toBe(0)
    expect(result.stdout).toContain(
      [
        'frontend  nuxt  web/',
        '  The directory does not exist.',
        '',
        'frontend  nuxt  empty/',
        '  The directory does not look like a nuxt part.',
        '',
        'backend  wordpress  cms/',
        '  This version has no adapter for the wordpress kind.',
        '',
      ].join('\n')
    )
  })

  test('fails on a config file that is invalid', async () => {
    const root = tmp()
    writeTree(root, { 'drx.config.json': { layout: 'pile' } })
    const result = await run(['info'], { cwd: root })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      'drx.config.json is invalid: layout must be one of monorepo, split, workspace.'
    )
  })
})
