import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  adapterFor,
  type KindAdapter,
  type PackageVersion,
} from '../adapters/index.js'
import type { Part } from '../parts.js'
import { findProjectRoot, loadProjectConfig } from '../project.js'
import { compatibility, type Compatibility } from './compatibility.js'
import type { ModuleEntry } from './entry.js'

/** A frontend part of the project, and the Druxt its adapter reports. */
export interface ModulePart {
  path: string
  kind: string
  druxt: PackageVersion | null
}

/** One module in one part. */
export interface ModuleInPart {
  path: string
  /** The version installed, or null. */
  installed: string | null
  /** The range the part asks for, or null. */
  declared: string | null
  compatibility: Compatibility
}

export interface ModuleProject {
  root: string
  parts: ModulePart[]
  /** How a module stands in each part, in the order of `parts`. */
  state(module: ModuleEntry): Promise<ModuleInPart[]>
}

/**
 * The project around `cwd` as the module commands see it: its frontend parts
 * that exist and have an adapter. Undefined outside a project, and in one
 * with no such part.
 */
export async function moduleProject(
  cwd: string
): Promise<ModuleProject | undefined> {
  const root = findProjectRoot(cwd)
  if (!root) return undefined
  const config = await loadProjectConfig(root)

  const found: {
    part: Part
    adapter: KindAdapter
    dir: string
    druxt: PackageVersion | undefined
  }[] = []
  for (const part of config.parts) {
    const adapter = adapterFor(part.kind)
    const dir = join(root, part.path)
    if (part.role !== 'frontend' || !adapter || !existsSync(dir)) continue
    found.push({ part, adapter, dir, druxt: await adapter.druxt(dir) })
  }
  if (found.length === 0) return undefined

  return {
    root,
    parts: found.map(({ part, druxt }) => ({
      path: part.path,
      kind: part.kind,
      druxt: druxt ?? null,
    })),
    async state(module) {
      const states: ModuleInPart[] = []
      for (const { part, adapter, dir, druxt } of found) {
        const own = module.npm
          ? await adapter.package(dir, module.npm)
          : undefined
        states.push({
          path: part.path,
          installed: own?.installed ?? null,
          declared: own?.range ?? null,
          compatibility: compatibility(module.druxt, druxt),
        })
      }
      return states
    },
  }
}
