import { wrappingEngine } from './engine.js'

/** Lando runs a tool through its tooling: `lando composer`, `lando drush`. */
export const landoEngine = wrappingEngine('lando')
