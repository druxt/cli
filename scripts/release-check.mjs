/**
 * Pre-publish gate: refuse a release that would publish a broken package.
 * The release workflow runs it after versioning and building, before any
 * publish.
 *
 *   node scripts/release-check.mjs [<package directory>...] [--offline]
 *                                  [--skip-files] [--unpublished] [--dist-tag]
 *                                  [--registry=<url>]
 *
 * Each directory holds one package. Without one, the repository root is the
 * package. A workspace names its packages, as `npm run release:check` does.
 *
 * --offline      skip the npm registry comparison.
 * --skip-files   skip the built-files check, for when no build has run.
 * --registry=    read the published versions from this registry, not npm's.
 * --unpublished  print `name@version` when npm does not have this version
 *                yet, and check nothing.
 * --dist-tag     print the npm dist-tag a stable publish of this version takes,
 *                and check nothing.
 *
 * It checks three things. A dependency specifier such as `link:`,
 * `workspace:` or a path resolves on the author's machine and nowhere else.
 * A version at or below the published one either fails to publish or, as a
 * snapshot, sorts below the release it was cut after. And a build that emits
 * nothing, or part of what it should, still exits zero, so a `files` entry
 * has to exist and hold something, and every entry point the manifest
 * declares has to be among the files npm would pack.
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies']
const UNPUBLISHABLE =
  /^(workspace|link|file|portal|git|git\+ssh|git\+https|github|https?):/
// What npm reads as a file or a directory with no `file:` in front: a spec
// that starts with a dot, `~/`, a slash of either kind or a drive letter, or
// that names a tarball. The Windows forms count wherever this runs, because
// the manifest may have been written there.
const LOCAL_PATH = /^(?:\.|~\/|[/\\]|[a-zA-Z]:)|\.(?:tgz|tar\.gz|tar)$/i
const REGISTRY = 'https://registry.npmjs.org'
const REGISTRY_TIMEOUT = 15000
const VERSION = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/

/**
 * Splits a version into its numeric core and whether it is a prerelease.
 *
 * @param {string} version - The version to parse.
 * @returns {object|null} `{ core, prerelease }`, or `null` when it is invalid.
 */
export function parseVersion(version) {
  const match = VERSION.exec(version)
  if (!match) return null
  return {
    core: match.slice(1, 4).map(Number),
    prerelease: Boolean(match[4]),
  }
}

// Compares two numeric cores: negative, zero or positive, as a sort would.
const compareCores = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

// The highest published stable release with the given major, or `null` when the
// major has none. Prereleases are left out on purpose. A dev snapshot has the
// core of the release it is cut towards, so it shares that core with every
// snapshot before it, and a prerelease bar would refuse all but the first.
const highestStableOfMajor = (versions, major) =>
  versions
    .map((version) => ({ version, ...parseVersion(version) }))
    .filter(({ core, prerelease }) => core && !prerelease && core[0] === major)
    .reduce(
      (top, next) =>
        !top || compareCores(next.core, top.core) > 0 ? next : top,
      null
    )

/**
 * Picks the npm dist-tag for a stable publish. npm moves `latest` to whatever
 * it publishes without a tag, and refuses to when the version is a prerelease
 * or lower than `latest`, so those take a tag of their own.
 *
 * @param {string} version - The version to publish.
 * @param {object|null} record - `{ latest, versions }` from npm, or `null` when unpublished.
 * @returns {string} `next` for a prerelease, `latest-<major>` below `latest`, else `latest`.
 */
export function distTag(version, record) {
  const parsed = parseVersion(version)
  if (parsed.prerelease) return 'next'
  const latest = record && parseVersion(record.latest)
  if (latest && compareCores(parsed.core, latest.core) < 0) {
    return `latest-${parsed.core[0]}`
  }
  return 'latest'
}

/**
 * Every file the manifest names as a way into the package, with the key it
 * is named under. A pattern such as `./dist/*` names no one file, so it is
 * left out.
 *
 * @param {object} manifest - The parsed package.json.
 * @returns {Array<{ key: string, file: string }>} The entry points.
 */
