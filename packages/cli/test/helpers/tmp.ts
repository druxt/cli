import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const created: string[] = []

/** A new empty directory, removed by `cleanTmp`. */
export function tmp(prefix = 'drx-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  created.push(dir)
  return dir
}

/** Removes every directory `tmp` made. Call it from `afterEach`. */
export function cleanTmp(): void {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Writes files under a directory. Objects are written as JSON. */
export function writeTree(root: string, files: Record<string, unknown>): void {
  for (const [path, content] of Object.entries(files)) {
    const file = join(root, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(
      file,
      typeof content === 'string' ? content : JSON.stringify(content, null, 2)
    )
  }
}
