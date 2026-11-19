import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { findNewerNode } from '../src/find-node.js'
import { pathToFileURL } from 'node:url'
import { launch, launchProcess } from '../src/launch.js'
import { cleanTmp, tmp } from './helpers/tmp.js'

afterEach(cleanTmp)

/** A stand-in for a Node of the given version: it answers `--version`, and echoes anything else. */
function fakeNode(dir: string, version: string): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'node')
  writeFileSync(
    path,
    `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "v${version}"; exit 0; fi\necho "ran on ${version}: $@"\nexit 7\n`
  )
  chmodSync(path, 0o755)
  return path
}

describe.skipIf(process.platform === 'win32')(
  'finding a Node that is new enough',
  () => {
    test('takes the one named in DRX_NODE first', () => {
      const named = fakeNode(tmp('drx-named-'), '24.2.0')
      const onPath = tmp('drx-path-')
      fakeNode(onPath, '22.12.0')
      expect(
        findNewerNode({
          env: { DRX_NODE: named, PATH: onPath },
          script: '/x/drx',
          home: tmp(),
          current: '/old/node',
        })
      ).toBe(named)
    })

    test('takes the one beside the installed binary, which is the Node it was installed with', () => {
      const prefix = tmp('drx-prefix-')
      const beside = fakeNode(join(prefix, 'bin'), '24.2.0')
      expect(
        findNewerNode({
          env: { PATH: '' },
          script: join(prefix, 'bin', 'drx'),
          home: tmp(),
          current: '/old/node',
        })
      ).toBe(beside)
    })

    test('looks along PATH past a Node that is too old', () => {
      const old = tmp('drx-old-')
      const current = fakeNode(old, '16.18.1')
      const newer = tmp('drx-new-')
      const found = fakeNode(newer, '22.14.0')
      expect(
        findNewerNode({
          env: { PATH: `${old}:${newer}` },
          script: '/x/drx',
          home: tmp(),
          current,
        })
      ).toBe(found)
    })

    test('looks where the version managers keep their installs, newest first', () => {
      const home = tmp('drx-home-')
      fakeNode(join(home, '.nvm/versions/node/v16.18.1/bin'), '16.18.1')
      fakeNode(join(home, '.nvm/versions/node/v22.14.0/bin'), '22.14.0')
      const newest = fakeNode(
        join(home, '.nvm/versions/node/v24.2.0/bin'),
        '24.2.0'
      )
      expect(
        findNewerNode({
          env: { PATH: '' },
          script: '/x/drx',
          home,
          current: '/old/node',
        })
      ).toBe(newest)
    })

    test('finds none when every Node is too old or is not a Node', () => {
      const dir = tmp('drx-none-')
      fakeNode(dir, '18.20.0')
      const broken = tmp('drx-broken-')
      writeFileSync(join(broken, 'node'), '#!/bin/sh\nexit 1\n')
      chmodSync(join(broken, 'node'), 0o755)
      expect(
        findNewerNode({
          env: { PATH: `${dir}:${broken}` },
          script: '/x/drx',
          home: tmp(),
          current: '/old/node',
        })
      ).toBeUndefined()
    })
  }
)

describe.skipIf(process.platform === 'win32')(
  'launching on an old Node',
  () => {
    const sink = () => {
      let text = ''
      return { write: (chunk: string) => (text += chunk), read: () => text }
    }

    test('runs the same command on a newer Node it found, and returns its exit code', async () => {
      const newer = tmp('drx-new-')
      fakeNode(newer, '24.2.0')
      const stderr = sink()
      const code = await launch({
        node: '16.18.1',
        argv: ['info'],
        script: '/x/drx',
        env: { PATH: newer },
        home: tmp(),
        current: '/old/node',
        stderr,
        run: async () => 0,
        stdio: 'ignore',
      })
      expect(code).toBe(7)
      expect(stderr.read()).toBe('')
    })

    test('says what it needs when no newer Node is found, and does not start itself twice', async () => {
      const stderr = sink()
      const none = await launch({
        node: '16.18.1',
        argv: ['info'],
        script: '/x/drx',
        env: { PATH: '' },
        home: tmp(),
        current: '/old/node',
        stderr,
        run: async () => 0,
      })
      expect(none).toBe(1)
      expect(stderr.read()).toContain(
        'drx needs Node 22.12.0 or later, and this is Node 16.18.1.'
      )
      expect(stderr.read()).toContain('DRX_NODE')

      const newer = tmp('drx-new-')
      fakeNode(newer, '24.2.0')
      const again = sink()
      const looped = await launch({
        node: '16.18.1',
        argv: ['info'],
        script: '/x/drx',
        env: { PATH: newer, DRX_RELAUNCHED: '1' },
        home: tmp(),
        current: '/old/node',
        stderr: again,
        run: async () => 0,
      })
      expect(looped).toBe(1)
      expect(again.read()).toContain('this is Node 16.18.1')
    })

    test('runs the command itself on a Node that is new enough', async () => {
      const stderr = sink()
      const code = await launch({
        node: process.versions.node,
        argv: ['x'],
        script: '/x/drx',
        env: {},
        home: tmp(),
        current: process.execPath,
        stderr,
        run: async (argv) => (argv[0] === 'x' ? 5 : 0),
      })
      expect(code).toBe(5)
    })
  }
)

describe('launching from the running process', () => {
  test('loads the named command and runs it with the arguments after the script', async () => {
    const dir = tmp('drx-module-')
    const file = join(dir, 'command.mjs')
    writeFileSync(
      file,
      'export const command = async (argv) => argv.length + 40\n'
    )
    const code = await launchProcess(
      {
        versions: { node: process.versions.node },
        argv: ['/usr/bin/node', '/x/drx', 'a', 'b'],
        env: {},
        execPath: process.execPath,
        stderr: { write: () => true },
      },
      tmp(),
      pathToFileURL(file).href,
      'command'
    )
    expect(code).toBe(42)
  })
})

describe('the Node a relaunched command reports', () => {
  test('is the one the shell is on, when the launcher passed it', async () => {
    const { shellNode } = await import('../src/context.js')
    expect(shellNode('16.18.1')).toBe('16.18.1')
    expect(shellNode('1')).toBeUndefined()
    expect(shellNode(undefined)).toBeUndefined()
  })
})
