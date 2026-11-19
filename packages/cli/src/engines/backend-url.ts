import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { BackendUrlTarget } from '../registry/entry.js'

async function read(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * Writes the URL of the backend where the starter reads it: one variable in
 * a file of `NAME=value` lines. The file is started from the starter's
 * template when it does not exist, and every other line is left as it is.
 */
export async function writeBackendUrl(
  root: string,
  target: BackendUrlTarget,
  url: string
): Promise<void> {
  const file = join(root, target.file)
  const start =
    (await read(file)) ??
    (target.template ? await read(join(root, target.template)) : undefined) ??
    ''

  const line = `${target.variable}=${url}`
  const assignment = new RegExp(`^${target.variable}=.*$`, 'm')
  const content = assignment.test(start)
    ? start.replace(assignment, line)
    : `${start}${start === '' || start.endsWith('\n') ? '' : '\n'}${line}\n`

  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, content)
}
