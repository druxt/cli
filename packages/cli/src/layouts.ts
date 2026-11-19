import { DrxError } from './errors.js'

/**
 * How the parts of a site are put together: one repository, a repository per
 * part, or a parent repository with each part as a submodule.
 */
export const LAYOUTS = ['monorepo', 'split', 'workspace'] as const
export type Layout = (typeof LAYOUTS)[number]

/** The layouts `init` can create. */
export const AVAILABLE_LAYOUTS: readonly Layout[] = ['monorepo']

export function isLayout(value: unknown): value is Layout {
  return LAYOUTS.includes(value as Layout)
}

export function assertLayoutAvailable(layout: Layout): void {
  if (!AVAILABLE_LAYOUTS.includes(layout)) {
    throw new DrxError(
      'not-available',
      `The ${layout} layout is not available yet. Use --layout ${AVAILABLE_LAYOUTS.join(' or ')}.`
    )
  }
}
