import { defineCommand, type ArgsDef, type CommandDef } from 'citty'
import { assertKnownOptions } from '../args.js'
import type { CliContext } from '../context.js'
import { DrxError } from '../errors.js'
import {
  carryOut,
  changesSomething,
  leftToDo,
  planAdd,
  planData,
  planLines,
  planRemove,
  stepLabels,
  type ChangeOptions,
  type ModulePlan,
  type Project,
} from '../modules/change.js'
import type { ModuleEntry } from '../modules/entry.js'
import type { LoadedModules } from '../modules/registry.js'
import { createOutput } from '../output.js'
import {
  CONFIG_FILE,
  findProjectRoot,
  loadProjectConfig,
  type ModuleRecord,
} from '../project.js'
import { repeatCommand } from '../repeat.js'
import { findModule, openModules, registryArgs } from './module.js'

type Action = 'add' | 'remove'

const WORDS = {
  add: { did: 'Added', example: 'drx add blocks' },
  remove: { did: 'Removed', example: 'drx remove blocks' },
} as const

const shared = {
  module: {
    type: 'positional',
    required: false,
    description: 'One or more modules, by registry name or package name',
  },
  'dry-run': {
    type: 'boolean',
    description: 'Print every step and change nothing',
  },
  yes: {
    type: 'boolean',
    alias: 'y',
    description: 'Ask nothing',
  },
  ...registryArgs,
} satisfies ArgsDef

const ARGS = {
  add: {
    ...shared,
    force: {
      type: 'boolean',
      description:
        'Add a module that is archived, or whose range does not admit the Druxt here',
    },
    patches: {
      type: 'boolean',
      default: true,
      description: 'Write the patches the module needs',
      negativeDescription: 'Leave the patches out, with a warning',
    },
  },
  remove: {
    ...shared,
    backend: {
      type: 'boolean',
      description: 'Also undo what drx add did to the backend',
    },
  },
} satisfies Record<Action, ArgsDef>

/**
 * A module as the project's record names it, for a remove of one the
 * registry no longer lists or cannot be asked about. The record holds
 * everything a remove acts on.
 */
const fromRecord = (record: ModuleRecord): ModuleEntry => ({
  name: record.name,
  npm: record.package,
  repo: '',
  category: '',
  status: '',
  type: '',
  archived: false,
  description: '',
  backend: [],
})

/** The modules that the picker offers for an action. */
function candidates(
  action: Action,
  modules: ModuleEntry[],
  project: Project
): ModuleEntry[] {
  const byName = (a: ModuleEntry, b: ModuleEntry) =>
    a.name.localeCompare(b.name)
  if (action === 'add') {
    return modules
      .filter((module) => !module.archived && module.npm)
      .sort(byName)
  }
  // What can be removed is what drx add recorded, in the registry or not.
  return (project.config.modules ?? [])
    .map(
      (record) =>
        modules.find((module) => module.name === record.name) ??
        fromRecord(record)
    )
    .sort(byName)
}

/**
 * `drx add` and `drx remove`: the same run for both, with the plan made by
 * the adapters of the project's parts and carried out here.
 */
