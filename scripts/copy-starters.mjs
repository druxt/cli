/**
 * Copy the starter registry into the CLI package.
 *
 * The registry is published from starters/ at the repository root, and the
 * CLI falls back to its own copy when that URL cannot be read. The copy is
 * made at build time, so the package never carries a registry older than the
 * commit it was built from.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const from = path.join(ROOT, 'starters')
const to = path.join(ROOT, 'packages', 'cli', 'starters')

fs.rmSync(to, { recursive: true, force: true })
fs.cpSync(from, to, { recursive: true })
console.log(`Copied ${fs.readdirSync(to).length} registry files to ${to}`)
