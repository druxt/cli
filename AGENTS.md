# Agent instructions

The Druxt command-line tool: `@druxt/cli`, with the binary `drx`, and `create-druxt`.

## Rules

- **This repository is public.** Nothing that resolves only on a private
  network may reach a tracked file: no internal URLs, hostnames, repository
  names or issue links, in any file including comments and the starter
  registry. `npm run lint:private` enforces the URL-shaped half of this and
  runs in the pipeline. It cannot catch an internal name written as prose, so
  that part is on you.
- **Check a library's API in its own package before using it.** The unjs
  libraries change between minors.
- **Conventional Commits**, and the same for pull request and merge request
  titles. This repository squash-merges, so the title becomes the commit
  subject, and a prose title breaks the next push to the target branch.
- **No AI tool is credited.** No co-author trailer naming an assistant, no
  generated-with footer, no session link, in commits, merge request
  descriptions or tracked files. The commit-msg hook rejects it locally, and
  `npm run lint:attribution` and the pipeline check the rest.
- **Prose is linted with Vale.** It covers the markdown a change touches, its
  commit messages and the merge request description.
  `npm run lint:prose:install` once, then `npm run lint:prose`.
- **A change a user of a package would notice carries a changeset**
  (`npm run changeset`). Do not write a package's `CHANGELOG.md` by hand: the
  release writes it from `.changeset/`, through `.changeset/changelog.cjs`.
- **Nothing here publishes to npm.** There is no publish job in either
  pipeline. Do not add one that would run without a token.

## Layout

| Path                     | Purpose                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| `packages/cli/`          | `@druxt/cli`. The manifest only: there are no sources yet          |
| `packages/create-druxt/` | `create-druxt`. The manifest only: there are no sources yet        |
| `.changeset/`            | Pending release notes, and the generator that writes the changelog |
| `scripts/`               | Repository tooling, excluded from the packages                     |
| `test/`                  | Tests of the repository tooling                                    |
| `.githooks/`             | Committed hooks, enabled by `npm install`                          |
| `.gitlab/scripts/`       | Content checks, copied from the Druxt repository standard          |

## Commands

```bash
npm install          # dependencies, and enables the git hooks
npm run typecheck    # tests and configuration
npm test             # vitest, coverage reported, no network
npm run lint         # every linter except prose
npm run lint:prose   # Vale, after `npm run lint:prose:install`
```

## Toolchain

Pinned in `.mise.toml`. The packages will be TypeScript, built with `tsc` and
no bundler, as ES modules. `c12` stays on 3 while 4 is a release candidate, and
`typescript` stays on 6 until `typescript-eslint` supports 7. Renovate is
configured not to offer either. `markdown-it`, which the changelog generator
reads a changeset with, stays on 14: from 15 it no longer takes
`www.example.org` for a URL, and an issue number in one would be linked.