export function entryPoints(manifest) {
  const found = []
  const walk = (key, value) => {
    if (typeof value === 'string') {
      if (!value.includes('*')) found.push({ key, file: value })
    } else if (Array.isArray(value)) {
      value.forEach((item) => walk(key, item))
    } else if (value && typeof value === 'object') {
      for (const [name, item] of Object.entries(value)) {
        // A subpath or a path-like bin name reads better in brackets.
        walk(
          /^[\w$]+$/.test(name) ? `${key}.${name}` : `${key}["${name}"]`,
          item
        )
      }
    }
  }
  for (const key of ['bin', 'main', 'module', 'types', 'typings', 'exports']) {
    walk(key, manifest[key])
  }
  return found
}

/**
 * The files npm would put in the tarball, as paths from the package root.
 * `npm pack --dry-run` reads the package directory and writes nothing.
 *
 * @param {string} dir - The package directory.
 * @returns {string[]} The packed paths.
 */
export function packedFiles(dir) {
  const out = execFileSync(
    'npm',
    ['pack', '--dry-run', '--json', '--ignore-scripts'],
    {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    }
  )
  return JSON.parse(out)[0].files.map((file) => file.path)
}

/**
 * Checks a manifest against the rules.
 *
 * @param {object} options - The check input.
 * @param {object} options.manifest - The parsed package.json.
 * @param {string} options.dir - The package directory.
 * @param {object|null} [options.record] - `{ latest, versions }` from npm, or `null` when unpublished. Omit to skip the registry rule.
 * @param {boolean} [options.files] - Whether to check the `files` entries.
 * @returns {string[]} One message per problem.
 */
export function checkManifest({ manifest, dir, record, files = true }) {
  const problems = []
  const parsed = parseVersion(manifest.version)

  if (!parsed) {
    return [`"${manifest.version}" is not a valid version.`]
  }

  for (const field of FIELDS) {
    for (const [dep, range] of Object.entries(manifest[field] || {})) {
      if (UNPUBLISHABLE.test(range) || LOCAL_PATH.test(range)) {
        problems.push(
          `${field}.${dep} is "${range}", which does not resolve from npm.`
        )
      }
    }
  }

  if (record && !record.versions.includes(manifest.version)) {
    const top = highestStableOfMajor(record.versions, parsed.core[0])
    if (top && compareCores(parsed.core, top.core) <= 0) {
      problems.push(
        `${manifest.version} does not rise above the published ${top.version}.`
      )
    }
  }

  if (files) {
    // Without a list npm packs the whole directory, and nothing here could
    // say whether the build output is in it.
    if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
      problems.push('package.json has no "files" list to check the build by.')
    }
    for (const entry of manifest.files || []) {
      const target = path.join(dir, entry)
      if (!fs.existsSync(target)) {
        problems.push(`files entry "${entry}" does not exist. Build first.`)
      } else if (
        fs.statSync(target).isDirectory() &&
        fs.readdirSync(target).length === 0
      ) {
        problems.push(`files entry "${entry}" is empty.`)
      }
    }

    // A directory that holds something can still lack the one file a `bin`
    // or an `exports` condition points at.
    const declared = entryPoints(manifest)
    if (declared.length) {
      let packed
      try {
        packed = new Set(packedFiles(dir))
      } catch (error) {
        problems.push(
          `npm could not list the files it would pack: ${error.message.trim()}`
        )
      }
      for (const { key, file } of packed ? declared : []) {
        if (!packed.has(path.posix.normalize(file.replace(/\\/g, '/')))) {
          problems.push(
            `${key} is "${file}", which is not among the files npm would pack.`
          )
        }
      }
    }
  }

  return problems
}

/**
 * Fetches the published versions of a package.
 *
 * @param {string} name - The package name.
 * @param {string} [registry] - The registry to ask, npm's own by default.
 * @returns {Promise<object|null>} `{ latest, versions }`, or `null` when npm has no such package.
 */
