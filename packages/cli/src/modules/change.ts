import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { adapterFor, type KindAdapter } from '../adapters/index.js'
import type {
  Ask,
  BackendRecord,
  ChangeStep,
  ModuleChange,
  PackageRecord,
} from '../adapters/adapter.js'
import type { CliContext } from '../context.js'
import { engineFor } from '../engines/index.js'
import { DrxError } from '../errors.js'
import type { RunTool } from '../exec.js'
import type { Output } from '../output.js'
import type { Part } from '../parts.js'
import {
  loadProjectConfig,
  writeProjectConfig,
  type ModuleRecord,
  type ProjectConfig,
} from '../project.js'
import { compatibility } from './compatibility.js'
import type { ModuleEntry } from './entry.js'

/**
 * One thing to do to the project, as it will be shown and done. An edit
 * holds the change and not the content: the content is made from the file
 * as it is when the step is taken.
 */
export type PlannedStep = (
  | {
      type: 'run'
      command: string
      args: string[]
      cwd: string
      display: string
    }
  | {
      type: 'edit'
      file: string
      change: (source: string) => string
      display: string
    }
) & {
  /** For an add: what the step does about the package of the module. */
  did?: Partial<PackageRecord>
  /** For an add: what the step does to a backend part. */
  record?: BackendRecord
  /** True once the step has been taken. */
  done?: boolean
}

/** The steps for one part, or what to do where a backend that is elsewhere is. */
export interface PartPlan {
  path: string
  steps: PlannedStep[]
  /** Why the steps cannot be taken from here, and the lines to run instead. */
  elsewhere?: { reason: string; lines: string[] }
  /**
   * Asks the part what the steps did, given the record of those that were
   * taken, once they have run or one of them has failed.
   */
  settle?: (done: BackendRecord) => Promise<BackendRecord>
}

/** Why a module cannot be changed. `--force` goes past a forceable one. */
interface Refusal {
  reason: string
  forceable: boolean
}

export interface ModulePlan {
  action: 'add' | 'remove'
  module: ModuleEntry
  package: string
  parts: PartPlan[]
  refusals: Refusal[]
  warnings: string[]
  notes: string[]
  /** What is left for the user once the steps are done. */
  after: string[]
  /**
   * The record once the steps are done: what the project's record of the
   * module becomes. Undefined when nothing of it is left to keep.
   */
  record?: ModuleRecord
  /**
   * What a removal leaves in a backend part for another module of the
   * project that still needs it, to go on that module's record.
   */
  handOver: { to: string; path: string; record: BackendRecord }[]
  /**
   * For an add, sets `record` to what the steps taken so far did. It is
   * called once they have all run, and when one of them fails. A plan is
   * made before anything is changed, and a part may do more than it was
   * asked to, or less.
   */
  settle?: () => Promise<void>
}

/**
 * The project a change is made to. `config` is kept in step with the file:
 * carrying a plan out reads the file again, writes it and leaves the result
 * here, for the plan of the next module to be made from.
 */
export interface Project {
  root: string
  config: ProjectConfig
}

export interface ChangeOptions {
  force: boolean
  patches: boolean
  backend: boolean
  registryStatesCore: boolean
  /** Every module of the registry, to see what else needs a backend module. */
  registry: ModuleEntry[]
  /** The names being changed in this run. */
  names: string[]
  /** Runs a tool, to ask a backend part what it has. */
  exec: RunTool
}

interface Located {
  part: Part
  dir: string
  adapter: KindAdapter
}

/** The parts of one role that exist and have an adapter. */
function located(project: Project, role: Part['role']): Located[] {
  return project.config.parts.flatMap((part) => {
    const adapter = adapterFor(part.kind)
    const dir = join(project.root, part.path)
    return part.role === role && adapter && existsSync(dir)
      ? [{ part, dir, adapter }]
      : []
  })
}

/**
 * A way to ask a backend part what it has, through the engine that runs it.
 * Undefined for a part that is not run from this machine.
 */
function asker(project: Project, at: Located, exec: RunTool): Ask | undefined {
  const engine = at.part.engine ? engineFor(at.part.engine) : undefined
  if (!engine?.local) return undefined
  return (tool, args) => {
    const line = engine.run(at.part, tool, args)
    return exec(line.command, line.args, {
      cwd: join(project.root, line.cwd),
    })
  }
}

