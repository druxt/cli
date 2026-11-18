import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import { adapterFor } from '../../src/adapters/index.js'
import type { ModuleChange } from '../../src/adapters/adapter.js'
import { cleanTmp, tmp, writeTree } from '../helpers/tmp.js'

afterEach(cleanTmp)

const nuxt = adapterFor('nuxt')!
/** The quickstart starter's own config, byte for byte. */
const QUICKSTART = readFileSync(
  fileURLToPath(
    new URL('../fixtures/quickstart-nuxt.config.js', import.meta.url)
  ),
  'utf8'
)
const NUXT_4 = `// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxt/eslint'],
})
`

/** The part each change was planned for, to make an edit's content from. */
const parts = new WeakMap<ModuleChange, string>()
const planned = async (dir: string, change: Promise<ModuleChange>) => {
  parts.set(await change, dir)
  return change
}

const add = (dir: string, name = 'druxt-breadcrumb', root?: string) =>
  planned(
    dir,
    nuxt.addModule(dir, {
      package: name,
      needs: [],
      patches: true,
      registryStatesCore: false,
      ...(root ? { root } : {}),
    })
  )
const DID = { installed: true, listed: true }
const remove = (
  dir: string,
  name = 'druxt-breadcrumb',
  did = DID,
  root?: string
) =>
  planned(
    dir,
    nuxt.removeModule(dir, { package: name, did, ...(root ? { root } : {}) })
  )

const runs = (change: ModuleChange) =>
  change.steps.flatMap((step) => ('run' in step ? [step.run] : []))
/** The edits of a change, each with the content it makes of the file now. */
const edits = (change: ModuleChange) =>
  change.steps.flatMap((step) => {
    if (!('edit' in step)) return []
    const file = join(parts.get(change) as string, step.edit.file)
    const content = step.edit.change(readFileSync(file, 'utf8'))
    return [{ ...step.edit, content }]
  })

function part(files: Record<string, unknown>): string {
  const dir = tmp('drx-part-')
  writeTree(dir, { 'package.json': {}, ...files })
  return dir
}

describe('the package manager of a frontend part', () => {
  test.each([
    [
      'package-lock.json',
      'npm',
      ['install', '--', 'druxt-breadcrumb'],
      ['uninstall', '--', 'druxt-breadcrumb'],
    ],
    [
      'pnpm-lock.yaml',
      'pnpm',
      ['add', '--', 'druxt-breadcrumb'],
      ['remove', '--', 'druxt-breadcrumb'],
    ],
    [
      'yarn.lock',
      'yarn',
      ['add', '--', 'druxt-breadcrumb'],
      ['remove', '--', 'druxt-breadcrumb'],
    ],
    // Not known to take the separator, so it is left out.
    [
      'bun.lock',
      'bun',
      ['add', 'druxt-breadcrumb'],
      ['remove', 'druxt-breadcrumb'],
    ],
    [
      'README.md',
      'npm',
      ['install', '--', 'druxt-breadcrumb'],
      ['uninstall', '--', 'druxt-breadcrumb'],
    ],
  ])('with %s is %s', async (lock, tool, installArgs, removeArgs) => {
    const dir = part({
      [lock]: '',
      'package.json': { dependencies: { 'druxt-breadcrumb': '^0.1.0' } },
      'nuxt.config.js': 'export default { modules: [] }\n',
    })
    expect(runs(await add(part({ [lock]: '' })))).toEqual([
      { tool, args: installArgs },
    ])
    expect(runs(await remove(dir))).toEqual([{ tool, args: removeArgs }])
  })

  /** A project whose frontend part is one directory down from its root. */
  function workspace(
    rootFiles: Record<string, unknown>,
    partFiles: Record<string, unknown> = {}
  ) {
    const root = tmp('drx-root-')
    writeTree(root, {
      ...rootFiles,
      'web/package.json': {},
      ...Object.fromEntries(
        Object.entries(partFiles).map(([file, content]) => [
          `web/${file}`,
          content,
        ])
      ),
    })
    return { root, dir: join(root, 'web') }
  }
  const tool = async (
    rootFiles: Record<string, unknown>,
    partFiles: Record<string, unknown> = {}
  ) => {
    const { root, dir } = workspace(rootFiles, partFiles)
    const added = runs(await add(dir, 'druxt-breadcrumb', root))[0]?.tool
    writeTree(dir, {
      'package.json': {
        ...(partFiles['package.json'] as object),
        dependencies: { 'druxt-breadcrumb': '^0.1.0' },
      },
    })
    const removed = runs(await remove(dir, 'druxt-breadcrumb', DID, root))[0]
    expect(removed?.tool).toBe(added)
    return added
  }

  test('is the one the root of the project declares, with no lock file yet', async () => {
    expect(
      await tool({ 'package.json': { packageManager: 'pnpm@10.4.1' } })
    ).toBe('pnpm')
  })

  test('is the one of a lock file at the root of a workspace', async () => {
    expect(await tool({ 'package.json': {}, 'yarn.lock': '' })).toBe('yarn')
    expect(await tool({ 'pnpm-lock.yaml': '' })).toBe('pnpm')
  })

  test('is the declared one before that of any lock file', async () => {
    expect(
      await tool(
        { 'package.json': { packageManager: 'yarn@4.5.0' } },
        { 'package-lock.json': '{}' }
      )
    ).toBe('yarn')
    expect(
      await tool(
        { 'yarn.lock': '' },
        { 'package.json': { packageManager: 'pnpm@9.0.0' } }
      )
    ).toBe('pnpm')
  })

  test('is the one the root declares before the one the part declares', async () => {
    expect(
      await tool(
        { 'package.json': { packageManager: 'npm@11.0.0' } },
        { 'package.json': { packageManager: 'pnpm@9.0.0' } }
      )
    ).toBe('npm')
  })

  test('is npm for a manager it does not know, and with nothing to go by', async () => {
    expect(
      await tool({ 'package.json': { packageManager: 'vlt@1.0.0' } })
    ).toBe('npm')
    expect(await tool({})).toBe('npm')
  })

  test('does not look above the root of the project', async () => {
    const outer = tmp('drx-outer-')
    writeTree(outer, {
      'package.json': { packageManager: 'pnpm@10.4.1' },
      'pnpm-lock.yaml': '',
      'site/web/package.json': {},
    })
    const root = join(outer, 'site')
    const change = await add(join(root, 'web'), 'druxt-breadcrumb', root)
    expect(runs(change)[0]?.tool).toBe('npm')
  })
})