export function fetchRecord(name, registry = REGISTRY) {
  const url = `${registry.replace(/\/$/, '')}/${name.replace(/\//g, '%2f')}`
  const client = url.startsWith('http:') ? http : https
  const headers = { accept: 'application/vnd.npm.install-v1+json' }

  return new Promise((resolve, reject) => {
    const request = client.get(
      url,
      { headers, timeout: REGISTRY_TIMEOUT },
      (response) => {
        if (response.statusCode === 404) {
          response.resume()
          return resolve(null)
        }
        if (response.statusCode !== 200) {
          response.resume()
          return reject(
            new Error(`npm answered ${response.statusCode} for ${name}.`)
          )
        }

        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          body += chunk
        })
        // A connection that closes part way through the body ends the
        // response with no `end`, and with no error unless something listens
        // for one. Left alone, the promise never settles and the process
        // exits 0 having checked nothing.
        const incomplete = () =>
          reject(
            new Error(
              `npm closed the connection before its answer for ${name} was complete.`
            )
          )
        response.on('error', incomplete)
        response.on('close', () => {
          if (!response.complete) incomplete()
        })
        response.on('end', () => {
          const data = JSON.parse(body)
          resolve({
            latest: data['dist-tags'].latest,
            versions: Object.keys(data.versions),
          })
        })
      }
    )

    // Without this a stalled connection holds the job until its own timeout.
    request.on('timeout', () =>
      request.destroy(
        new Error(`npm did not answer for ${name} within 15 seconds.`)
      )
    )
    request.on('error', reject)
  })
}

/**
 * Runs one package through the options given.
 *
 * @param {string} dir - The package directory.
 * @param {string[]} options - The flags from the command line.
 * @returns {Promise<object[]>} A `{ name, problem }` per problem.
 */
async function checkPackage(dir, options) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dir, 'package.json'), 'utf8')
  )
  if (manifest.private) {
    console.log('release-check: the package is private, nothing to publish.')
    return []
  }

  // A recorded registry answer, so the tests never depend on the network.
  const recorded = options.find((arg) => arg.startsWith('--registry-file='))
  let record
  if (recorded) {
    record = JSON.parse(fs.readFileSync(recorded.split('=')[1], 'utf8'))
  } else if (!options.includes('--offline')) {
    const registry = options.find((arg) => arg.startsWith('--registry='))
    record = await fetchRecord(
      manifest.name,
      registry ? registry.slice('--registry='.length) : undefined
    )
  }

  if (options.includes('--unpublished')) {
    if (record === undefined) {
      throw new Error('--unpublished needs the registry, so not --offline.')
    }
    if (!record || !record.versions.includes(manifest.version)) {
      console.log(`${manifest.name}@${manifest.version}`)
    }
    return []
  }

  if (options.includes('--dist-tag')) {
    if (record === undefined) {
      throw new Error('--dist-tag needs the registry, so not --offline.')
    }
    console.log(distTag(manifest.version, record))
    return []
  }

  const problems = checkManifest({
    manifest,
    dir,
    record,
    files: !options.includes('--skip-files'),
  })
  if (!problems.length) {
    console.log(
      `release-check: ${manifest.name}@${manifest.version} can publish.`
    )
  }
  // With one package the message is enough. With several, it names its own.
  return problems.map((problem) => ({ name: manifest.name, problem }))
}

export async function main(argv = process.argv.slice(2)) {
  const flags = ['--offline', '--skip-files', '--unpublished', '--dist-tag']
  const options = argv.filter((arg) => arg.startsWith('--'))
  const unknown = options.filter(
    (arg) =>
      !flags.includes(arg) &&
      !arg.startsWith('--registry-file=') &&
      !arg.startsWith('--registry=')
  )
  if (unknown.length) throw new Error(`Unknown option: ${unknown.join(', ')}`)

  const named = argv.filter((arg) => !arg.startsWith('--'))
  const dirs = (named.length ? named : [ROOT]).map((dir) => path.resolve(dir))

  // Every package is checked before the verdict, so one run lists the
  // problems of all of them.
  const problems = []
  for (const dir of dirs) problems.push(...(await checkPackage(dir, options)))
  for (const { name, problem } of problems) {
    console.error(
      `release-check: ${dirs.length > 1 ? `${name}: ` : ''}${problem}`
    )
  }
  if (problems.length) process.exit(1)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(`release-check: ${error.message}`)
    process.exit(1)
  })
}
