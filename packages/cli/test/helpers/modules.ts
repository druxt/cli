/** A module registry in the published shape, small enough to read. */
export function moduleRegistry(): {
  schemaVersion: number
  modules: Record<string, unknown>[]
} {
  return {
    schemaVersion: 1,
    modules: [
      {
        name: 'auth',
        repo: 'druxt/druxt-auth',
        category: 'authentication',
        status: 'stable',
        icon: 'auth.svg',
        drupal: [
          {
            name: 'simple_oauth',
            label: 'Simple OAuth',
            url: 'https://www.drupal.org/project/simple_oauth',
          },
        ],
        type: 'official',
        archived: false,
        description: 'Authentication module for DruxtJS',
        npm: 'druxt-auth',
        compatibility: { druxt: 'unknown' },
        website: 'https://github.com/druxt/druxt-auth',
      },
      {
        name: 'blocks',
        repo: 'druxt/druxt.js',
        path: 'packages/blocks',
        category: 'site-and-layout',
        status: 'stable',
        drupal: [{ name: 'block', label: 'Block', core: true }],
        type: 'official',
        archived: false,
        description: 'Drupal Blocks, Block Regions and more',
        npm: 'druxt-blocks',
        compatibility: { druxt: '^0.25.1' },
        website: 'https://druxtjs.org/modules/blocks',
      },
      {
        name: 'ckeditor',
        repo: 'druxt-contrib/druxt-ckeditor',
        category: 'authoring-and-preview',
        status: 'unreleased',
        drupal: [{ name: 'ckeditor5', label: 'CKEditor 5', core: true }],
        type: 'contrib',
        archived: false,
        description: 'Render CKEditor content with components',
        compatibility: { druxt: 'unknown' },
      },
      {
        name: 'legacy',
        repo: 'druxt-contrib/druxt-legacy',
        category: 'site-and-layout',
        status: 'stable',
        type: 'contrib',
        archived: true,
        description: 'An archived module with no stated range',
        npm: 'druxt-legacy',
      },
      {
        name: 'node-preview',
        repo: 'druxt-contrib/druxt-node-preview',
        category: 'authoring-and-preview',
        status: 'stable',
        drupal: [
          { name: 'jsonapi_node_preview', label: 'JSON:API Node Preview' },
        ],
        type: 'contrib',
        archived: false,
        description: 'Preview unsaved content in the frontend',
        npm: '@druxt-contrib/node-preview',
        compatibility: { druxt: '>=0.26.0 <1' },
      },
    ],
  }
}

/** The fixture registry with one change made to one module. */
export function moduleRegistryWith(
  index: number,
  change: (module: Record<string, unknown>) => void
) {
  const registry = moduleRegistry()
  change(registry.modules[index] as Record<string, unknown>)
  return registry
}
