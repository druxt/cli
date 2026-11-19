# Changelog

Each package keeps its own changelog, written by [changesets](https://github.com/changesets/changesets)
when a release is cut:

- `@druxt/cli`: `packages/cli/CHANGELOG.md`
- `create-druxt`: `packages/create-druxt/CHANGELOG.md`

Changes that are merged and not yet released are the files in `.changeset/`.

Changes to the repository that are in no package, such as its pipelines, are recorded here.

## [Unreleased]

### Added

- The workspace, with `@druxt/cli` and `create-druxt`, on the Druxt repository standard: committed
  git hooks, linting, a GitLab pipeline and a GitHub Actions workflow, secret scanning with a
  detection canary, a private-host check, an attribution check and prose linting.
- The starter registry under `starters/`, with one entry, `quickstart`.
- A release workflow, which keeps a pull request open that versions the packages, and publishes
  them when it is merged. `RELEASING.md` describes it.
- A changelog generator, a check that runs before a publish, and CodeQL analysis.

[Unreleased]: https://github.com/druxt/cli/commits/0.x
