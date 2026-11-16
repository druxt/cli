import type { BackendModule } from '../modules/entry.js'
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
  /**
   * What adding a module to the part takes. Nothing is run or written here:
   * the command prints the steps, and runs them unless it is a dry run.
   */
  addModule(dir: string, request: AddRequest): Promise<ModuleChange>
  /** What taking a module out of the part takes. */
  removeModule(dir: string, request: RemoveRequest): Promise<ModuleChange>
}

/** A tool to run in the part, by the name the part's engine knows it by. */
export interface ToolRun {
  tool: string
  args: string[]
}

/** A file of the part to write, with its whole new content. */
export interface FileEdit {
  /** Relative to the part. */
  file: string
  content: string
  /** What the edit does, as one line. */
  summary: string
}

/** What a module needs of a part. A kind reads the fields that apply to it. */
export interface AddRequest {
  /** The frontend package of the module. */
  package?: string
  /** The backend modules it needs, of this part's kind. */
  needs: BackendModule[]
  /** False to leave the patches of those modules out. */
  patches: boolean
  /** True when the registry marks core modules, so one not marked is not core. */
  registryStatesCore: boolean
}

export interface RemoveRequest {
  package?: string
  /** What an earlier add did to this part, from the project's record. */
  record?: BackendRecord
  /** Backend modules another installed module needs, which must stay. */
  stillNeeded: string[]
}

/** What an add did to a backend part, kept so a remove undoes that and no more. */
export interface BackendRecord {
  /** The modules it required and enabled, which were not there before. */
  modules: { name: string; package: string }[]
  /** The patches it wrote. */
  patches: { package: string; description: string; url: string }[]
}

/** The steps of a change to one part, in the order to take them. */
export interface ModuleChange {
  steps: ({ run: ToolRun } | { edit: FileEdit })[]
  /** Reasons the change cannot be made. With any, no step is taken. */
  problems: string[]
  warnings: string[]
  /** What was found that needs no step. */
  notes: string[]
  /** What the user has to do by hand, because the tool could not. */
  manual: string[]
  /** What is left to do once the change is made. */
  after: string[]
  /** What to keep in the project's record. */
  record?: BackendRecord
}

export function emptyChange(): ModuleChange {
  return {
    steps: [],
    problems: [],
    warnings: [],
    notes: [],
    manual: [],
    after: [],
  }
}