/** Why each part of a role in the project cannot be changed, as sentences. */
function unusable(project: Project, role: Part['role']): string[] {
  const parts = project.config.parts.filter((part) => part.role === role)
  if (parts.length === 0) return [`The project has no ${role} part.`]
  return parts.flatMap((part) => {
    if (!adapterFor(part.kind)) {
      return [
        `${part.path}/ is of the kind ${part.kind}, which this version cannot add a module to.`,
      ]
    }
    return existsSync(join(project.root, part.path))
      ? []
      : [`${part.path}/ does not exist.`]
  })
}

const hasAny = (record: BackendRecord) =>
  record.modules.length + record.patches.length > 0

/** Two records of what was done to one backend part, as one. */
function mergeBackend(a: BackendRecord, b: BackendRecord): BackendRecord {
  const modules = a.modules.map((module) => ({ ...module }))
  for (const module of b.modules) {
    const same = modules.find(({ name }) => name === module.name)
    if (!same) {
      modules.push({ ...module })
      continue
    }
    same.enabled ||= module.enabled
    same.required ||= module.required
    if (module.package) same.package = module.package
  }
  const key = (patch: BackendRecord['patches'][number]) =>
    [patch.package, patch.description, patch.url].join('\n')
  const patches = [...a.patches]
  for (const patch of b.patches) {
    if (!patches.some((other) => key(other) === key(patch))) patches.push(patch)
  }
  return { modules, patches }
}

/** One part's record folded into the list kept for a module. */
function withBackend(
  list: ModuleRecord['backend'],
  path: string,
  record: BackendRecord
): ModuleRecord['backend'] {
  const merged = mergeBackend(
    list.find((entry) => entry.path === path) ?? { modules: [], patches: [] },
    record
  )
  return [
    ...list.filter((entry) => entry.path !== path),
    ...(hasAny(merged) ? [{ path, ...merged }] : []),
  ]
}

/**
 * What a second add leaves on the record: everything either add did. A part
 * the first add installed the package in is still one the CLI installed it
 * in, though the second found it there.
 */
function mergeRecords(old: ModuleRecord, now: ModuleRecord): ModuleRecord {
  const frontend = (now.frontend ?? []).map((entry) => {
    const before = old.frontend?.find(({ path }) => path === entry.path)
    return {
      path: entry.path,
      installed: entry.installed || before?.installed === true,
      listed: entry.listed || before?.listed === true,
    }
  })
  // What this add did comes first, so a run that finishes what an earlier
  // one left undone ends with the record of a run that did it all.
  const nothing: BackendRecord = { modules: [], patches: [] }
  const paths = [...now.backend, ...old.backend].map(({ path }) => path)
  const backend = [...new Set(paths)].flatMap((path) => {
    const merged = mergeBackend(
      now.backend.find((entry) => entry.path === path) ?? nothing,
      old.backend.find((entry) => entry.path === path) ?? nothing
    )
    return hasAny(merged) ? [{ path, ...merged }] : []
  })
  return { name: now.name, package: now.package, frontend, backend }
}

const pluralPatches = (count: number) =>
  `${count} patch${count === 1 ? '' : 'es'}`

/** A step of an adapter as one to show and take, with what it records. */
function planned(
  step: ChangeStep,
  dir: string,
  line: (run: { tool: string; args: string[] }) => {
    command: string
    args: string[]
    cwd: string
  }
): PlannedStep {
  const records = {
    ...(step.did ? { did: step.did } : {}),
    ...(step.record ? { record: step.record } : {}),
  }
  if ('edit' in step) {
    return {
      type: 'edit',
      file: join(dir, step.edit.file),
      change: step.edit.change,
      display: step.edit.summary,
      ...records,
    }
  }
  const { command, args, cwd } = line(step.run)
  return {
    type: 'run',
    command,
    args,
    cwd,
    display: [command, ...args].join(' '),
    ...records,
  }
}

/** The steps of a frontend part, which are run in it as they are. */
function frontendPlan(at: Located, change: ModuleChange): PartPlan {
  return {
    path: at.part.path,
    steps: change.steps.map((step) =>
      planned(step, at.dir, ({ tool, args }) => ({
        command: tool,
        args,
        cwd: at.dir,
      }))
    ),
  }
}

