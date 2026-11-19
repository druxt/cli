import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { openRegistry } from '../../src/registry/registry.js'
import { run } from '../helpers/run.js'
import { cleanTmp, tmp } from '../helpers/tmp.js'

// The one test that uses the network: the real registry entry and the real
// tarball it points at. It is skipped unless DRX_E2E=1, and `npm run test:e2e`
// sets that.
describe.skipIf(process.env.DRX_E2E !== '1')('the quickstart starter', () => {
  beforeEach(() => {
    vi.stubEnv('XDG_CACHE_HOME', tmp('drx-cache-'))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    cleanTmp()
  })

  test('holds every file its engines name, and the file its backend URL goes in', async () => {
    const cwd = tmp('drx-e2e-')
    const created = await run(
      ['init', 'site', '--yes', '--keep-engines', '--json'],
      { cwd }
    )
    expect(created.code).toBe(0)
    const site = join(cwd, 'site')

    const registry = await openRegistry()
    const { engines = [], backendUrl } = (await registry.entry('quickstart'))
      .druxt
    expect(engines.length).toBeGreaterThan(0)
    for (const engine of engines) {
      for (const file of engine.files ?? []) {
        expect(existsSync(join(site, file)), file).toBe(true)
      }
      for (const step of engine.steps) {
        if (typeof step !== 'string') {
          expect(existsSync(join(site, step.dir)), step.dir).toBe(true)
        }
      }
    }
    expect(existsSync(join(site, backendUrl?.template ?? 'missing'))).toBe(true)
  }, 120_000)

  test('is left without the other engines when one is chosen', async () => {
    const cwd = tmp('drx-e2e-')
    const created = await run(
      ['init', 'site', '--yes', '--engine', 'lando', '--json'],
      { cwd }
    )
    expect(created.code).toBe(0)
    const site = join(cwd, 'site')
    // The starter's own scripts run the local tooling in drupal/.devtools whatever the engine, so it stays.
    expect(JSON.parse(created.stdout).removed).toEqual([
      'drupal/.ddev/config.yaml',
      'drupal/.ddev/docker-compose.env.yaml',
      'drupal/.ddev/docker-compose.network-mtu.yaml',
    ])
    expect(existsSync(join(site, 'drupal/.lando.yml'))).toBe(true)
    expect(existsSync(join(site, 'drupal/.devtools'))).toBe(true)
    expect(
      existsSync(join(site, 'drupal/.ddev/commands/web/drupal-install'))
    ).toBe(true)
    expect(readFileSync(join(site, '.env'), 'utf8')).toContain(
      'BASE_URL=https://druxt-quickstart.lndo.site'
    )
  }, 120_000)

  test('is created by drx init and read back by drx info', async () => {
    const cwd = tmp('drx-e2e-')
    const created = await run(['init', 'site', '--yes', '--json'], { cwd })
    expect(created.stderr).toContain('Reading starters from')
    expect(created.code).toBe(0)

    const site = join(cwd, 'site')
    const result = JSON.parse(created.stdout)
    expect(result.directory).toBe(site)
    expect(result.starter).toBe('quickstart')

    // What the entry says about the starter has to be true of the tarball.
    for (const part of result.parts) {
      expect(existsSync(join(site, part.path)), part.path).toBe(true)
    }
    expect(readFileSync(join(site, '.nvmrc'), 'utf8').trim()).toBe(
      result.requires.node
    )
    const scripts = JSON.parse(
      readFileSync(join(site, 'package.json'), 'utf8')
    ).scripts
    for (const step of result.next.slice(1)) {
      expect(scripts, step).toHaveProperty(step.replace('npm run ', ''))
    }

    const info = await run(['info', '--json'], { cwd: join(site, 'nuxt') })
    expect(info.code).toBe(0)
    const project = JSON.parse(info.stdout).project
    expect(project.root).toBe(site)
    expect(project.layout).toBe('monorepo')
    for (const part of project.parts) {
      expect(part.detected, part.path).toBe(true)
      expect(part.packages.length, part.path).toBeGreaterThan(0)
    }
  }, 120_000)
})
