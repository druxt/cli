/** Engines in the shape a registry entry gives them, for tests to change. */
export function validEngines(): Record<string, unknown>[] {
  return [
    {
      name: 'php',
      label: 'Local PHP with Composer',
      commands: ['php', 'composer'],
      databases: ['sqlite', 'mysql'],
      steps: ['npm run setup', 'npm run dev'],
      files: ['drupal/.devtools', 'drupal/Makefile'],
    },
    {
      name: 'ddev',
      label: 'DDEV',
      commands: ['ddev'],
      databases: ['mariadb'],
      baseUrl: 'http://fixture.ddev.site',
      steps: [
        'npm run setup',
        { run: 'ddev start', dir: 'drupal' },
        { run: 'ddev drupal-install', dir: 'drupal' },
        'npm run dev',
      ],
      notes: ['Copy the printed OAUTH_CLIENT_ID into .env.'],
      files: ['drupal/.ddev'],
    },
    {
      name: 'lando',
      label: 'Lando',
      commands: ['lando'],
      steps: [{ run: 'lando start', dir: 'drupal' }],
      files: ['drupal/.lando.yml', 'drupal/.ddev/commands'],
    },
  ]
}

/** The valid engines with one field of one engine set, or removed. */
export function enginesWith(index: number, key: string, value: unknown) {
  const engines = validEngines()
  const engine = engines[index] as Record<string, unknown>
  if (value === undefined) delete engine[key]
  else engine[key] = value
  return engines
}