/**
 * The steps of a backend part, with each tool turned into the command line
 * of the part's engine. A backend that is not run from this machine gets no
 * steps: the lines are kept to print, for whoever is where it runs.
 */
function backendPlan(
  project: Project,
  at: Located,
  change: ModuleChange
): PartPlan {
  const { part } = at
  const engine = part.engine ? engineFor(part.engine) : undefined

  if (!engine?.local) {
    const lines = [
      ...(change.record?.patches ?? []).map(
        (patch) =>
          `Patch ${patch.package} with ${patch.url} (${patch.description})`
      ),
      ...change.steps.flatMap((step) =>
        'run' in step ? [[step.run.tool, ...step.run.args].join(' ')] : []
      ),
    ]
    return {
      path: part.path,
      steps: [],
      ...(lines.length > 0
        ? {
            elsewhere: {
              reason: engine
                ? 'The backend of this project is not on this machine. Where it is:'
                : `This project does not record how ${part.path}/ is run. In it:`,
              lines,
            },
          }
        : {}),
    }
  }

  return {
    path: part.path,
    steps: change.steps.map((step) =>
      planned(step, at.dir, ({ tool, args }) => {
        const line = engine.run(part, tool, args)
        return { ...line, cwd: join(project.root, line.cwd) }
      })
    ),
    ...(change.settle ? { settle: change.settle } : {}),
  }
}

/** Folds what an adapter found into the plan of the module. */
function absorb(plan: ModulePlan, change: ModuleChange): void {
  plan.refusals.push(
    ...change.problems.map((reason) => ({ reason, forceable: false }))
  )
  plan.warnings.push(...change.warnings)
  plan.notes.push(...change.notes)
  plan.after.push(...change.manual, ...change.after)
}

function elsewhereLines(part: PartPlan): string[] {
  return part.elsewhere
    ? [
        part.elsewhere.reason,
        ...part.elsewhere.lines.map((line) => `  ${line}`),
      ]
    : []
}

/** Everything adding one module to the project takes. Nothing is done here. */
export async function planAdd(
  module: ModuleEntry,
  project: Project,
  options: ChangeOptions
): Promise<ModulePlan> {
  const plan: ModulePlan = {
    action: 'add',
    module,
    package: module.npm ?? '',
    parts: [],
    refusals: [],
    warnings: [],
    notes: [],
    after: [],
    handOver: [],
  }
  if (module.archived) {
    plan.refusals.push({
      reason: `${module.name} is archived.`,
      forceable: true,
    })
  }
  if (!module.npm) {
    plan.refusals.push({
      reason: `${module.name} has no package to install: it is not released.`,
      forceable: false,
    })
    return plan
  }

  const npm = module.npm
  const frontend: { path: string; part: PartPlan }[] = []
  for (const at of located(project, 'frontend')) {
    const druxt = await at.adapter.druxt(at.dir)
    const fit = compatibility(module.druxt, druxt)
    if (fit === 'incompatible' && druxt) {
      const has = druxt.installed ?? `asked for as ${druxt.range}`
      plan.refusals.push({
        reason: `${module.name} works with ${druxt.name} ${module.druxt}, and ${at.part.path}/ has ${druxt.name} ${has}.`,
        forceable: true,
      })
    } else if (fit === 'unknown' && druxt) {
      plan.warnings.push(
        `${module.name} does not say which ${druxt.name} it works with, so it may not work with the one in ${at.part.path}/.`
      )
    }
    const change = await at.adapter.addModule(at.dir, {
      package: npm,
      root: project.root,
      needs: [],
      patches: options.patches,
      registryStatesCore: options.registryStatesCore,
    })
    absorb(plan, change)
    const part = frontendPlan(at, change)
    plan.parts.push(part)
    if (change.did) frontend.push({ path: at.part.path, part })
  }
  // With no part to put the package in, nothing would be added at all.
  if (frontend.length === 0) {
    plan.refusals.push({
      reason: [
        `No frontend part of this project can take ${npm}.`,
        ...unusable(project, 'frontend'),
      ].join(' '),
      forceable: false,
    })
    return plan
  }

  const backend: { path: string; part: PartPlan }[] = []
  const parts = located(project, 'backend')
  for (const at of parts) {
    const needs = module.backend.filter((need) => need.kind === at.part.kind)
    if (needs.length === 0) continue
    const ask = asker(project, at, options.exec)
    const change = await at.adapter.addModule(at.dir, {
      root: project.root,
      needs,
      patches: options.patches,
      registryStatesCore: options.registryStatesCore,
      ...(ask ? { ask } : {}),
    })
    const part = backendPlan(project, at, change)
    absorb(plan, change)
    plan.parts.push(part)
    backend.push({ path: at.part.path, part })
  }

  // What the module needs of a backend that no part of the project is, is
  // for the user to do where that backend runs.
  const unmet = module.backend.filter(
    (need) => !parts.some((at) => at.part.kind === need.kind)
  )
  if (unmet.length > 0) {
    plan.after.push(
      `${module.name} needs a backend, and this project has no backend part that can take what it needs. Where the backend is:`,
      ...unmet.flatMap((need) => [
        `  Enable ${need.label} (${need.name})`,
        ...(options.patches ? (need.patches ?? []) : []).map(
          (patch) =>
            `  Patch ${patch.package ?? need.label} with ${patch.url} (${patch.description})`
        ),
        ...(need.setup ?? []).flatMap((step) => [
          `  ${need.label}: ${step.title}`,
          ...(step.command ? [`    ${step.command}`] : []),
          ...(step.url ? [`    ${step.url}`] : []),
        ]),
      ])
    )
  }

  // A module added before keeps what that add did: this one found it there.
  const before = project.config.modules?.find(
    (entry) => entry.name === module.name
  )
  // The record is what the steps taken did, and no more. Each step says
  // what it does, so the record is as true of a run that stopped part way
  // as of one that finished.
  const taken = (part: PartPlan) => part.steps.filter((step) => step.done)
  plan.settle = async () => {
    const now: ModuleRecord = {
      name: module.name,
      package: npm,
      frontend: frontend.map(({ path, part }) => ({
        path,
        installed: taken(part).some((step) => step.did?.installed === true),
        listed: taken(part).some((step) => step.did?.listed === true),
      })),
      backend: [],
    }
    for (const { path, part } of backend) {
      let done: BackendRecord = { modules: [], patches: [] }
      for (const step of taken(part)) {
        if (step.record) done = mergeBackend(done, step.record)
      }
      if (part.settle) done = await part.settle(done)
      if (hasAny(done)) now.backend.push({ path, ...done })
    }
    plan.record = before ? mergeRecords(before, now) : now
  }
  return plan
}

