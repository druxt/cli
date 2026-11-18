import { existsSync, readFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { writeBackendUrl } from '../../src/engines/backend-url.js'
import { removeEngineFiles } from '../../src/engines/files.js'
import { cleanTmp, tmp, writeTree } from '../helpers/tmp.js'

afterEach(cleanTmp)

function site(): string {
  const root = tmp('drx-site-')
  writeTree(root, {
    'README.md': '# Site\n',
    'drupal/composer.json': {},
    'drupal/Makefile': 'build:\n',
    'drupal/.devtools/start': '#!/bin/sh\n',
    'drupal/.ddev/config.yaml': 'name: fixture\n',
    'drupal/.ddev/commands/web/drupal-install': '#!/bin/sh\n',
    'drupal/.lando.yml': 'name: fixture\n',
  })
  return root
}

describe('removeEngineFiles', () => {
  test('removes files and directories, and says which', async () => {
    const root = site()
    const removed = await removeEngineFiles(
      root,
      ['drupal/.devtools', 'drupal/Makefile', 'drupal/.lando.yml'],
      []
    )
    expect(removed).toEqual([
      'drupal/.devtools',
      'drupal/Makefile',
      'drupal/.lando.yml',
    ])
    expect(existsSync(join(root, 'drupal/.devtools'))).toBe(false)
    expect(existsSync(join(root, 'drupal/Makefile'))).toBe(false)
    expect(existsSync(join(root, 'drupal/.ddev/config.yaml'))).toBe(true)
    expect(existsSync(join(root, 'drupal/composer.json'))).toBe(true)
  })

  test('skips a path that is not there', async () => {
    expect(await removeEngineFiles(site(), ['drupal/.docker'], [])).toEqual([])
  })

  test('keeps a path the chosen engine lists too', async () => {
    const root = site()
    const removed = await removeEngineFiles(
      root,
      ['drupal/.ddev/commands', 'drupal/.lando.yml'],
      ['drupal/.ddev']
    )
    expect(removed).toEqual(['drupal/.lando.yml'])
    expect(
      existsSync(join(root, 'drupal/.ddev/commands/web/drupal-install'))
    ).toBe(true)
  })

  test('removes around a path the chosen engine needs inside a directory', async () => {
    const root = site()
    const removed = await removeEngineFiles(
      root,
      ['drupal/.ddev'],
      ['drupal/.ddev/commands']
    )
    expect(removed).toEqual(['drupal/.ddev/config.yaml'])
    expect(existsSync(join(root, 'drupal/.ddev/config.yaml'))).toBe(false)
    expect(
      existsSync(join(root, 'drupal/.ddev/commands/web/drupal-install'))
    ).toBe(true)
  })

  test.each([
    '../outside.txt',
    '/etc/hostname',
    'drupal/../../outside.txt',
    '.',
  ])('refuses %s and removes nothing', async (path) => {
    const parent = tmp('drx-parent-')
    writeTree(parent, { 'outside.txt': 'keep', 'site/README.md': '# Site\n' })
    await expect(
      removeEngineFiles(join(parent, 'site'), ['README.md', path], [])
    ).rejects.toThrow(`Refusing to remove ${path}: it is not inside the site.`)
    expect(readFileSync(join(parent, 'outside.txt'), 'utf8')).toBe('keep')
    expect(existsSync(join(parent, 'site', 'README.md'))).toBe(true)
  })

  test.skipIf(process.platform === 'win32')(
    'refuses a path that leaves the site through a link',
    async () => {
      const parent = tmp('drx-parent-')
      writeTree(parent, { 'elsewhere/precious.txt': 'keep', 'site/a.txt': '' })
      symlinkSync(join(parent, 'elsewhere'), join(parent, 'site', 'link'))
      await expect(
        removeEngineFiles(join(parent, 'site'), ['link/precious.txt'], [])
      ).rejects.toThrow(
        'Refusing to remove link/precious.txt: it is not inside the site.'
      )
      expect(existsSync(join(parent, 'elsewhere', 'precious.txt'))).toBe(true)
    }
  )

  test.skipIf(process.platform === 'win32')(
    'removes a link itself, not what it points at',
    async () => {
      const parent = tmp('drx-parent-')
      writeTree(parent, { 'elsewhere/precious.txt': 'keep', 'site/a.txt': '' })
      symlinkSync(join(parent, 'elsewhere'), join(parent, 'site', 'link'))
      expect(
        await removeEngineFiles(join(parent, 'site'), ['link'], [])
      ).toEqual(['link'])
      expect(existsSync(join(parent, 'elsewhere', 'precious.txt'))).toBe(true)
    }
  )
})

describe('writeBackendUrl', () => {
  const target = {
    file: '.env',
    template: '.env.example',
    variable: 'BASE_URL',
  }

  test('starts from the template and sets the variable', async () => {
    const root = tmp()
    writeTree(root, {
      '.env.example':
        '# Backend URL\nBASE_URL=http://old.ddev.site\n\nOAUTH_CLIENT_ID=\n',
    })
    await writeBackendUrl(root, target, 'https://example.com')
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe(
      '# Backend URL\nBASE_URL=https://example.com\n\nOAUTH_CLIENT_ID=\n'
    )
    expect(readFileSync(join(root, '.env.example'), 'utf8')).toContain(
      'old.ddev.site'
    )
  })

  test('changes the variable in a file that exists, and leaves the rest', async () => {
    const root = tmp()
    writeTree(root, {
      '.env': 'OAUTH_CLIENT_ID=abc\nBASE_URL=http://127.0.0.1:8888\n',
      '.env.example': 'BASE_URL=http://old.ddev.site\n',
    })
    await writeBackendUrl(root, target, 'https://example.com')
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe(
      'OAUTH_CLIENT_ID=abc\nBASE_URL=https://example.com\n'
    )
  })

  test('adds the variable when neither file has it', async () => {
    const root = tmp()
    writeTree(root, { '.env.example': 'OAUTH_CLIENT_ID=' })
    await writeBackendUrl(root, target, 'https://example.com')
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe(
      'OAUTH_CLIENT_ID=\nBASE_URL=https://example.com\n'
    )
  })

  test('writes the file with no template to start from', async () => {
    const root = tmp()
    await writeBackendUrl(
      root,
      { file: 'config/.env', variable: 'API' },
      'https://example.com'
    )
    expect(readFileSync(join(root, 'config/.env'), 'utf8')).toBe(
      'API=https://example.com\n'
    )
  })
})
