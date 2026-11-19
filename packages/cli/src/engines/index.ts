import { ddevEngine } from './ddev.js'
import type { EngineAdapter } from './engine.js'
import { landoEngine } from './lando.js'
import { noEngine } from './none.js'
import { phpEngine } from './php.js'

export type { EngineAdapter, EngineCommand } from './engine.js'

/** Every engine this version can run tools through. */
const ENGINES: readonly EngineAdapter[] = [
  phpEngine,
  ddevEngine,
  landoEngine,
  noEngine,
]

export function engineFor(name: string): EngineAdapter | undefined {
  return ENGINES.find((engine) => engine.name === name)
}

export function knownEngines(): string[] {
  return ENGINES.map((engine) => engine.name)
}
