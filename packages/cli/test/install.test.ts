import { chmodSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { installDependencies, packageManagerOf } from '../src/install.js'
import { cleanTmp, tmp, writeTree } from './helpers/tmp.js'

afterEach(cleanTmp)

describe('packageManagerOf', () => {
  test.each([
    ['npm@8.19.2', 'npm'],
    ['pnpm@10.0.0', 'pnpm'],
    ['yarn@4.5.0+sha512.abc', 'yarn'],
    ['bun@1.2.0', 'bun'],
    ['something-else@1.0.0', 'npm'],
  ])('reads %s as %s', async (declared, manager) => {
    const dir = tmp()
    writeTree(dir, { 'package.json': { packageManager: declared } })
    expect(await packageManagerOf(dir)).toBe(manager)
  })

  test('is npm when package.json declares none', async () => {
    const dir = tmp()
    writeTree(dir, { 'package.json': {} })
    expect(await packageManagerOf(dir)).toBe('npm')
  })

  test('is undefined when there is no package.json', async () => {
    expect(await packageManagerOf(tmp())).toBeUndefined()
  })
})

// A stand-in for the package manager, first on PATH, that records how it was
// called. It needs a POSIX shell.
describe.skipIf(process.platform === 'win32')('installDependencies', () => {
  const fakeManager = (name: string, exitCode: number) => {
    const bin = tmp('drx-bin-')
    writeTree(bin, {
      [name]: `#!/bin/sh\necho "$@" > "$PWD/called-with.txt"\nexit ${exitCode}\n`,
    })
    chmodSync(join(bin, name), 0o755)
    return { ...process.env, PATH: `${bin}:${process.env.PATH}` }
  }

  test('runs the install of the declared manager in the directory', async () => {
    const dir = tmp()
    writeTree(dir, { 'package.json': { packageManager: 'pnpm@10.0.0' } })
    await installDependencies(dir, fakeManager('pnpm', 0))
    expect(readFileSync(join(dir, 'called-with.txt'), 'utf8')).toBe('install\n')
  })

  test('says what the manager printed when the install fails', async () => {
    const dir = tmp()
    writeTree(dir, { 'package.json': {} })
    const bin = tmp('drx-bin-')
    writeTree(bin, { npm: '#!/bin/sh\necho "peer conflict: boom"\nexit 1\n' })
    chmodSync(join(bin, 'npm'), 0o755)
    await expect(
      installDependencies(dir, {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
      })
    ).rejects.toThrow(
      /npm install exited with code 1[\s\S]*peer conflict: boom/
    )
  })

  test('fails when the install exits non-zero', async () => {
    const dir = tmp()
    writeTree(dir, { 'package.json': {} })
    await expect(
      installDependencies(dir, fakeManager('npm', 3))
    ).rejects.toThrow('npm install exited with code 3')
  })

  test('fails when the manager is not installed', async () => {
    const dir = tmp()
    writeTree(dir, { 'package.json': { packageManager: 'bun@1.2.0' } })
    await expect(
      installDependencies(dir, { PATH: tmp('drx-empty-') })
    ).rejects.toThrow('bun install could not start')
  })

  test('fails when there is nothing to install from', async () => {
    const dir = tmp()
    await expect(installDependencies(dir)).rejects.toThrow(
      `${dir} has no package.json to install from`
    )
    expect(existsSync(join(dir, 'called-with.txt'))).toBe(false)
  })
})
