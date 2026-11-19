import type { KindAdapter } from './adapter.js'
import { drupalAdapter } from './drupal.js'
import { nuxtAdapter } from './nuxt.js'

export type { KindAdapter, PackageVersion } from './adapter.js'

/** Every kind this version knows. A new kind is a new file and a line here. */
const ADAPTERS: readonly KindAdapter[] = [nuxtAdapter, drupalAdapter]

export function adapterFor(kind: string): KindAdapter | undefined {
  return ADAPTERS.find((adapter) => adapter.kind === kind)
}

export function knownKinds(): string[] {
  return ADAPTERS.map((adapter) => adapter.kind)
}
