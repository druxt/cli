# Releasing

`@druxt/cli` and `create-druxt` publish to npm from `.github/workflows/release.yml`. Nobody runs `npm publish` by hand after the first version. The workflow stays off until the [one-time setup](#one-time-setup) is done.

| Channel     | npm dist-tag | When it publishes                                          | What it is for                        |
| ----------- | ------------ | ---------------------------------------------------------- | ------------------------------------- |
| Development | `dev`        | A push to a release branch that changes a changeset        | Trying unreleased work on a real site |
| Stable      | `latest`     | When you merge the pull request that versions the packages | Everyone else                         |

A release branch is named for its major, such as `0.x` or `1.x`. The workflow matches them by pattern, so a branch cut on demand releases too. Set `baseBranch` in `.changeset/config.json` to the branch your releases come from.

Each package has a version of its own. A changeset names the packages it releases, and a package no changeset names is not published. `create-druxt` depends on `@druxt/cli`, so a release of the CLI brings a patch release of `create-druxt` with it.

## Development releases

A push to a release branch that adds or changes a changeset cuts a snapshot of each package the pending changesets release, and publishes it under the `dev` tag:

```bash
npx @druxt/cli@dev init my-site
```

A snapshot version reads `0.1.0-dev.20261030024907`: the version the pending changesets add up to, then the tag and a timestamp. Nothing is committed, no git tag is made, and `latest` does not move. A changeset that releases nothing, such as an empty one, cuts no snapshot.

## Stable releases

1. Merge pull requests that carry a changeset. Add one with `npm run changeset`.
2. The workflow opens a pull request titled `chore(release): version packages`, and keeps it up to date. It holds the version bumps, each package's changelog entry and the lock file that matches them.
3. Merge that pull request when the release is ready. This is the release decision.
4. The push that follows waits for a reviewer to approve the `release` environment, then publishes each new version to `latest`. It also creates a tag such as `@druxt/cli@0.1.0` for each, with a GitHub Release whose notes are that version's entry in the package's `CHANGELOG.md`.

A release from an older major's branch publishes under its own tag: `1.9.1`, cut on `1.x` after `2.0.0`, goes to `latest-1`. GitHub does not mark its Release as the latest one. A prerelease publishes under `next`. The tag is chosen when the version is packed, and `latest` is checked against npm again after the approval, in case another release line published a higher version while the run waited.

A few seconds pass between that check and the publish. If two release lines publish inside them, `latest` can end on the older major. Nothing is lost. Run `npm dist-tag add @druxt/cli@2.0.0 latest` for each package to point the tag back at the newer version. Release branches are not put in one queue to close this, because a release that waits in a shared queue can be cancelled by the next one.

A version counts as released once npm has it and its GitHub Release exists. If a run fails between the two, or after one package and before the other, rerun it: it skips what is published and creates what is missing.

## Build and publish jobs

| Job                | Runs repository code                                                                                                                 | Can write to the repository             | Can publish to npm |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | ------------------ |
| `snapshot`, `pack` | Yes, install scripts included                                                                                                        | No                                      | No                 |
| `version`          | The `release:version` script and the changelog generator, as the release branch has them. Dependencies are installed without scripts | Yes, to open the version pull request   | No                 |
| `dev`, `release`   | No, they check out nothing                                                                                                           | `release` creates the tags and Releases | Yes                |

The build jobs end by packing the tarballs, and the publish jobs hand those tarballs to npm. A pull request rehearses the `snapshot` job only, so code in a pull request never runs with publishing rights. A fork's own pushes skip the workflow.

## The pre-publish gate

`npm run release:check` runs before every publish, on both channels and over both packages. It refuses a release when:

- a dependency uses a specifier that only resolves on the author's machine, such as `link:` or `workspace:`
- the version is at or below the highest one npm already has for its major
- an entry in `files` was not built

## The changelogs

The pull request that versions the packages is written by `npm run release:version`. It applies the pending changesets and writes `packages/cli/CHANGELOG.md` and `packages/create-druxt/CHANGELOG.md` through `.changeset/changelog.cjs`. It then brings `package-lock.json` up to date with the new versions. `CONTRIBUTING.md` says how a changeset reads as an entry.

## One-time setup

Publishing uses npm trusted publishing, so there is no npm token to store or rotate. Until the setup is complete the workflow stops after packing: the tarballs it would have published are attached to the run as an artifact, and nothing reaches npm.

1. Publish the first version of each package by hand, from a clean build of the merged version pull request: `npm publish --workspaces --access public`. A package that does not exist on npm yet cannot name a trusted publisher.
2. On the npm website, open each package, then **Settings**, then **Trusted publisher**. Choose GitHub Actions, and enter the organization, the repository and the workflow filename `release.yml`. Leave the environment empty, because the `dev` job publishes without one. Under **Allowed actions**, tick **Allow npm publish**: the workflow publishes directly, and a publisher limited to staged publishing refuses it.
3. Under the repository's **Settings**, then **Environments**, create the `release` environment and add yourself, or the people who cut releases, as required reviewers. Without a rule the environment still works, but nothing pauses before a stable publish.
4. Create a GitHub App with read and write access to **Contents** and **Pull requests**, and install it on the repository. Store its ID as the repository variable `RELEASE_APP_ID` and its private key as the secret `RELEASE_APP_PRIVATE_KEY`. GitHub doesn't run checks on a pull request opened with the workflow's own token, so a protected branch would never see them pass. Without the app, tick **Allow GitHub Actions to create and approve pull requests** under **Settings**, **Actions**, **General**, or the workflow cannot open its pull request at all.
5. Set the repository variable `NPM_PUBLISH` to `true`.
