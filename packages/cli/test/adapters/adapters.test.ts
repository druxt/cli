import { afterEach, describe, expect, test } from 'vitest'
import {
  adapterFor,
  kindsWithRole,
  knownKinds,
} from '../../src/adapters/index.js'
import { cleanTmp, tmp, writeTree } from '../helpers/tmp.js'

afterEach(cleanTmp)

describe('adapterFor', () => {
  test('has an adapter for each kind this version knows', () => {
    expect(knownKinds()).toEqual(['nuxt', 'drupal'])
    expect(adapterFor('nuxt')).toMatchObject({ kind: 'nuxt', role: 'frontend' })
    expect(adapterFor('drupal')).toMatchObject({
      kind: 'drupal',
      role: 'backend',
    })
  })

  test('has none for a kind it does not know', () => {
    expect(adapterFor('astro')).toBeUndefined()
  })
})

describe('the nuxt adapter', () => {
  const nuxt = adapterFor('nuxt')!

  test('detects a directory whose package.json depends on nuxt', async () => {
    const dir = tmp()
    writeTree(dir, { 'package.json': { dependencies: { nuxt: '2.15.8' } } })
    expect(await nuxt.detect(dir)).toBe(true)
  })

  test('detects a directory with a nuxt.config file', async () => {
    const dir = tmp()
    writeTree(dir, {
      'package.json': {},
      'nuxt.config.ts': 'export default {}',
    })
    expect(await nuxt.detect(dir)).toBe(true)
  })

  test('does not detect another package, or an empty directory', async () => {
    const dir = tmp()
    expect(await nuxt.detect(dir)).toBe(false)
    writeTree(dir, { 'package.json': { dependencies: { astro: '5.0.0' } } })
    expect(await nuxt.detect(dir)).toBe(false)
  })

  test('reports nuxt and every druxt package, with what is installed', async () => {
    const dir = tmp()
    writeTree(dir, {
      'package.json': {
        dependencies: {
          nuxt: '2.15.8',
          'druxt-site': '^0.14.3',
          '@druxt/core': '^2.0.0',
          vue: '^2.7.0',
        },
        devDependencies: { druxt: '^0.25.0' },
      },
      'node_modules/nuxt/package.json': { version: '2.15.8' },
      'node_modules/druxt-site/package.json': { version: '0.14.5' },
      'node_modules/@druxt/core/package.json': { version: '2.0.1' },
    })
    expect(await nuxt.packages(dir)).toEqual([
      { name: 'nuxt', range: '2.15.8', installed: '2.15.8' },
      { name: '@druxt/core', range: '^2.0.0', installed: '2.0.1' },
      { name: 'druxt', range: '^0.25.0', installed: null },
      { name: 'druxt-site', range: '^0.14.3', installed: '0.14.5' },
    ])
  })

  test('reports nothing for a directory with no package.json', async () => {
    expect(await nuxt.packages(tmp())).toEqual([])
  })

  test('cannot add a module yet', async () => {
    await expect(nuxt.addModule(tmp(), 'druxt-site')).rejects.toThrow(
      'Adding a module is not available yet.'
    )
  })
})

