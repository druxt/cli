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

/** A field that is not in the form it has to be, and what that form is. */
export interface FieldProblem {
  /** The field, as a path from the value that was checked. */
  field: string
  /** What it must be, to follow the field's name in a message. */
  must: string
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
  /**
   * What is wrong with a module a registry lists for this kind, or undefined.
   * The values of one reach the tools of the part as arguments, so each is
   * checked by its pattern where it is read, before any command is built.
   */
  moduleProblem?(module: { name: string }): FieldProblem | undefined
  /** The packages `info` reports for a part of this kind. */
  packages(dir: string): Promise<PackageVersion[]>
  /**
   * The Druxt package of the part: the range it asks for and the version
   * installed. Undefined when the part has none, or its kind never holds one.
   */
  druxt(dir: string): Promise<PackageVersion | undefined>
  /**
   * One package of the part by name, or undefined when the part neither
   * asks for it nor has it installed.
   */
  package(dir: string, name: string): Promise<PackageVersion | undefined>
  /** Installs a module into the part and registers it. Not available yet. */
  addModule(dir: string, name: string): Promise<void>
}

/** The `addModule` of every adapter until the `add` command exists. */
export async function addModuleNotAvailable(): Promise<never> {
  throw new DrxError('not-available', 'Adding a module is not available yet.')
}
