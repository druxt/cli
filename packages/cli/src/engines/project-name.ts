import { readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

/** The name a starter gives its engine's project, and the files that hold it. */
export interface EngineProject {
  name: string
  files: string[]
}

/**
 * A project name for a site: its directory's name in lower case, with every
 * run of other characters as one hyphen. Engines use the name as a host name.
 */
export function siteProjectName(target: string): string {
  // One pass over the characters, so the time grows with the name's length
  // whatever it holds.
  let name = ''
  for (const char of basename(target).toLowerCase()) {
    const kept = /[a-z0-9]/.test(char)
    if (kept) name += char
    else if (name !== '' && !name.endsWith('-')) name += '-'
  }
  if (name.endsWith('-')) name = name.slice(0, -1)
  return name || 'druxt-site'
}

/** The text with the starter's project name replaced by the site's. */
export function renamed(text: string, project: EngineProject, name: string) {
  return text.split(project.name).join(name)
}

/**
 * Writes the site's project name where the starter had its own, in each file
 * the starter lists. Returns the files it changed.
 */
export async function renameProject(
  target: string,
  project: EngineProject,
  name: string
): Promise<string[]> {
  const changed: string[] = []
  for (const file of project.files) {
    let text: string
    try {
      text = await readFile(join(target, file), 'utf8')
    } catch {
      continue
    }
    const next = renamed(text, project, name)
    if (next === text) continue
    await writeFile(join(target, file), next)
    changed.push(file)
  }
  return changed
}