function changeCommand(
  context: CliContext,
  action: Action,
  name: string
): CommandDef {
  const args: ArgsDef = ARGS[action]
  const words = WORDS[action]
  return defineCommand<ArgsDef>({
    meta: {
      name: action,
      description:
        action === 'add'
          ? 'Install a module, list it in the config and set up what it needs in the backend'
          : 'Take a module out of the config and uninstall it',
    },
    args,
    async run({ args: parsed, rawArgs }) {
      assertKnownOptions(rawArgs, args, name)
      const flags = parsed as Record<string, unknown>
      const dryRun = flags['dry-run'] === true
      const output = createOutput(context, flags.json === true)
      output.header()

      const root = findProjectRoot(context.cwd)
      if (!root) {
        throw new DrxError(
          'usage',
          `drx ${action} works inside a project, and there is no ${CONFIG_FILE} in ${context.cwd} or above it.`
        )
      }
      const project: Project = { root, config: await loadProjectConfig(root) }

      const canAsk = context.interactive && !output.json && flags.yes !== true
      let names = parsed._.map(String)
      if (names.length === 0 && !canAsk) {
        throw new DrxError(
          'usage',
          `Give the name of a module, as in "${words.example}".`
        )
      }

      // A remove undoes what the project's own record says. The registry
      // only adds what else in the project may need a backend module, so a
      // remove goes ahead without it.
      let loaded: LoadedModules | undefined
      try {
        loaded = await openModules(context, flags, output)
      } catch (error) {
        const unread = error instanceof DrxError && error.code === 'registry'
        if (action !== 'remove' || !unread) throw error
        output.warn(
          `${error.message} drx remove goes by the record in ${CONFIG_FILE}.`
        )
        if (flags.backend === true) {
          output.warn(
            'Without the module registry, drx remove cannot tell whether another module of the project needs what it takes out of the backend.'
          )
        }
      }
      const registry = loaded?.modules ?? []
      const options: ChangeOptions = {
        force: flags.force === true,
        patches: flags.patches !== false,
        backend: flags.backend === true,
        // A registry that marks any module as core is taken to mark them all.
        registryStatesCore: registry.some((module) =>
          module.backend.some((need) => need.core)
        ),
        registry,
        names: [],
        exec: context.exec,
      }

      const picked = names.length === 0
      if (picked) {
        const offered = candidates(action, registry, project)
        if (offered.length === 0) {
          throw new DrxError(
            'usage',
            `There is no module to ${action} in this project.`
          )
        }
        names = await context.prompter.pickMany({
          message: 'Which modules?',
          choices: offered.map((module) => ({
            value: module.name,
            label: module.name,
            hint: `${module.npm ?? 'not published'}. ${module.description}`.trim(),
          })),
        })
      }

      /** A module by name: in the registry, or for a remove on the record. */
      const named = (wanted: string): ModuleEntry => {
        try {
          return findModule(registry, wanted)
        } catch (error) {
          if (action !== 'remove') throw error
          const name = wanted.toLowerCase()
          const record = project.config.modules?.find(
            (entry) =>
              entry.name.toLowerCase() === name ||
              entry.package.toLowerCase() === name
          )
          if (record) return fromRecord(record)
          if (loaded) throw error
          throw new DrxError(
            'unknown-module',
            `drx add recorded no module named "${wanted}" in this project.`
          )
        }
      }
      const modules = names.map(named)
      options.names = modules.map((module) => module.name)
      const planFor = (module: ModuleEntry) =>
        action === 'add'
          ? planAdd(module, project, options)
          : planRemove(module, project, options)
      const refusalsOf = (plan: ModulePlan) =>
        plan.refusals
          .filter((refusal) => !(options.force && refusal.forceable))
          .map(
            (refusal) =>
              `Cannot ${action} ${plan.module.name}: ${refusal.reason}${refusal.forceable ? ` Pass --force to ${action} it all the same.` : ''}`
          )
      const plans: ModulePlan[] = []
      for (const module of modules) plans.push(await planFor(module))

      // Every refusal is found before any step is taken, so one module that
      // cannot be changed leaves the others as they were too.
      const refused = plans.flatMap(refusalsOf)
      if (refused.length > 0) throw new DrxError('refused', refused.join('\n'))

      for (const plan of plans) {
        for (const refusal of plan.refusals) output.warn(refusal.reason)
        for (const warning of plan.warnings) output.warn(warning)
        for (const note of plan.notes) output.line(note)
      }

      const shown = plans.flatMap((plan, index) => [
        ...(index > 0 ? [''] : []),
        ...planLines(plan),
      ])
      const data = () =>
        plans.map((plan) => ({
          name: plan.module.name,
          package: plan.package,
          steps: planData(plan),
          leftToDo: leftToDo(plan),
        }))

      if (dryRun) {
        // The lines for a backend elsewhere are in the plan above already.
        const byHand = plans.flatMap((plan) => plan.after)
        output.result(
          { ok: true, dryRun: true, modules: data() },
          [
            ...shown,
            ...(byHand.length > 0
              ? ['', 'Left to do:', ...byHand.map((line) => `  ${line}`)]
              : []),
            '',
            'Nothing was changed: this was a dry run.',
          ].join('\n')
        )
        return
      }

      if (picked) {
        output.line()
        for (const line of shown) output.line(line)
        output.line()
        const go = await context.prompter.confirm({
          message: 'Make these changes?',
          initial: true,
        })
        if (!go) {
          throw new DrxError('cancelled', 'Cancelled. Nothing was changed.')
        }
      }

      // The plans above were all made from the project as it was, to refuse
      // and to show before anything changed. A module after the first is
      // planned again once the one before it is done, from the project as
      // that one left it: its files, what is enabled and what is on record.
      const done: string[] = []
      for (const [index, module] of modules.entries()) {
        if (index > 0) {
          const again = await planFor(module)
          const stopped = refusalsOf(again)
          if (stopped.length > 0) {
            throw new DrxError('refused', stopped.join('\n'))
          }
          plans[index] = again
        }
        const plan = plans[index] as ModulePlan
        await carryOut(plan, project, context, output, {
          done,
          pending: plans.slice(index + 1).flatMap(stepLabels),
        })
        done.push(...stepLabels(plan))
      }

      const left = plans.flatMap(leftToDo)
      output.result(
        { ok: true, dryRun: false, modules: data() },
        [
          ...plans.map((plan) =>
            // A removal with no step found everything in place before it.
            action === 'remove' && !changesSomething(plan)
              ? `Nothing to remove for ${plan.module.name}: drx add found it in place.`
              : `${words.did} ${plan.module.name}.`
          ),
          ...(left.length > 0
            ? ['', 'Left to do:', ...left.map((line) => `  ${line}`)]
            : []),
        ].join('\n')
      )

      if (picked) {
        output.line()
        output.line(
          `Repeat this with: ${repeatCommand([
            action,
            ...options.names,
            ...(options.force ? ['--force'] : []),
            ...(options.patches ? [] : ['--no-patches']),
            ...(options.backend ? ['--backend'] : []),
            '--yes',
          ])}`
        )
      }
    },
  })
}

export const addCommand = (context: CliContext, name = 'add') =>
  changeCommand(context, 'add', name)

export const removeCommand = (context: CliContext, name = 'remove') =>
  changeCommand(context, 'remove', name)
