import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { findCommandFile } from '../src/commands-on-path.js'
import { runTool, runToolOn, spawnOf } from '../src/exec.js'
import { cleanTmp, tmp, writeTree } from './helpers/tmp.js'

afterEach(cleanTmp)

describe.skipIf(process.platform === 'win32')('runTool', () => {
  test('returns the exit code and everything the tool printed', async () => {
    const cwd = tmp()
    const result = await runTool(
      'sh',
      ['-c', 'echo out; echo err >&2; pwd; exit 3'],
      { cwd }
    )
    expect(result.code).toBe(3)
    expect(result.output).toContain('out\n')
    expect(result.output).toContain('err\n')
    expect(result.output).toContain(cwd)
  })

  test('reports a tool that is not installed as a failure, with the reason', async () => {
    const result = await runTool('no-such-tool-here', ['x'], { cwd: tmp() })
    expect(result.code).not.toBe(0)
    expect(result.output).toContain('no-such-tool-here')
  })

  test('hands an argument over as it is, whatever characters it holds', async () => {
    const cwd = tmp()
    const hostile =
      '$(touch made); `touch made`; touch made & echo "%PATH%" > made'
    const result = await runTool('printf', ['%s', hostile], { cwd })
    expect(result).toEqual({ code: 0, output: hostile })
    expect(await runTool('ls', [], { cwd })).toEqual({ code: 0, output: '' })
  })
})

// The Windows rules, with the platform passed in. They are checked here for
// the command line they build, and have not been run on Windows.
describe('the command line of a tool on Windows', () => {
  const NPM = String.raw`C:\Program Files\nodejs\npm.cmd`
  const on = (file: string | undefined, shell?: string) => ({
    platform: 'win32',
    find: () => file,
    ...(shell ? { shell } : {}),
  })

  test('anywhere else is the command and its arguments, with no shell', () => {
    expect(
      spawnOf('npm', ['install', '--', 'a&b'], {
        platform: 'linux',
        find: () => {
          throw new Error('Nothing is looked up.')
        },
      })
    ).toEqual({ file: 'npm', args: ['install', '--', 'a&b'], verbatim: false })
  })

  test('runs a program by its file, with no shell', () => {
    const file = String.raw`C:\tools\ddev.exe`
    expect(
      spawnOf('ddev', ['composer', 'require', '^2 & calc'], on(file))
    ).toEqual({
      file,
      args: ['composer', 'require', '^2 & calc'],
      verbatim: false,
    })
  })

  test('leaves a command it cannot find to fail as one that is not installed', () => {
    expect(spawnOf('ddev', ['start'], on(undefined))).toEqual({
      file: 'ddev',
      args: ['start'],
      verbatim: false,
    })
  })

  test('runs a batch file through the command interpreter, every argument quoted', () => {
    expect(spawnOf('npm', ['install', '--', 'druxt-a'], on(NPM))).toEqual({
      file: 'cmd.exe',
      args: ['/d', '/s', '/c', `""${NPM}" "install" "--" "druxt-a""`],
      verbatim: true,
    })
  })

  test('uses the interpreter the system names', () => {
    const shell = String.raw`C:\Windows\System32\cmd.exe`
    expect(spawnOf('npm', [], on(NPM, shell))).toMatchObject({ file: shell })
  })

  test.each(['.cmd', '.CMD', '.bat', '.BAT'])(
    'takes %s for a batch file',
    (extension) => {
      const file = String.raw`C:\php\composer` + extension
      expect(spawnOf('composer', ['install'], on(file))).toMatchObject({
        file: 'cmd.exe',
        verbatim: true,
      })
    }
  )

  test('keeps what the interpreter would read inside the quotes', () => {
    const plan = spawnOf(
      'composer',
      ['require', '--', 'cweagans/composer-patches:^2.0@beta', 'a&b|c>d<e (f)'],
      on(String.raw`C:\php\composer.bat`)
    )
    expect(plan).toMatchObject({
      args: [
        '/d',
        '/s',
        '/c',
        String.raw`""C:\php\composer.bat" "require" "--" "cweagans/composer-patches:^2.0@beta" "a&b|c>d<e (f)""`,
      ],
    })
  })

  test('doubles the backslashes an argument ends with, which would escape its quote', () => {
    const plan = spawnOf('npm', [String.raw`C:\site\ `.trim()], on(NPM))
    expect(plan).toMatchObject({
      args: ['/d', '/s', '/c', String.raw`""${NPM}" "C:\site\\""`],
    })
  })

  test.each([
    ['a quote', 'x" & calc & "'],
    ['a percent sign', '%PATH%'],
    ['a line break', 'x\ncalc'],
    ['a carriage return', 'x\rcalc'],
  ])('refuses an argument with %s for a batch file', (_name, argument) => {
    const plan = spawnOf('npm', ['install', argument], on(NPM))
    expect(plan).toEqual({
      refused: `npm is a batch file on Windows, and ${JSON.stringify(argument)} cannot be handed to one as it is: it has a quote, a percent sign or a line break in it.`,
    })
  })

  test('hands the same argument to a program, which reads no such thing', () => {
    expect(
      spawnOf('ddev', ['%PATH%', '"'], on(String.raw`C:\tools\ddev.exe`))
    ).toMatchObject({ args: ['%PATH%', '"'], verbatim: false })
  })

  test('a refused argument is a failed tool, and nothing is started', async () => {
    const dir = tmp('drx-path-')
    writeTree(dir, { 'npm.cmd': '@echo off\n' })
    const run = runToolOn('win32', { PATH: dir })
    const result = await run('npm', ['install', '%PATH%'], { cwd: tmp() })
    expect(result.code).toBe(126)
    expect(result.output).toContain('cannot be handed to one as it is')
  })
})

describe('finding the file of a command on Windows', () => {
  test('looks a name up on PATH, with the extensions of PATHEXT', () => {
    const dir = tmp('drx-path-')
    writeTree(dir, { 'npm.cmd': '' })
    expect(findCommandFile('npm', tmp(), { PATH: dir }, 'win32')).toBe(
      join(dir, 'npm.cmd')
    )
  })

  test('looks a path up from the directory the tool runs in', () => {
    const cwd = tmp('drx-part-')
    writeTree(cwd, { 'vendor/bin/drush.bat': '', 'vendor/bin/drush': '' })
    expect(findCommandFile('vendor/bin/drush', cwd, {}, 'win32')).toBe(
      join(cwd, 'vendor/bin/drush.bat')
    )
    expect(findCommandFile('vendor/bin/drush.bat', cwd, {}, 'win32')).toBe(
      join(cwd, 'vendor/bin/drush.bat')
    )
  })

  test('is undefined for a path that names no file', () => {
    expect(
      findCommandFile('vendor/bin/drush', tmp(), {}, 'win32')
    ).toBeUndefined()
  })
})
