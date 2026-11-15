import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { defineCommand } from 'citty'
import { adapterFor, type PackageVersion } from '../adapters/index.js'
import { assertKnownOptions } from '../args.js'
import type { CliContext } from '../context.js'
import { columns, createOutput } from '../output.js'
import { cliVersion } from '../package-root.js'
import type { Part } from '../parts.js'
import {
  CONFIG_FILE,
  findProjectRoot,
  loadProjectConfig,
  type ProjectConfig,
} from '../project.js'

interface PartReport extends Part {
  /** False when the part's directory is not there. */
  exists: boolean
  /** True when the adapter for its kind recognises the directory. */
  detected: boolean
  packages: PackageVersion[]
}

interface InfoReport {
  cli: { name: string; version: string }
  node: string
  project:
    | (Omit<ProjectConfig, 'parts'> & {
        root: string
        parts: PartReport[]
      })
    | null
}

async function reportPart(root: string, part: Part): Promise<PartReport> {
  const dir = join(root, part.path)
  const adapter = adapterFor(part.kind)
  const exists = existsSync(dir)
  const detected = exists && adapter ? await adapter.detect(dir) : false
  return {
    ...part,
    exists,
    detected,
    packages: detected && adapter ? await adapter.packages(dir) : [],
  }
}

function partLines(part: PartReport): string[] {
  const heading = `${part.role}  ${part.kind}  ${part.path}/`
  if (!adapterFor(part.kind)) {
    return [heading, `  This version has no adapter for the ${part.kind} kind.`]
  }
  if (!part.exists) return [heading, '  The directory does not exist.']
  if (!part.detected) {
    return [heading, `  The directory does not look like a ${part.kind} part.`]
  }
  if (part.packages.length === 0) {
    return [heading, '  No packages to report.']
  }
  const rows = part.packages.map((entry) => [
    entry.name,
    entry.range ?? '',
    entry.installed ? `installed ${entry.installed}` : 'not installed',
  ])
  return [heading, ...columns(rows, '  ')]
}

function text(report: InfoReport, cwd: string): string {
  const lines = columns([
    ['drx', report.cli.version],
    ['Node', report.node],
  ])
  lines.push('')
  const project = report.project
  if (!project) {
    lines.push(
      `Not inside a Druxt project: no ${CONFIG_FILE} in ${cwd} or above it.`
    )
    return lines.join('\n')
  }
  lines.push(
    ...columns([
      ['Project', project.root],
      ['Layout', project.layout],
      ['Line', project.line],
      ['Starter', project.starter],
      ['Source', project.source],
    ])
  )
  for (const part of project.parts) {
    lines.push('', ...partLines(part))
  }
  return lines.join('\n')
}

const args = {
  json: {
    type: 'boolean',
    description: 'Print the report as JSON on stdout',
  },
} as const

export function infoCommand(context: CliContext) {
  return defineCommand({
    meta: {
      name: 'info',
      description:
        'Print the versions of the CLI, Node and the packages of each part of the project',
    },
    args,
    async run({ args: parsed, rawArgs }) {
      assertKnownOptions(rawArgs, args, 'info')
      const output = createOutput(context, parsed.json === true)

      const report: InfoReport = {
        cli: { name: '@druxt/cli', version: cliVersion() },
        node: context.nodeVersion,
        project: null,
      }
      const root = findProjectRoot(context.cwd)
      if (root) {
        const config = await loadProjectConfig(root)
        const parts: PartReport[] = []
        for (const part of config.parts) {
          parts.push(await reportPart(root, part))
        }
        report.project = { root, ...config, parts }
      }
      output.result(report, text(report, context.cwd))
    },
  })
}
