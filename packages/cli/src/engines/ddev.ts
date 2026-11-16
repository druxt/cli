import { wrappingEngine } from './engine.js'

/** DDEV runs a tool in its web container: `ddev composer`, `ddev drush`. */
export const ddevEngine = wrappingEngine('ddev')
