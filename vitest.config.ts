import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // create-druxt imports the CLI by its package name. The tests read the
    // CLI's sources, so they do not depend on a build having run.
    alias: {
      // The longer name first: an alias matches by prefix.
      '@druxt/cli/launch': fileURLToPath(
        new URL('./packages/cli/src/launch.ts', import.meta.url)
      ),
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
      // A floor measured from the tests as they are, not a target. Raise it
      // when coverage improves, and never lower it to make a change pass.
      thresholds: {
        statements: 94,
        branches: 87,
        functions: 95,
        lines: 94,
      },
    },
  },
})