/** True when a frontend part of the project asks for a package. */
async function declares(project: Project, name: string): Promise<boolean> {
  for (const at of located(project, 'frontend')) {
    const found = await at.adapter.package(at.dir, name)
    if (found && found.range !== null) return true
  }
  return false
}

/**
 * Everything taking one module out of the project takes: what the record
 * says `drx add` did, and no more. What stays in place stays on the record.
 */
export async function planRemove(
  module: ModuleEntry,
  project: Project,
  options: ChangeOptions
): Promise<ModulePlan> {
  const plan: ModulePlan = {
    action: 'remove',
    module,
    package: module.npm ?? '',
    parts: [],
    refusals: [],
    warnings: [],
    notes: [],
    after: [],
    handOver: [],
  }
  const recorded = project.config.modules?.find(
    (entry) => entry.name === module.name
  )
  if (!recorded) {
    const there = module.npm ? await declares(project, module.npm) : false
    plan.refusals.push({
      reason: there
        ? `drx add did not put ${module.npm} in this project, so there is nothing of its own to undo. Uninstall the package and take it out of the config by hand.`
        : `${module.npm ?? module.name} is not in this project.`,
      forceable: false,
    })
    return plan
  }

  for (const at of located(project, 'frontend')) {
    // A record with a frontend list says what was done to every part.
    const did = recorded.frontend
      ? (recorded.frontend.find(({ path }) => path === at.part.path) ?? {
          installed: false,
          listed: false,
        })
      : undefined
    const change = await at.adapter.removeModule(at.dir, {
      ...(module.npm ? { package: module.npm } : {}),
      root: project.root,
      ...(did ? { did: { installed: did.installed, listed: did.listed } } : {}),
    })
    absorb(plan, change)
    plan.parts.push(frontendPlan(at, change))
  }

  const keep = (backend: ModuleRecord['backend']) => {
    if (backend.length === 0) return
    plan.record = {
      name: recorded.name,
      package: recorded.package,
      frontend: [],
      backend,
    }
  }
  if (!options.backend) {
    for (const entry of recorded.backend) {
      const put = [
        ...entry.modules.map(({ name }) => name),
        ...(entry.patches.length > 0
          ? [pluralPatches(entry.patches.length)]
          : []),
      ]
      plan.after.push(
        `The backend was left as it is. drx remove ${module.name} --backend takes out what drx add put in ${entry.path}/: ${put.join(', ')}.`
      )
    }
    // The record stays, so the backend can still be undone.
    keep(recorded.backend)
    return plan
  }

  // A backend module stays while any other module in the project needs it.
  // A module is in the project while a frontend part asks for its package:
  // a record alone may be what an earlier removal left behind.
  const neededBy = new Map<string, string>()
  for (const other of options.registry) {
    if (options.names.includes(other.name) || !other.npm) continue
    if (other.npm === module.npm) continue
    if (!(await declares(project, other.npm))) continue
    for (const need of other.backend) {
      if (!neededBy.has(need.name)) neededBy.set(need.name, other.name)
    }
  }

  let left: ModuleRecord['backend'] = []
  for (const { path, ...entry } of recorded.backend) {
    const at = located(project, 'backend').find(
      (found) => found.part.path === path
    )
    if (!at) {
      // The part is gone or has moved. Its record waits for it.
      left = withBackend(left, path, entry)
      continue
    }

    // What another module needs is set aside, with the patches written for
    // it. A record that does not say what a patch was for keeps them all
    // while any module stays.
    const staying = entry.modules.filter(({ name }) => neededBy.has(name))
    const stays = (patch: BackendRecord['patches'][number]) =>
      patch.module
        ? staying.some(({ name }) => name === patch.module)
        : staying.length > 0
    for (const [index, held] of staying.entries()) {
      const by = neededBy.get(held.name) as string
      plan.notes.push(`${held.name} stays: ${by} needs it.`)
      const record: BackendRecord = {
        modules: [held],
        patches: entry.patches.filter((patch) =>
          patch.module ? patch.module === held.name : index === 0
        ),
      }
      // It goes on the record of the module that needs it, when that one
      // has a record, so removing that module takes it out.
      if (project.config.modules?.some(({ name }) => name === by)) {
        plan.handOver.push({ to: by, path, record })
      } else {
        left = withBackend(left, path, record)
      }
    }

    const ask = asker(project, at, options.exec)
    const change = await at.adapter.removeModule(at.dir, {
      root: project.root,
      record: {
        modules: entry.modules.filter((held) => !staying.includes(held)),
        patches: entry.patches.filter((patch) => !stays(patch)),
      },
      ...(ask ? { ask } : {}),
    })
    absorb(plan, change)
    plan.parts.push(backendPlan(project, at, change))
    if (!change.record) continue
    // What the backend itself holds on to goes with what was handed over:
    // it is held by a module that stays, and comes out when that one does.
    const heir = plan.handOver.find((handed) => handed.path === path)
    if (heir) {
      heir.record = mergeBackend(heir.record, change.record)
    } else {
      left = withBackend(left, path, change.record)
    }
  }
  keep(left)
  return plan
}