describe('the drupal adapter', () => {
  const drupal = adapterFor('drupal')!

  test('detects a directory whose composer.json requires Drupal core', async () => {
    const dir = tmp()
    writeTree(dir, {
      'composer.json': { require: { 'drupal/core-recommended': '~11' } },
    })
    expect(await drupal.detect(dir)).toBe(true)
  })

  test('does not detect another Composer project, or an empty directory', async () => {
    const dir = tmp()
    expect(await drupal.detect(dir)).toBe(false)
    writeTree(dir, {
      'composer.json': { require: { 'example/framework': '^7' } },
    })
    expect(await drupal.detect(dir)).toBe(false)
  })

  test('reports a locked package as not installed until Composer has installed it', async () => {
    const dir = tmp()
    writeTree(dir, {
      'composer.json': { require: { 'drupal/core-recommended': '~11' } },
      'composer.lock': {
        packages: [{ name: 'drupal/core-recommended', version: '11.2.4' }],
      },
    })
    expect(await drupal.packages(dir)).toEqual([
      { name: 'drupal/core-recommended', range: '~11', installed: null },
    ])
  })

  test('reports core and the Druxt module, with what Composer installed', async () => {
    const dir = tmp()
    writeTree(dir, {
      'composer.json': {
        require: {
          'drupal/core-recommended': '~11',
          'drupal/druxt': '^1.2',
          'drupal/simple_oauth': '^6',
        },
      },
      'vendor/composer/installed.json': {
        packages: [
          { name: 'drupal/core-recommended', version: '11.2.4' },
          { name: 'drupal/core', version: '11.2.4' },
        ],
      },
    })
    expect(await drupal.packages(dir)).toEqual([
      { name: 'drupal/core-recommended', range: '~11', installed: '11.2.4' },
      { name: 'drupal/druxt', range: '^1.2', installed: null },
    ])
  })

  test('cannot add a module yet', async () => {
    await expect(drupal.addModule(tmp(), 'druxt')).rejects.toThrow(
      'Adding a module is not available yet.'
    )
  })
})

describe('kindsWithRole', () => {
  test('lists the kinds of one role', () => {
    expect(kindsWithRole('frontend')).toEqual(['nuxt'])
    expect(kindsWithRole('backend')).toEqual(['drupal'])
  })
})

describe('the Druxt version of a part', () => {
  const nuxt = adapterFor('nuxt')!

  test('is the range asked for and the version installed', async () => {
    const dir = tmp()
    writeTree(dir, {
      'package.json': { dependencies: { druxt: '^0.25.0' } },
      'node_modules/druxt/package.json': { version: '0.25.2' },
    })
    expect(await nuxt.druxt(dir)).toEqual({
      name: 'druxt',
      range: '^0.25.0',
      installed: '0.25.2',
    })
  })

  test('is found when another package brought it in', async () => {
    const dir = tmp()
    writeTree(dir, {
      'package.json': { dependencies: { 'druxt-site': '^0.14.3' } },
      'node_modules/druxt/package.json': { version: '0.25.2' },
    })
    expect(await nuxt.druxt(dir)).toEqual({
      name: 'druxt',
      range: null,
      installed: '0.25.2',
    })
  })

  test('is the scoped core package on a site that has that one', async () => {
    const dir = tmp()
    writeTree(dir, {
      'package.json': { dependencies: { '@druxt/core': '^2.0.0' } },
    })
    expect(await nuxt.druxt(dir)).toEqual({
      name: '@druxt/core',
      range: '^2.0.0',
      installed: null,
    })
  })

  test('is undefined when the part has no Druxt', async () => {
    const dir = tmp()
    writeTree(dir, { 'package.json': { dependencies: { nuxt: '2.15.8' } } })
    expect(await nuxt.druxt(dir)).toBeUndefined()
  })

  test('is undefined for a kind that holds no Druxt package', async () => {
    expect(await adapterFor('drupal')!.druxt(tmp())).toBeUndefined()
  })
})

describe('one package of a part', () => {
  const nuxt = adapterFor('nuxt')!

  test('is its range and installed version', async () => {
    const dir = tmp()
    writeTree(dir, {
      'package.json': { dependencies: { 'druxt-blocks': '^0.25.1' } },
      'node_modules/druxt-blocks/package.json': { version: '0.25.3' },
      'node_modules/druxt-router/package.json': { version: '0.25.1' },
    })
    expect(await nuxt.package(dir, 'druxt-blocks')).toEqual({
      name: 'druxt-blocks',
      range: '^0.25.1',
      installed: '0.25.3',
    })
    expect(await nuxt.package(dir, 'druxt-router')).toEqual({
      name: 'druxt-router',
      range: null,
      installed: '0.25.1',
    })
  })

  test('is undefined when the part neither asks for it nor has it', async () => {
    const dir = tmp()
    writeTree(dir, { 'package.json': {} })
    expect(await nuxt.package(dir, 'druxt-blocks')).toBeUndefined()
  })

  test('is undefined for a kind with no such packages', async () => {
    expect(
      await adapterFor('drupal')!.package(tmp(), 'druxt-blocks')
    ).toBeUndefined()
  })
})
