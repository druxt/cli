# Contributing

Thanks for helping.

## Getting set up

```bash
npm install
```

That installs dependencies and enables the git hooks. If you skipped install
scripts, run `npm run hooks:install` by hand, or the hooks stay on disk doing
nothing.

The toolchain is pinned in `.mise.toml`. With [mise](https://mise.jdx.dev)
installed, `mise install` gives you the same Node the pipeline uses.

To run the CLI from your checkout:

```bash
npm run build
node packages/cli/dist/bin.js --help
```

## Before you push

```bash
npm run lint        # every check except prose, which needs Vale installed
npm run typecheck
npm test            # vitest, with the coverage floor enforced
```

The pre-commit hook runs all three. Because the unit tests serve their own
fixture registry and tarball from a loopback port, they run offline. `npm run test:e2e` is the
one test that downloads the real starter, and it is not in the hook.

## Tests

Write the test before the code it covers, and see it fail. A change to a
command needs a test that runs the command through `runCli`, as
`packages/cli/test/helpers/run.ts` does.

`vitest.config.ts` carries a coverage floor measured from the current tests.
Raise it when coverage improves. Do not lower it to make a change pass.

## Adding a starter

Add `starters/<name>.json` and the name to `starters/index.json`. The format is
in the README. Set `maintained` to the date you last saw the starter work, and
run `npm run test:e2e` if the default starter changed.

## Adding a kind

Add a file to `packages/cli/src/adapters/` that exports a `KindAdapter`, and
add it to the list in `packages/cli/src/adapters/index.ts`. Nothing outside
that directory should need to change.

## Changesets

A change that a user of `@druxt/cli` or `create-druxt` would notice needs a
changeset. Run `npm run changeset`, pick the packages and the bump, and write
one or two plain sentences about the change. Commit the file it writes in
`.changeset/` with your change.

The release turns the changesets into each package's `CHANGELOG.md`, so do not
edit those files by hand. The first line of a changeset becomes the entry:

- A Conventional Commits prefix is dropped. An issue in its scope, as in
  `fix(#12):`, is linked, and a `!` marks the entry as a breaking change.
- A leading verb is put in the past tense, so "add" reads "Added".
- `#12` in the sentence links the issue.
- The commit that added the changeset is linked. A line reading
  `Commit: <sha>` in the body names a different one.

The rest of the changeset follows as a paragraph of its own.

## Releases

Releases are cut from `0.x` by `.github/workflows/release.yml`. Merging the
pull request it keeps open, titled `chore(release): version packages`, is the
release. `RELEASING.md` has the whole process and its one-time setup.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org). The commit-msg
hook checks them, and the pipeline checks the whole merge-request range.

This repository squash-merges, so the pull request or merge request **title**
becomes the commit subject. Title your pull request the same way you would
title a commit.

## What not to put in a file

This repository is public. Nothing that only resolves on a private network may
reach a tracked file, whether as a URL, in a comment or in the starter
registry. `npm run lint:private` checks this and runs in the pipeline. When you
need to cite something internal, describe it without the URL or point at a
public equivalent.
