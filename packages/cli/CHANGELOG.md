# @druxt/cli

## 0.1.0

### Minor Changes

- First release of the Druxt command-line tool, with the binary `drx`. ([`0fc706f`](https://github.com/druxt/cli/commit/0fc706f09ce6e09b06dc881cd432163eb44a0957))

  - `drx init` creates a site from a starter in a registry, records its layout and parts in `drx.config.json` and prints what the site needs next.
  - `drx info` prints the versions of the CLI, Node and the packages of each part of a project.
  - The registry holds one starter, `quickstart`, and the `monorepo` layout is the one available.
