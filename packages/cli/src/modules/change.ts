import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { adapterFor, type KindAdapter } from '../adapters/index.js'
import type { Ask, BackendRecord, ModuleChange } from '../adapters/adapter.js'
import type { CliContext } from '../context.js'
import { engineFor } from '../engines/index.js'
import { DrxError } from '../errors.js'
import type { RunTool } from '../exec.js'
import type { Output } from '../output.js'
import type { Part } from '../parts.js'
import {
  writeProjectConfig,
  type ModuleRecord,
  type ProjectConfig,
} from '../project.js'
import { compatibility } from './compatibility.js'
import type { ModuleEntry } from './entry.js'

/** One thing to do to the project, as it will be shown and done. */
export type PlannedStep =
  | {
      type: 'run'
      command: string
      args: string[]
      cwd: string
      display: string
    }
  | { type: 'edit'; file: string; content: string; display: string }

/** The steps for one part, or what to do where a backend that is elsewhere is. */
export interface PartPlan {
  path: string
  steps: PlannedStep[]
  /** Why the steps cannot be taken from here, and the lines to run instead. */
  elsewhere?: { reason: string; lines: string[] }
  record?: BackendRecord
  /** Asks the part what the steps did, once they have run. */
  settle?: () => Promise<BackendRecord>
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
   * Brings `record` in line with what the steps did, once they have run.
   * A plan is made before anything is changed, and a part may do more than
   * it was asked to.
   */
  settle?: () => Promise<void>
}

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
  let backend = old.backend
  for (const { path, ...record } of now.backend) {
    backend = withBackend(backend, path, record)
  }
  return { name: now.name, package: now.package, frontend, backend }
}

const pluralPatches = (count: number) =>
  `${count} patch${count === 1 ? '' : 'es'}`

/** The steps of a frontend part, which are run in it as they are. */
function frontendPlan(at: Located, change: ModuleChange): PartPlan {
  return {
    path: at.part.path,
    steps: change.steps.map((step): PlannedStep =>
      'run' in step
        ? {
            type: 'run',
            command: step.run.tool,
            args: step.run.args,
            cwd: at.dir,
            display: [step.run.tool, ...step.run.args].join(' '),
          }
        : {
            type: 'edit',
            file: join(at.dir, step.edit.file),
            content: step.edit.content,
            display: step.edit.summary,
          }
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
    steps: change.steps.map((step): PlannedStep => {
      if ('edit' in step) {
        return {
          type: 'edit',
          file: join(at.dir, step.edit.file),
          content: step.edit.content,
          display: step.edit.summary,
        }
      }
      const line = engine.run(part, step.run.tool, step.run.args)
      return {
        type: 'run',
        command: line.command,
        args: line.args,
        cwd: join(project.root, line.cwd),
        display: [line.command, ...line.args].join(' '),
      }
    }),
    ...(change.record ? { record: change.record } : {}),
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

  const record: ModuleRecord = {
    name: module.name,
    package: module.npm,
    frontend: [],
    backend: [],
  }
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
      package: module.npm,
      needs: [],
      patches: options.patches,
      registryStatesCore: options.registryStatesCore,
    })
    absorb(plan, change)
    plan.parts.push(frontendPlan(at, change))
    if (change.did) {
      record.frontend?.push({ path: at.part.path, ...change.did })
    }
  }

  const backend: { path: string; part: PartPlan }[] = []
  for (const at of located(project, 'backend')) {
    const needs = module.backend.filter((need) => need.kind === at.part.kind)
    if (needs.length === 0) continue
    const ask = asker(project, at, options.exec)
    const change = await at.adapter.addModule(at.dir, {
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

  // A module added before keeps what that add did: this one found it there.
  const before = project.config.modules?.find(
    (entry) => entry.name === module.name
  )
  const build = (): ModuleRecord => {
    const now: ModuleRecord = {
      ...record,
      backend: backend.flatMap(({ path, part }) =>
        part.record && hasAny(part.record) ? [{ path, ...part.record }] : []
      ),
    }
    return before ? mergeRecords(before, now) : now
  }
  plan.record = build()
  plan.settle = async () => {
    for (const { part } of backend) {
      if (part.settle) part.record = await part.settle()
    }
    plan.record = build()
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

/**
 * Carries out the plans in order and keeps the project's record in step.
 * The first tool that fails stops everything: its output is shown, with what
 * had been done by then and what had not.
 */
export async function carryOut(
  plans: ModulePlan[],
  project: Project,
  context: CliContext,
  output: Output
): Promise<void> {
  const all = plans.flatMap((plan) =>
    plan.parts.flatMap((part) =>
      part.steps.map((step) => ({
        step,
        label: `${part.path}/: ${step.display}`,
        path: part.path,
      }))
    )
  )
  let done = 0
  let config = project.config

  for (const plan of plans) {
    for (const part of plan.parts) {
      for (const step of part.steps) {
        if (step.type === 'edit') {
          await mkdir(dirname(step.file), { recursive: true })
          await writeFile(step.file, step.content)
          output.did(`${part.path}/: ${step.display}`)
        } else {
          output.note(`${part.path}/: ${step.display}`)
          const result = await context.exec(step.command, step.args, {
            cwd: step.cwd,
          })
          if (result.code !== 0) {
            const list = (title: string, labels: string[]) =>
              labels.length > 0
                ? [title, ...labels.map((label) => `  ${label}`)]
                : []
            const finished = all.slice(0, done).map(({ label }) => label)
            const pending = all.slice(done).map(({ label }) => label)
            const shown = result.output.trimEnd()
            throw new DrxError(
              'step-failed',
              [
                `${step.display} failed in ${part.path}/ with exit code ${result.code}.`,
                shown,
                ...list('Done:', finished),
                ...list('Not done:', pending),
              ]
                .filter((line) => line !== '')
                .join('\n'),
              {
                failed: {
                  part: part.path,
                  step: step.display,
                  exitCode: result.code,
                  output: shown,
                },
                done: finished,
                notDone: pending,
              }
            )
          }
        }
        done += 1
      }
    }

    // The record is written once the module is wholly done, so a remove
    // never undoes something an add did not finish.
    await plan.settle?.()
    let modules = (config.modules ?? []).filter(
      (entry) => entry.name !== plan.module.name
    )
    if (plan.record) modules = [...modules, plan.record]
    for (const { to, path, record } of plan.handOver) {
      modules = modules.map((entry) =>
        entry.name === to
          ? { ...entry, backend: withBackend(entry.backend, path, record) }
          : entry
      )
    }
    const rest: ProjectConfig = { ...config }
    delete rest.modules
    config = modules.length > 0 ? { ...rest, modules } : rest
    await writeProjectConfig(project.root, config)
  }
}
