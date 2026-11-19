import type { ToolResult } from '../exec.js'
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
  moduleProblem?(module: BackendModule): FieldProblem | undefined
  /**
   * What is wrong with a record of what was done to a part of this kind, or
   * undefined. A record is read from a file anybody may have written, and
   * its values reach the same tools, so it is checked in the same way.
   */
  recordProblem?(record: BackendRecord): FieldProblem | undefined
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

/**
 * Asks a part something by running one of its tools, with arguments that
 * change nothing. It is how a plan finds out what the part has now.
 */
export type Ask = (tool: string, args: string[]) => Promise<ToolResult>

/**
 * A change to a file of the part. The new content is worked out from the
 * file as it is when the step is taken, never from a copy read while
 * planning: a tool or another module may have written to it in between.
 */
export interface FileEdit {
  /** Relative to the part. */
  file: string
  /**
   * The content to write, given the content the file has now. It throws,
   * with the reason, when the file no longer takes the change.
   */
  change(source: string): string
  /** What the edit does, as one line. */
  summary: string
}

/**
 * A file of the part to delete. Whether it goes is worked out from the file
 * as it is when the step is taken, and a file that is not there is left out.
 */
export interface FileRemoval {
  /** Relative to the part. */
  file: string
  /** True when the file, with the content it has now, is to go. */
  when(source: string): boolean
  /** What the step does, as one line. */
  summary: string
}

/**
 * One step of a change. For an add it carries what it will have done once
 * it is taken, so the record can say what was done when a later step fails.
 */
export type ChangeStep = (
  { run: ToolRun } | { edit: FileEdit } | { remove: FileRemoval }
) & {
  /** What the step does about the package of the module. */
  did?: Partial<PackageRecord>
  /** What the step does to a backend part. */
  record?: BackendRecord
}

/** What a module needs of a part. A kind reads the fields that apply to it. */
export interface AddRequest {
  /** The frontend package of the module. */
  package?: string
  /**
   * The root of the project the part is in. A part looks from there down to
   * itself for what the whole project declares, such as its package manager.
   */
  root?: string
  /** The backend modules it needs, of this part's kind. */
  needs: BackendModule[]
  /** False to leave the patches of those modules out. */
  patches: boolean
  /** True when the registry marks core modules, so one not marked is not core. */
  registryStatesCore: boolean
  /**
   * Asks the part what it has. Undefined when the part is not run from this
   * machine, so nothing in it can be looked at or changed from here.
   */
  ask?: Ask
}

export interface RemoveRequest {
  package?: string
  /** The root of the project the part is in. */
  root?: string
  /**
   * What an earlier add did to the package in this part. Undefined when the
   * record does not say, as one written by an older version does not.
   */
  did?: PackageRecord
  /** What an earlier add did to this backend part, and is to be undone. */
  record?: BackendRecord
  ask?: Ask
}

/** What an add did about the package of a module in a frontend part. */
export interface PackageRecord {
  /** True when it installed the package, false when the part had it. */
  installed: boolean
  /** True when it listed the package in the config, false when it was there. */
  listed: boolean
  /**
   * True when it could not write to the config, and left the line that lists
   * the package to the user. Nothing then says whether the line is there.
   */
  byHand?: boolean
}

/** What an add did to a backend part, kept so a remove undoes that and no more. */
export interface BackendRecord {
  modules: {
    name: string
    /** The package that provides it. A module of core has none. */
    package?: string
    /** True when the add enabled it, false when it was enabled already. */
    enabled: boolean
    /** True when the add put its requirement in the manifest. */
    required: boolean
  }[]
  /** The patches it wrote, each with the module it was for. */
  patches: {
    package: string
    description: string
    url: string
    /** Absent in a record written before the module was kept. */
    module?: string
  }[]
  /**
   * What the add put in the part for its patches to be applied with, when
   * the part did not have it: `required` for the requirement on the tool that
   * applies them, `allowed` for the permission that lets the tool run. Absent
   * when the part had both. They go with the last patch of the part.
   */
  patcher?: { required: boolean; allowed: boolean }
}

/** The steps of a change to one part, in the order to take them. */
export interface ModuleChange {
  steps: ChangeStep[]
  /** Reasons the change cannot be made. With any, no step is taken. */
  problems: string[]
  warnings: string[]
  /** What was found that needs no step. */
  notes: string[]
  /** What the user has to do by hand, because the tool could not. */
  manual: string[]
  /** What is left to do once the change is made. */
  after: string[]
  /** For an add, what the steps do to the package of the module. */
  did?: PackageRecord
  /**
   * For an add, what the steps do to a backend part. For a remove, what
   * they leave in it, which stays on the project's record.
   */
  record?: BackendRecord
  /**
   * For an add, asks the part what the steps did once they have run, or
   * once one of them has failed. It is given the record of the steps that
   * were taken, and returns the record to keep. A backend may enable more
   * than it was asked to, or less, and only then can that be seen.
   */
  settle?: (done: BackendRecord) => Promise<BackendRecord>
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
