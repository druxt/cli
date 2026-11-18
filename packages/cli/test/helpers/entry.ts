/** A registry entry that passes validation, for tests to break one field of. */
export function validEntry(): Record<string, unknown> {
  return {
    name: 'quickstart',
    tar: 'https://example.com/quickstart.tar.gz',
    defaultDir: 'my-druxt-site',
    url: 'https://example.com/quickstart',
    druxt: {
      line: '0.x',
      layout: 'monorepo',
      parts: [
        { role: 'frontend', kind: 'nuxt', path: 'nuxt' },
        { role: 'backend', kind: 'drupal', path: 'drupal' },
      ],
      requires: { node: '16.18.1', tools: ['DDEV'] },
      maintained: '2026-11-01',
      default: true,
      steps: ['npm run setup', 'npm run dev'],
    },
  }
}

/** A deep copy of the valid entry with one dotted path set to a value. */
export function entryWith(path: string, value: unknown) {
  const entry = structuredClone(validEntry())
  const keys = path.split('.')
  let target = entry as Record<string, unknown>
  for (const key of keys.slice(0, -1)) {
    target = target[key] as Record<string, unknown>
  }
  const last = keys.at(-1) as string
  if (value === undefined) delete target[last]
  else target[last] = value
  return entry
}