/**
 * Everything a plan leaves to the user: first the commands for a backend
 * that is elsewhere, then what no tool could do and the setup a module needs.
 */
export function leftToDo(plan: ModulePlan): string[] {
  return [...plan.parts.flatMap(elsewhereLines), ...plan.after]
}

/** True when carrying a plan out changes or runs something. */
export function changesSomething(plan: ModulePlan): boolean {
  return plan.parts.some((part) => part.steps.length > 0)
}

/** A plan as the lines a person reads before it is carried out. */
export function planLines(plan: ModulePlan): string[] {
  const verb = plan.action === 'add' ? 'Add' : 'Remove'
  const lines = [`${verb} ${plan.module.name} (${plan.package})`]
  for (const part of plan.parts) {
    if (part.steps.length === 0 && !part.elsewhere) continue
    lines.push(`  ${part.path}/`)
    for (const step of part.steps) {
      lines.push(
        `    ${step.type === 'run' ? 'run ' : 'edit'}  ${step.display}`
      )
    }
    lines.push(...elsewhereLines(part).map((line) => `    ${line}`))
  }
  return lines
}

/** A plan's steps as data, for `--json`. */
export function planData(plan: ModulePlan) {
  return plan.parts.flatMap((part) => [
    ...part.steps.map((step) =>
      step.type === 'run'
        ? { part: part.path, run: step.display }
        : { part: part.path, edit: step.display }
    ),
    ...(part.elsewhere
      ? [{ part: part.path, elsewhere: part.elsewhere.lines }]
      : []),
  ])
}

