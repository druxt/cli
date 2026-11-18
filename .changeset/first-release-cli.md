---
'@druxt/cli': minor
---

First release of the Druxt command-line tool, with the binary `drx`.

- `drx init` creates a site from a starter in a registry, records its layout and parts in `drx.config.json` and prints what the site needs next. It warns when the commands the starter needs are not on `PATH`.
- `drx module list`, `drx module search` and `drx module info` read the Druxt module registry, and in a project show what is installed and whether each module's range admits the Druxt there.
- `drx info` prints the versions of the CLI, Node and the packages of each part of a project.
- The registry holds one starter, `quickstart`, and the `monorepo` layout is the one available.
