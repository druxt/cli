import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  loadUserConfig,
  resolveModuleRegistryUrl,
  resolveRegistryUrl,
  userConfigPath,
} from '../src/user-config.js'

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'drx-home-'))
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

const write = (file: string, content: unknown) => {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(
    file,
    typeof content === 'string' ? content : JSON.stringify(content)
  )
}

describe('userConfigPath', () => {
  test('is DRX_CONFIG when that is set', () => {
    expect(userConfigPath({ DRX_CONFIG: '/etc/drx.json' })).toBe(
      '/etc/drx.json'
    )
  })

  test('is drx/config.json under XDG_CONFIG_HOME', () => {
    expect(userConfigPath({ XDG_CONFIG_HOME: home })).toBe(
      join(home, 'drx', 'config.json')
    )
  })

  test('is ~/.config/drx/config.json otherwise', () => {
    expect(userConfigPath({ HOME: home })).toBe(
      join(home, '.config', 'drx', 'config.json')
    )
  })
})

describe('loadUserConfig', () => {
  test('is empty when the default file does not exist', async () => {
    expect(await loadUserConfig({ XDG_CONFIG_HOME: home })).toEqual({
      path: join(home, 'drx', 'config.json'),
      registries: {},
      moduleRegistries: {},
      sources: {},
    })
  })

  test('reads named registries and sources', async () => {
    const path = join(home, 'config.json')
    write(path, {
      registries: { team: 'https://example.com/starters' },
      moduleRegistries: { team: 'https://example.com/modules.json' },
      sources: {
        next: { type: 'npm', tag: 'next' },
        branch: { type: 'git', url: 'https://example.com/druxt.git', ref: 'x' },
      },
    })
    expect(await loadUserConfig({ DRX_CONFIG: path })).toEqual({
      path,
      registries: { team: 'https://example.com/starters' },
      moduleRegistries: { team: 'https://example.com/modules.json' },
      sources: {
        next: { type: 'npm', tag: 'next' },
        branch: { type: 'git', url: 'https://example.com/druxt.git', ref: 'x' },
      },
    })
  })

  test('fails when DRX_CONFIG names a file that does not exist', async () => {
    const path = join(home, 'missing.json')
    await expect(loadUserConfig({ DRX_CONFIG: path })).rejects.toThrow(
      `DRX_CONFIG names ${path}, which does not exist.`
    )
  })

  test.each([
    ['{', 'it is not valid JSON'],
    ['[]', 'it must hold an object'],
    ['{"registries":[]}', 'registries must be an object of URLs'],
    [
      '{"registries":{"a":"not a url"}}',
      'registries.a must be an http or https URL',
    ],
    ['{"moduleRegistries":7}', 'moduleRegistries must be an object of URLs'],
    [
      '{"moduleRegistries":{"a":"ftp://x"}}',
      'moduleRegistries.a must be an http or https URL',
    ],
    ['{"banner":"no"}', 'banner must be true or false'],
    ['{"sources":[]}', 'sources must be an object'],
    ['{"sources":{"a":"npm"}}', 'sources.a must be an object'],
    [
      '{"sources":{"a":{"type":"svn"}}}',
      'sources.a.type must be one of npm, git',
    ],
    [
      '{"sources":{"a":{"type":"git"}}}',
      'sources.a.url must be a non-empty string',
    ],
    [
      '{"sources":{"a":{"type":"npm","tag":1}}}',
      'sources.a.tag must be a string',
    ],
    [
      '{"sources":{"npm":{"type":"npm"}}}',
      'sources.npm cannot redefine the built-in source',
    ],
  ])('names what is wrong with %s', async (content, message) => {
    const path = join(home, 'config.json')
    write(path, content)
    await expect(loadUserConfig({ DRX_CONFIG: path })).rejects.toThrow(
      `${path} is invalid: ${message}.`
    )
  })
})

describe('the banner setting', () => {
  test('is read when it is set, and absent otherwise', async () => {
    const path = join(home, 'config.json')
    write(path, { banner: false })
    expect((await loadUserConfig({ DRX_CONFIG: path })).banner).toBe(false)
    expect(
      (await loadUserConfig({ XDG_CONFIG_HOME: home })).banner
    ).toBeUndefined()
  })
})

describe('resolveRegistryUrl', () => {
  const config = {
    path: '/home/me/.config/drx/config.json',
    registries: { team: 'https://example.com/starters' },
    moduleRegistries: { ours: 'https://example.com/modules.json' },
    sources: {},
  }

  test('takes a URL as it is', () => {
    expect(resolveRegistryUrl('http://127.0.0.1:9/r', config)).toBe(
      'http://127.0.0.1:9/r'
    )
  })

  test('looks a name up in the user configuration', () => {
    expect(resolveRegistryUrl('team', config)).toBe(
      'https://example.com/starters'
    )
  })

  test('fails on a name every object has, when the configuration does not define it', () => {
    for (const name of ['constructor', 'toString', '__proto__']) {
      expect(() => resolveRegistryUrl(name, config)).toThrow(
        `"${name}" is neither.`
      )
    }
  })

  test('takes such a name when the configuration defines it', () => {
    const registries = { constructor: 'https://example.com/built' }
    expect(resolveRegistryUrl('constructor', { ...config, registries })).toBe(
      'https://example.com/built'
    )
  })

  test('fails on a name the configuration does not define', () => {
    expect(() => resolveRegistryUrl('other', config)).toThrow(
      '--registry takes a URL or a name defined in /home/me/.config/drx/config.json. "other" is neither. Defined names: team.'
    )
  })
})

describe('resolveModuleRegistryUrl', () => {
  const config = {
    path: '/home/me/.config/drx/config.json',
    registries: {},
    moduleRegistries: { ours: 'https://example.com/modules.json' },
    sources: {},
  }

  test('takes a URL, or a name from the user configuration', () => {
    expect(resolveModuleRegistryUrl('https://example.org/m.json', config)).toBe(
      'https://example.org/m.json'
    )
    expect(resolveModuleRegistryUrl('ours', config)).toBe(
      'https://example.com/modules.json'
    )
  })

  test('fails on a name the configuration does not define', () => {
    expect(() => resolveModuleRegistryUrl('theirs', config)).toThrow(
      '--module-registry takes a URL or a name defined in /home/me/.config/drx/config.json. "theirs" is neither. Defined names: ours.'
    )
  })
})