describe('adding a module to the Nuxt 2 config of the quickstart', () => {
  test('appends it to modules and changes nothing else', async () => {
    const dir = part({ 'nuxt.config.js': QUICKSTART })
    const [edit] = edits(await add(dir))
    expect(edit?.file).toBe('nuxt.config.js')
    expect(edit?.summary).toBe(
      "Add 'druxt-breadcrumb' to modules in nuxt.config.js"
    )
    expect(edit?.content).toBe(
      QUICKSTART.replace(
        '    localhostListenURL\n  ],',
        "    localhostListenURL,\n    'druxt-breadcrumb'\n  ],"
      )
    )
    expect(edit?.content).not.toBe(QUICKSTART)
  })

  test('installs before it edits', async () => {
    const dir = part({ 'nuxt.config.js': QUICKSTART })
    const change = await add(dir)
    expect(change.steps.map((step) => Object.keys(step)[0])).toEqual([
      'run',
      'edit',
    ])
    expect(change.manual).toEqual([])
  })

  test('leaves a module that is already listed, alone or with options', async () => {
    const dir = part({ 'nuxt.config.js': QUICKSTART })
    for (const name of ['druxt-site', 'druxt-auth']) {
      const change = await add(dir, name)
      expect(edits(change)).toEqual([])
      expect(change.notes).toContain(
        `${name} is already in modules in nuxt.config.js.`
      )
    }
  })

  test('takes a module out again, and gives the file back as it was', async () => {
    const dir = part({ 'nuxt.config.js': QUICKSTART })
    const [added] = edits(await add(dir))
    writeTree(dir, {
      'nuxt.config.js': added?.content,
      'package.json': { dependencies: { 'druxt-breadcrumb': '^0.1.0' } },
    })
    const change = await remove(dir)
    expect(edits(change)[0]?.content).toBe(QUICKSTART)
    expect(edits(change)[0]?.summary).toBe(
      "Remove 'druxt-breadcrumb' from modules in nuxt.config.js"
    )
  })

  test('takes out a module listed with its options', async () => {
    const dir = part({
      'nuxt.config.js': QUICKSTART,
      'package.json': { dependencies: { 'druxt-auth': '^0.4.0' } },
    })
    const content = edits(await remove(dir, 'druxt-auth'))[0]?.content
    // Its line goes, and every other line stays as it was written.
    expect(content).toBe(
      QUICKSTART.replace(
        "    ['druxt-auth', { clientId: process.env.OAUTH_CLIENT_ID }],\n",
        ''
      )
    )
  })

  test.each([
    ["modules: ['a', 'druxt-breadcrumb', 'b']", "modules: ['a', 'b']"],
    ["modules: ['druxt-breadcrumb', 'b']", "modules: ['b']"],
    ["modules: ['a', 'druxt-breadcrumb']", "modules: ['a']"],
    ["modules: ['druxt-breadcrumb']", 'modules: []'],
    [
      "modules: [\n    'a', // first\n    ['druxt-breadcrumb', { x: 1 }],\n    'b',\n  ]",
      "modules: [\n    'a', // first\n    'b',\n  ]",
    ],
  ])('takes %j out and leaves the rest as written', async (before, after) => {
    const wrap = (list: string) => `export default {\n  ${list},\n}\n`
    const dir = part({
      'nuxt.config.js': wrap(before),
      'package.json': { dependencies: { 'druxt-breadcrumb': '^0.1.0' } },
    })
    expect(edits(await remove(dir))[0]?.content).toBe(wrap(after))
  })
})