/** The steps taken and not taken by the other modules of a run, as labels. */
export interface Around {
  done: string[]
  pending: string[]
}

/** The labels of the steps of a plan, as a failure lists them. */
export function stepLabels(plan: ModulePlan): string[] {
  return plan.parts.flatMap((part) =>
    part.steps.map((step) => `${part.path}/: ${step.display}`)
  )
}

/**
 * Puts the record of a plan into the project's config file. The file is
 * read again first, so what was written to it since the command started is
 * kept, and the result is left on `project` for whatever is planned next.
 */
async function writeRecord(
  plan: ModulePlan,
  project: Project,
  handOver: boolean
): Promise<void> {
  const config = await loadProjectConfig(project.root)
  let modules = (config.modules ?? []).filter(
    (entry) => entry.name !== plan.module.name
  )
  if (plan.record) modules = [...modules, plan.record]
  for (const { to, path, record } of handOver ? plan.handOver : []) {
    modules = modules.map((entry) =>
      entry.name === to
        ? { ...entry, backend: withBackend(entry.backend, path, record) }
        : entry
    )
  }
  const rest: ProjectConfig = { ...config }
  delete rest.modules
  project.config = modules.length > 0 ? { ...rest, modules } : rest
  await writeProjectConfig(project.root, project.config)
}

/**
 * Carries out one plan and keeps the project's record in step. The first
 * step that fails stops everything: its output is shown, with what had been
 * done by then and what had not.
 *
 * A plan is carried out as soon as it is made, and the plan of the next
 * module is made after it, from the project as this one left it.
 *
 * The record is true after a failure as well. An add that stops part way
 * records the steps it took, so a second run finishes the job and a remove
 * undoes what was done. A remove that stops keeps its record whole, and a
 * second run finds what is already gone.
 */
export async function carryOut(
  plan: ModulePlan,
  project: Project,
  context: CliContext,
  output: Output,
  around: Around = { done: [], pending: [] }
): Promise<void> {
  const steps = plan.parts.flatMap((part) =>
    part.steps.map((step) => ({
      step,
      path: part.path,
      label: `${part.path}/: ${step.display}`,
    }))
  )
  const list = (title: string, labels: string[]) =>
    labels.length > 0 ? [title, ...labels.map((label) => `  ${label}`)] : []

  const fail = async (
    at: (typeof steps)[number],
    headline: string,
    exitCode: number,
    shown: string
  ): Promise<never> => {
    const taken = steps.filter(({ step }) => step.done)
    if (plan.action === 'add' && taken.length > 0) {
      await plan.settle?.()
      await writeRecord(plan, project, false)
    }
    const finished = [...around.done, ...taken.map(({ label }) => label)]
    const pending = [
      ...steps.filter(({ step }) => !step.done).map(({ label }) => label),
      ...around.pending,
    ]
    throw new DrxError(
      'step-failed',
      [
        headline,
        shown,
        ...list('Done:', finished),
        ...list('Not done:', pending),
      ]
        .filter((line) => line !== '')
        .join('\n'),
      {
        failed: {
          part: at.path,
          step: at.step.display,
          exitCode,
          output: shown,
        },
        done: finished,
        notDone: pending,
      }
    )
  }

  for (const at of steps) {
    const { step, path, label } = at
    if (step.type === 'edit') {
      let source: string
      let content: string
      try {
        source = await readFile(step.file, 'utf8')
        content = step.change(source)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        await fail(at, `${step.display} failed in ${path}/.`, 1, reason)
        return
      }
      if (content !== source) await writeFile(step.file, content)
      output.did(label)
    } else {
      output.note(label)
      const result = await context.exec(step.command, step.args, {
        cwd: step.cwd,
      })
      if (result.code !== 0) {
        await fail(
          at,
          `${step.display} failed in ${path}/ with exit code ${result.code}.`,
          result.code,
          result.output.trimEnd()
        )
      }
    }
    step.done = true
  }

  await plan.settle?.()
  await writeRecord(plan, project, true)
}
