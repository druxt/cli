import { DrxError } from '../errors.js'
import type { Role } from '../parts.js'

/** One package a part depends on. */
export interface PackageVersion {
  name: string
  /** The range the part asks for, or null when it does not declare one. */
  range: string | null
  /** The version that is installed, or null when none is. */
  installed: string | null
}

/**
 * Everything the CLI knows about one kind of part. The commands call this
 * interface and never a kind by name, so a new kind is a new file in this
 * directory and one line in index.ts.
 */
export interface KindAdapter {
  /** The value a part's `kind` holds. */
  readonly kind: string
  readonly role: Role
  /** True when the directory holds a part of this kind. */
  detect(dir: string): Promise<boolean>
  /** The packages `info` reports for a part of this kind. */
  packages(dir: string): Promise<PackageVersion[]>
  /** Installs a module into the part and registers it. Not available yet. */
  addModule(dir: string, name: string): Promise<void>
}

/** The `addModule` of every adapter until the `add` command exists. */
export async function addModuleNotAvailable(): Promise<never> {
  throw new DrxError('not-available', 'Adding a module is not available yet.')
}
