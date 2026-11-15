# Druxt CLI

> The command-line tool for [Druxt](https://druxtjs.org), the fully decoupled Drupal and Nuxt framework.

This repository holds two packages:

| Package        | What it is                                                    |
| -------------- | ------------------------------------------------------------- |
| `@druxt/cli`   | The CLI. Its binary is `drx`.                                 |
| `create-druxt` | `npm create druxt`. It runs `drx init` and does nothing else. |

## Quickstart

```bash
npm create druxt@latest my-site
cd my-site
npx @druxt/cli info
```

You will need Node 22.12 or newer to run the CLI. The site it creates has its own requirements, which `drx init` prints.

## Running it

| You want to         | Run                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------- |
| Create a site       | `npm create druxt@latest [dir]`                                                              |
| Run any command     | `npx @druxt/cli <command>`                                                                   |
| Use it in a project | `npm install -D @druxt/cli`, then `drx <command>` in a package script or `npx drx <command>` |

`npx drx` does not work outside a project that has `@druxt/cli` installed. Another package holds the name `drx` on npm, so `npx drx` downloads that package and not this one. Use `npx @druxt/cli`.

## Commands

### `drx init [dir]`

Creates a site from a starter in a registry, writes `drx.config.json` at its root, and prints what the site needs and what to run next.

| Option                      | What it does                                                      | Default                                          |
| --------------------------- | ----------------------------------------------------------------- | ------------------------------------------------ |
| `[dir]`                     | The directory to create the site in                               | Asked for, or the starter's default with `--yes` |
| `--starter <name>`          | The starter to create the site from                               | The registry's default                           |
| `--layout <layout>`         | `monorepo`, `split` or `workspace`. Only `monorepo` is available. | The starter's layout                             |
| `--registry <url>`          | A starter registry: a URL, or a name from the user configuration  | The public registry                              |
| `--source <name>`           | Where the Druxt packages come from. Only `npm` is available.      | `npm`                                            |
| `--install`, `--no-install` | Install the site's dependencies after creating it, or do not      | Asked for, or no                                 |
| `--force`                   | Write into a directory that exists and is not empty               | Refuse                                           |
| `--yes`, `-y`               | Accept the default for everything not given, and ask nothing      |                                                  |
| `--json`                    | Print the result as JSON on stdout                                |                                                  |

At a terminal, `init` asks for the directory, the starter when the registry has more than one, the layout, and whether to install. A flag answers each question, so the command runs unattended:

```bash
npx @druxt/cli init my-site --yes --json
```

With no terminal, `init` uses the defaults and never waits for input. It needs the directory or `--yes`, and fails with a message saying so when it has neither.

`--install` runs the install of the package manager the starter declares. For the `quickstart` starter that is `npm install`, which also sets up the Drupal backend when PHP and Composer are present.

### `drx info`

Prints the versions of the CLI and Node. Inside a project it adds the layout and, for each part, the packages that matter: `nuxt` and every `druxt`, `druxt-*` or `@druxt/*` package for a Nuxt part, and Drupal core and the Druxt module for a Drupal part. Run it from any directory in the project.

| Option   | What it does                       |
| -------- | ---------------------------------- |
| `--json` | Print the report as JSON on stdout |

Outside a project it says so and prints the two versions.

### `drx --help`, `drx <command> --help`, `drx --version`

Usage for the CLI or one command, and the version.

### Output and exit codes

- The result of a command goes to stdout: text, or one JSON document with `--json`.
- Progress, warnings, errors and prompts go to stderr.
- A command that fails exits with 1. With `--json` it also prints `{ "ok": false, "error": { "code", "message" } }` on stdout.

## The project configuration

`drx init` writes `drx.config.json` at the root of the site. Later commands find the project by it.

```json
{
  "layout": "monorepo",
  "line": "0.x",
  "starter": "quickstart",
  "source": "npm",
  "parts": [
    { "role": "frontend", "kind": "nuxt", "path": "nuxt" },
    { "role": "backend", "kind": "drupal", "path": "drupal" }
  ]
}
```

| Key       | What it holds                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------- |
| `layout`  | The arrangement of the parts: `monorepo`, `split` or `workspace`                                     |
| `line`    | The Druxt release line                                                                               |
| `starter` | The name of the starter the site was created from                                                    |
| `source`  | The name of the source its Druxt packages come from                                                  |
| `parts`   | Each part of the site: its `role` (`frontend` or `backend`), its `kind` and its `path` from the root |

A kind is `nuxt` or `drupal` in this version.

## The starter registry

A registry is a URL that answers `/<name>.json` for each starter, in the format [giget](https://github.com/unjs/giget) defines, and `/index.json` with the names. The public registry is the [`starters/`](starters/) directory of this repository.

```json
{
  "name": "quickstart",
  "tar": "https://codeload.github.com/druxt/quickstart/tar.gz/refs/heads/develop",
  "defaultDir": "my-druxt-site",
  "url": "https://github.com/druxt/quickstart",
  "druxt": {
    "line": "0.x",
    "layout": "monorepo",
    "parts": [
      { "role": "frontend", "kind": "nuxt", "path": "nuxt" },
      { "role": "backend", "kind": "drupal", "path": "drupal" }
    ],
    "requires": {
      "node": "16.18.1",
      "tools": ["PHP 8.3 or newer with Composer, or DDEV"],
      "commands": [["php", "composer"], ["ddev"]]
    },
    "maintained": "2026-11-15",
    "default": true,
    "steps": ["npm run setup", "npm run dev"]
  }
}
```

`name`, `tar`, `defaultDir`, `url`, `subdir` and `headers` are giget's fields. giget ignores the `druxt` object, so the same file works with `npx giget --registry <url> quickstart`.

| Key in `druxt`      | What it holds                                                              |
| ------------------- | -------------------------------------------------------------------------- |
| `line`              | The Druxt release line                                                     |
| `layout`            | The layout the starter has                                                 |
| `parts`             | The parts of the starter, as in the project configuration                  |
| `requires.node`     | The Node version the site runs on: a full version, or a major such as `22` |
| `requires.tools`    | What else the site needs, each as a phrase to show the user                |
| `requires.commands` | Optional. The commands the site needs on `PATH`, as a list of alternatives |
| `maintained`        | The date the starter was last checked to work, as `YYYY-MM-DD`             |
| `default`           | `true` for the starter `init` uses when none is named                      |
| `steps`             | Optional. The commands to run in the new site, in order                    |

`index.json` is `{ "starters": ["quickstart"] }`.

`requires.commands` is a list of alternatives, and each alternative is a list of command names. The site can be set up when every command of one alternative is on `PATH`. `[["php", "composer"], ["ddev"]]` reads as `php` and `composer`, or `ddev`. A name is a bare command, and an entry with a path or arguments in one is rejected.

`init` looks each command up on `PATH` without running it. On Windows it tries the extensions in `PATHEXT`. When no alternative is complete it prints one warning naming the missing commands, and still creates the site:

```text
Warning: The quickstart starter needs php and composer, or ddev. Not found on PATH: php, composer, ddev. Install the commands of one alternative before you set up the site.
```

With `--json` the result has a `commands` object: `satisfied`, `alternatives`, `found` and `missing`. It is `null` for an entry with no `requires.commands`, which is not checked.

`init` checks an entry before it downloads anything, and fails with a message naming the field that is wrong. It warns when the starter was last maintained more than a year ago, and when the running Node is not the one the starter needs.

The package includes a copy of the public registry. When the public registry cannot be read, `init` uses the copy and says so. A registry you name with `--registry` is never replaced by the copy.

## The user configuration

`~/.config/drx/config.json` names registries and sources of your own. `DRX_CONFIG` points at another file, and `XDG_CONFIG_HOME` is used when it is set.

```json
{
  "registries": {
    "team": "https://example.com/starters"
  },
  "sources": {
    "next": { "type": "npm", "tag": "next" },
    "branch": { "type": "git", "url": "https://example.com/druxt.git", "ref": "main" }
  }
}
```

- `--registry team` reads starters from that URL. `GIGET_AUTH` is giget's own variable, and giget sends it as a bearer token with every tarball it downloads. The CLI also sends it to a registry you name, and never to the public registry.
- `--source` takes `npm`, `git:<url>#<ref>`, or a name defined here. Only `npm` creates a site in this version. The others are read and answer that they are not available yet.

## Not there yet

- The `split` and `workspace` layouts. `--layout` accepts them and fails with a message.
- Sources other than `npm`.
- Adding a module, making a wrapper component and upgrading a site.
- Kinds other than `nuxt` and `drupal`.
- A version check of the commands a starter needs. `init` checks that `php` is on `PATH`, not that it is 8.3 or newer.
- The same check in `drx info`. A project does not record what its starter requires, so `info` would have to read the registry again.
- A published public registry. Until this repository is public, `init` reads the copy in the package.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
npm install
npm run build
npm test
```

## Licence

[MIT](LICENSE)