describe('adding a module to a Nuxt 4 config', () => {
  test('appends it inside defineNuxtConfig', async () => {
    const dir = part({ 'nuxt.config.ts': NUXT_4 })
    const [edit] = edits(await add(dir, '@druxt/site'))
    expect(edit?.file).toBe('nuxt.config.ts')
    expect(edit?.content).toBe(
      NUXT_4.replace("['@nuxt/eslint']", "['@nuxt/eslint', '@druxt/site']")
    )
  })

  test('adds the modules key when the config has none', async () => {
    const dir = part({
      'nuxt.config.ts': 'export default defineNuxtConfig({\n  ssr: true,\n})\n',
    })
    const content = edits(await add(dir, '@druxt/site'))[0]?.content
    // A key the file did not have is written in the printer's own style.
    expect(content).toMatch(/modules: \[["']@druxt\/site["']\]/)
    expect(content).toContain('ssr: true')
  })
})

describe('a config that cannot be edited safely', () => {
  test.each([
    ['a function', 'export default () => ({ modules: [] })\n'],
    [
      'modules held in a variable',
      "const list = ['a']\nexport default { modules: list }\n",
    ],
    ['modules built by a call', 'export default { modules: build() }\n'],
    ['a file that does not parse', 'export default {{{\n'],
  ])(
    'is left alone when it is %s, with the line to add',
    async (_name, config) => {
      const dir = part({ 'nuxt.config.js': config })
      const change = await add(dir)
      expect(edits(change)).toEqual([])
      expect(runs(change)).toHaveLength(1)
      expect(change.manual).toEqual([
        "Add 'druxt-breadcrumb' to the modules array in nuxt.config.js. It could not be edited safely.",
      ])
    }
  )

  test('is said to be missing when there is no config file', async () => {
    const change = await add(part({}))
    expect(change.manual).toEqual([
      "Add 'druxt-breadcrumb' to the modules array of the config. No config file was found.",
    ])
  })
})

describe('a package the part already has', () => {
  test('is not installed again', async () => {
    const dir = part({
      'package.json': { dependencies: { 'druxt-breadcrumb': '^0.1.0' } },
      'nuxt.config.js': QUICKSTART,
    })
    const change = await add(dir)
    expect(runs(change)).toEqual([])
    expect(change.notes).toContain(
      'druxt-breadcrumb is already a dependency in package.json.'
    )
    expect(edits(change)).toHaveLength(1)
  })

  test('is not uninstalled when the part does not have it', async () => {
    const dir = part({ 'nuxt.config.js': QUICKSTART })
    const change = await remove(dir)
    expect(change.steps).toEqual([])
  })

  test('is recorded as found, and one that is added as done', async () => {
    const had = part({
      'package.json': { dependencies: { 'druxt-auth': '^0.5.1' } },
      'nuxt.config.js': QUICKSTART,
    })
    expect((await add(had, 'druxt-auth')).did).toEqual({
      installed: false,
      listed: false,
    })
    expect((await add(had)).did).toEqual({ installed: true, listed: true })
  })

  test('stays on a remove when the record says the add found it', async () => {
    const dir = part({
      'package.json': { dependencies: { 'druxt-auth': '^0.5.1' } },
      'nuxt.config.js': QUICKSTART,
    })
    const change = await remove(dir, 'druxt-auth', {
      installed: false,
      listed: false,
    })
    expect(change.steps).toEqual([])
    expect(change.notes).toEqual([
      'druxt-auth was in package.json before drx add, so it stays.',
      'druxt-auth was in modules in nuxt.config.js before drx add, so it stays.',
    ])
  })

  test('stays, with the lines to take it out, when the record does not say', async () => {
    const dir = part({
      'package.json': { dependencies: { 'druxt-auth': '^0.5.1' } },
      'nuxt.config.js': QUICKSTART,
    })
    const change = await nuxt.removeModule(dir, { package: 'druxt-auth' })
    expect(change.steps).toEqual([])
    expect(change.manual).toEqual([
      "The record does not say whether drx add installed druxt-auth, so it was left. To take it out: npm uninstall druxt-auth, and remove 'druxt-auth' from modules in nuxt.config.js.",
    ])
  })
})
