# Agent instructions

The Druxt command-line tool: `@druxt/cli`, with the binary `drx`, and `create-druxt`.

## Rules

- **This repository is public.** Nothing that resolves only on a private
  network may reach a tracked file: no internal URLs, hostnames, repository
  names or issue links, in any file including comments and the starter
  registry. `npm run lint:private` enforces the URL-shaped half of this and
  runs in the pipeline. It cannot catch an internal name written as prose, so
  that part is on you.
- **A private registry or source is never named in the code.** It belongs in
  the user configuration file, on the user's machine.
- **The names of kinds stay in `packages/cli/src/adapters/`.** A part has a
  role and a kind, and the kind is a value. No key, type or command outside
  that directory may be named after a kind. `packages/cli/test/seams.test.ts`
  fails when one is.
- **Every prompt has a flag,** and a command never waits for input when there
  is no terminal.
- **stdout is the result, stderr is everything else.** A command with `--json`
  prints one JSON document on stdout and nothing else there.
- **Check a library's API in its own package before using it.** The unjs
  libraries change between minors.
- **Conventional Commits**, and the same for pull request and merge request
  titles. This repository squash-merges, so the title becomes the commit
  subject, and a prose title breaks the next push to the target branch.
- **The coverage floor in `vitest.config.ts` goes up, never down.** If a change
  drops coverage, the change needs a test.
- **No AI tool is credited.** No co-author trailer naming an assistant, no
  generated-with footer, no session link, in commits, merge request
  descriptions or tracked files. The commit-msg hook rejects it locally, and
  `npm run lint:attribution` and the pipeline check the rest.
- **Prose is linted with Vale.** It covers the markdown a change touches, its
  commit messages and the merge request description.
  `npm run lint:prose:install` once, then `npm run lint:prose`.
- **Nothing here publishes to npm.** There is no publish job in either
  pipeline. Do not add one that would run without a token.

## Layout

| Path                         | Purpose                                                            |
| ---------------------------- | ------------------------------------------------------------------ |
| `packages/cli/`              | `@druxt/cli`. `src/commands/` holds a file per command             |
| `packages/cli/src/adapters/` | A file per kind of part, behind the interface in `adapter.ts`      |
| `packages/cli/src/registry/` | Reading and checking the starter registry                          |
| `packages/create-druxt/`     | `create-druxt`, which runs `drx init`                              |
| `starters/`                  | The public starter registry. The build copies it into `@druxt/cli` |
| `scripts/`                   | Repository tooling, excluded from the packages                     |
| `test/`                      | Tests of the repository tooling                                    |
| `.githooks/`                 | Committed hooks, enabled by `npm install`                          |
| `.gitlab/scripts/`           | Content checks, copied from the Druxt repository standard          |

## Commands

```bash
npm install          # dependencies, and enables the git hooks
npm run build        # tsc for both packages, and the registry copy
npm run typecheck    # sources, tests and configuration
npm test             # vitest, coverage floor enforced, no network
npm run test:e2e     # creates a site from the real starter, needs the network
npm run lint         # every linter except prose
npm run lint:prose   # Vale, after `npm run lint:prose:install`
```

## Toolchain

Pinned in `.mise.toml`. The packages are TypeScript, built with `tsc` and no
bundler, as ES modules. `c12` stays on 3 while 4 is a release candidate, and
`typescript` stays on 6 until `typescript-eslint` supports 7. Renovate is
configured not to offer either.
