import { DrxError } from '../errors.js'
import { EXISTING_BACKEND } from '../registry/entry.js'
import type { EngineAdapter } from './engine.js'

/** A backend that runs somewhere else. Nothing can be run in it from here. */
export const noEngine: EngineAdapter = {
  name: EXISTING_BACKEND,
  run(_part, command, args) {
    throw new DrxError(
      'not-available',
      `The backend of this project is not on this machine, so ${command} cannot be run from here. Run "${[command, ...args].join(' ')}" where the backend is.`
    )
  },
}
