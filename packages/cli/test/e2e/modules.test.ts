import { afterEach, describe, expect, test } from 'vitest'
import { run } from '../helpers/run.js'
import { cleanTmp } from '../helpers/tmp.js'

// Reads the published module registry over the network. Skipped unless
// DRX_E2E=1, which `npm run test:e2e` sets.
describe.skipIf(process.env.DRX_E2E !== '1')(
  'the published module registry',
  () => {
    afterEach(cleanTmp)

    test('is read and listed by drx module list', async () => {
      const result = await run(['module', 'list', '--all', '--json'])
      expect(result.stderr).toContain('Modules from https://cdn.jsdelivr.net/')
      expect(result.code).toBe(0)

      const { registry, modules } = JSON.parse(result.stdout)
      expect(registry.origin).toBe('remote')
      expect(modules.length).toBeGreaterThan(0)
      // The module that is Druxt itself is the one entry certain to stay.
      expect(modules.map((module: { name: string }) => module.name)).toContain(
        'druxt'
      )
    }, 60_000)

    test('has an entry drx module info can show by its package name', async () => {
      const result = await run(['module', 'info', 'druxt', '--json'])
      expect(result.code).toBe(0)
      expect(JSON.parse(result.stdout).module.name).toBe('druxt')
    }, 60_000)
  }
)
