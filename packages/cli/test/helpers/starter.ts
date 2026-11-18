import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validEntry } from './entry.js'
import { serve, type TestServer } from './server.js'
import { tmp, writeTree } from './tmp.js'

/** The files of the fixture starter: a small site with both parts. */
export const STARTER_FILES: Record<string, unknown> = {
  'README.md': '# Fixture starter\n',
  '.nvmrc': '16.18.1\n',
  'package.json': { name: 'fixture-starter', packageManager: 'npm@8.19.2' },
  'nuxt/package.json': {
    dependencies: { nuxt: '2.15.8', 'druxt-site': '^0.14.3' },
  },
  'nuxt/nuxt.config.js': 'export default {}\n',
  'drupal/composer.json': {
    require: { 'drupal/core-recommended': '~11', 'drupal/druxt': '^1.2' },
  },
}

/**
 * A gzipped tarball of the given files under one top-level directory, which
 * is the shape of a tarball GitHub serves for a branch.
 */
export function tarball(files: Record<string, unknown>): Buffer {
  const work = tmp('drx-tar-')
  writeTree(join(work, 'starter-main'), files)
  const archive = join(work, 'starter.tar.gz')
  execFileSync('tar', ['-czf', archive, '-C', work, 'starter-main'])
  return readFileSync(archive)
}

export interface FixtureRegistry extends TestServer {
  /** The entry the registry serves for `quickstart`. */
  entry: Record<string, unknown>
}

/**
 * A registry on a loopback port with one starter, `quickstart`, whose
 * tarball it also serves.
 */
export async function fixtureRegistry(
  files: Record<string, unknown> = STARTER_FILES,
  change: (entry: Record<string, unknown>) => void = () => {}
): Promise<FixtureRegistry> {
  const server = await serve({})
  const entry = validEntry()
  entry.tar = `${server.url}/quickstart.tar.gz`
  change(entry)
  server.files['/index.json'] = JSON.stringify({ starters: ['quickstart'] })
  server.files['/quickstart.json'] = JSON.stringify(entry)
  server.files['/quickstart.tar.gz'] = tarball(files)
  return { ...server, entry }
}
