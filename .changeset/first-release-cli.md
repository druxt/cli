---
'@druxt/cli': minor
---

First release of the Druxt command-line tool, with the binary `drx`.

- `drx init` creates a site from a starter in a registry, records its layout and parts in `drx.config.json` and prints what the site needs next. `--engine` chooses how the backend runs, from the engines the starter lists or `none` for a backend that exists already. `init` keeps that engine's files only and warns when its commands are not on `PATH`.
- `drx module list`, `drx module search` and `drx module info` read the Druxt module registry, and in a project show what is installed and whether each module's range admits the Druxt there.
- `drx info` prints the versions of the CLI, Node and the packages of each part of a project.
- At a terminal, bare `drx` opens a menu and `drx init` is a guided run that asks before it writes. `--no-interactive`, `DRX_NO_INTERACTIVE=1`, `CI` or no terminal turn every prompt off.
- The registry holds one starter, `quickstart`, and the `monorepo` layout is the one available.
