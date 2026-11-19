import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // create-druxt imports the CLI by its package name. The tests read the
    // CLI's sources, so they do not depend on a build having run.
    alias: {
      '@druxt/cli': fileURLToPath(
        new URL('./packages/cli/src/index.ts', import.meta.url)
      ),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'test/**/*.test.ts'],
    // A git hook's variables would send a test's own git commands to the repository being committed to.
    setupFiles: ['./test/setup/git-env.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'scripts/lint-private-refs.mjs'],
      reporter: ['text', 'lcov'],
    },
  },
})
