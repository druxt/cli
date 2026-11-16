import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { adapterFor, type KindAdapter } from '../adapters/index.js'
import type { BackendRecord, ModuleChange } from '../adapters/adapter.js'
import type { CliContext } from '../context.js'
import { engineFor } from '../engines/index.js'
import { DrxError } from '../errors.js'
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
  /** The record to keep, or to drop when it is undefined on a removal. */
  record?: ModuleRecord
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
  }

  const record: ModuleRecord = {
    name: module.name,
    package: module.npm,
    backend: [],
  }
  for (const at of located(project, 'backend')) {
    const needs = module.backend.filter((need) => need.kind === at.part.kind)
    if (needs.length === 0) continue
    const change = await at.adapter.addModule(at.dir, {
      needs,
      patches: options.patches,
      registryStatesCore: options.registryStatesCore,
    })
    const part = backendPlan(project, at, change)
    // What is left by hand: first the commands for a backend that is
    // elsewhere, then the setup the module needs wherever it runs.
    plan.after.push(...elsewhereLines(part))
    absorb(plan, change)
    plan.parts.push(part)
    const done = part.record
    if (done && done.modules.length + done.patches.length > 0) {
      record.backend.push({ path: at.part.path, ...done })
    }
  }
  plan.record = record
  return plan
}

/** True when the project has the package of a module in a frontend part. */
async function hasPackage(project: Project, name: string): Promise<boolean> {
  for (const at of located(project, 'frontend')) {
    if (await at.adapter.package(at.dir, name)) return true
  }
  return false
}

/** Everything taking one module out of the project takes. */
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
  }
  const recorded = project.config.modules?.find(
    (entry) => entry.name === module.name
  )
  const present = module.npm ? await hasPackage(project, module.npm) : false
  if (!present && !recorded) {
    plan.refusals.push({
      reason: `${module.npm ?? module.name} is not in this project.`,
      forceable: false,
    })
    return plan
  }

  for (const at of located(project, 'frontend')) {
    const change = await at.adapter.removeModule(at.dir, {
      ...(module.npm ? { package: module.npm } : {}),
      stillNeeded: [],
    })
    absorb(plan, change)
    plan.parts.push(frontendPlan(at, change))
  }

  const backend = recorded?.backend ?? []
  if (backend.length === 0) return plan
  if (!options.backend) {
    for (const entry of backend) {
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
    if (recorded) plan.record = recorded
    return plan
  }

  // A backend module stays while any other module in the project needs it.
  const stillNeeded = new Set<string>()
  for (const other of options.registry) {
    if (options.names.includes(other.name) || !other.npm) continue
    const kept =
      (await hasPackage(project, other.npm)) ||
      project.config.modules?.some((entry) => entry.name === other.name)
    if (kept) for (const need of other.backend) stillNeeded.add(need.name)
  }
  for (const at of located(project, 'backend')) {
    const entry = backend.find(({ path }) => path === at.part.path)
    if (!entry) continue
    const change = await at.adapter.removeModule(at.dir, {
      record: { modules: entry.modules, patches: entry.patches },
      stillNeeded: [...stillNeeded],
    })
    const part = backendPlan(project, at, change)
    plan.after.push(...elsewhereLines(part))
    absorb(plan, change)
    plan.parts.push(part)
  }
  return plan
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
            throw new DrxError(
              'step-failed',
              [
                `${step.display} failed in ${part.path}/ with exit code ${result.code}.`,
                result.output.trimEnd(),
                ...list(
                  'Done:',
                  all.slice(0, done).map(({ label }) => label)
                ),
                ...list(
                  'Not done:',
                  all.slice(done).map(({ label }) => label)
                ),
              ]
                .filter((line) => line !== '')
                .join('\n')
            )
          }
        }
        done += 1
      }
    }

    // The record is written once the module is wholly done, so a remove
    // never undoes something an add did not finish.
    const others = (config.modules ?? []).filter(
      (entry) => entry.name !== plan.module.name
    )
    const modules = plan.record ? [...others, plan.record] : others
    const rest: ProjectConfig = { ...config }
    delete rest.modules
    config = modules.length > 0 ? { ...rest, modules } : rest
    await writeProjectConfig(project.root, config)
  }
}
