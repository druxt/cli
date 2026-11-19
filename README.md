<!-- vale off -->
<!-- The alt text describes what the banner shows: the @druxt/cli mark, name and description. The name-colon-description form trips ColonUsage. -->
<a href="https://druxtjs.org">
  <img src="https://raw.githubusercontent.com/druxt/cli/0.x/.github/banner.svg" alt="@druxt/cli: Command-line tool for Druxt">
</a>
<!-- vale on -->

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

## Node

`drx` runs on Node 22.12 or later. A site may pin an older Node for itself, as the 0.x starter pins Node 16, and a version manager then switches to it in the site's directory. `drx` still works there: started on an older Node, it runs the same command again on a newer Node from the machine. It looks beside its own binary first, which is the Node it was installed with, then along `PATH`, then where mise, nvm, fnm, Volta and asdf keep their installs.

The tools a command starts, such as the site's package manager, come from your own `PATH`, so the site is installed with the Node it runs on. When the Node you are on is too old, `DRX_NODE` chooses the newer one: set it to the path of a `node` binary. A Node that is new enough is used as it is, whatever `DRX_NODE` says.

## Commands

### `drx init [dir]`

Creates a site from a starter in a registry, writes `drx.config.json` at its root, and prints what the site needs and what to run next.

| Option                      | What it does                                                                                                | Default                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `[dir]`                     | The directory to create the site in                                                                         | Asked for, or the starter's default with `--yes`            |
| `--starter <name>`          | The starter to create the site from                                                                         | The registry's default                                      |
| `--layout <layout>`         | `monorepo`, `split` or `workspace`. Only `monorepo` is available.                                           | The starter's layout                                        |
| `--registry <url>`          | A starter registry: a URL, or a name from the user configuration                                            | The public registry                                         |
| `--source <name>`           | Where the Druxt packages come from. Only `npm` is available.                                                | `npm`                                                       |
| `--engine <name>`           | The engine that runs the backend: one of the starter's engines, or `none` for a backend that exists already | Asked for, or the first engine whose commands are installed |
| `--database <name>`         | The database, where the engine offers a choice                                                              | Asked for, or the engine's first                            |
| `--base-url <url>`          | With `--engine none`: the URL of the backend                                                                | Asked for                                                   |
| `--keep-engines`            | Keep the files of the engines that were not chosen                                                          | Remove them                                                 |
| `--setup`                   | Run the engine's steps after creating the site. Not available yet.                                          |                                                             |
| `--install`, `--no-install` | Install the site's dependencies after creating it, or do not                                                | Asked for, or no                                            |
| `--force`                   | Write into a directory that exists and is not empty                                                         | Refuse                                                      |
| `--yes`, `-y`               | Accept the default for everything not given, and ask nothing                                                |                                                             |
| `--json`                    | Print the result as JSON on stdout                                                                          |                                                             |

At a terminal, `init` asks for the directory, the starter when the registry has more than one, the layout, the engine and its database when the starter gives a choice, and whether to install. A flag answers each question, so the command runs unattended:

```bash
npx @druxt/cli init my-site --yes --json
```

With no terminal, `init` uses the defaults and never waits for input. It needs the directory or `--yes`, and fails with a message saying so when it has neither.

#### Engines

An engine is a way to run the site's backend on your machine. The starter lists the ones it supports, and `none` is always there for a backend that runs somewhere else. For the `quickstart` starter:

| Engine  | Needs on `PATH`   | Database  | What it is                                                     |
| ------- | ----------------- | --------- | -------------------------------------------------------------- |
| `php`   | `php`, `composer` | `sqlite`  | PHP's built-in server and SQLite, with no containers           |
| `ddev`  | `ddev`            | `mariadb` | [DDEV](https://ddev.readthedocs.io)                            |
| `lando` | `lando`           | `mariadb` | [Lando](https://lando.dev)                                     |
| `none`  |                   |           | A Drupal that exists already, at the URL you give `--base-url` |

- The prompt lists the engines whose commands are installed first, and marks the others as not installed. You can still choose one of those. `init` then warns which commands are missing, and creates the site.
- With `--yes` or no terminal, the engine is the first whose commands are all installed, or the starter's first when none is.
- `init` removes the files of the engines you did not choose, so a DDEV site has no `.lando.yml`. `--keep-engines` leaves them all.
- **`--force` into a project that exists.** `--force` writes the starter's files into a directory that holds files, and a file the starter also has is replaced by the starter's. It deletes nothing. The files of the engines you did not choose stay, since any of them may be your own. `init` warns with their paths. Commit or copy the project first.
- For an engine that serves the backend at a fixed URL, and for `none`, `init` writes the URL where the starter reads it. For the quickstart that is `BASE_URL` in `.env`.
- What the site needs and the steps to run next are the chosen engine's.
- An engine or a database the starter does not offer fails, with the names it does offer.

```bash
npx @druxt/cli init my-site --engine ddev
npx @druxt/cli init my-site --engine none --base-url https://cms.example.com
```

`--install` runs the install of the package manager the starter declares. For the `quickstart` starter that is `npm install`, which also sets up the Drupal backend when PHP and Composer are present. The steps printed under "Next" then leave out what the install ran, so nothing is set up twice.

### `drx info`

Prints the versions of the CLI and Node. Inside a project it adds the layout and, for each part, the packages that matter: `nuxt` and every `druxt`, `druxt-*` or `@druxt/*` package for a Nuxt part, and Drupal core and the Druxt module for a Drupal part. Run it from any directory in the project.

| Option   | What it does                       |
| -------- | ---------------------------------- |
| `--json` | Print the report as JSON on stdout |

Outside a project it says so and prints the two versions.

### `drx module list`

Lists the modules in the Druxt module registry: name, package, type, status and the Druxt versions each works with.

```text
Name    Package       Type      Status  Druxt
auth    druxt-auth    official  stable  unknown
blocks  druxt-blocks  official  stable  ^0.25.1
```

Inside a project it adds two columns for the frontend part:

| Column       | What it shows                                                                                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Installed`  | The installed version, `declared` when `package.json` asks for the package and it is not installed, or `no`                                                 |
| `Compatible` | `yes` or `no` when the module's range can be compared with the part's Druxt version, and `unknown` when the module states no range or the part has no Druxt |

The Druxt version compared is the one installed in the part, or the range the part asks for when none is installed. A module whose range is `unknown` or not stated is shown as `unknown`, never as compatible.

| Option                    | What it does                                                    |
| ------------------------- | --------------------------------------------------------------- |
| `--all`                   | Include archived modules                                        |
| `--type <type>`           | Only modules of this type, such as `official` or `contrib`      |
| `--category <category>`   | Only modules in this category                                   |
| `--module-registry <url>` | A module registry: a URL, or a name from the user configuration |
| `--refresh`               | Read the registry again even when the cached copy is fresh      |
| `--json`                  | Print the result as JSON on stdout                              |

### `drx module search <text>`

The same table, for the modules whose name, package name or description contains the text. Case is ignored. It takes the options of `drx module list`.

### `drx module info <name>`

Shows one module, found by its registry name or its package name: the package, type, status, category, Druxt range, repository and website, and the backend modules it needs, with the ones that are part of Drupal core marked. When the registry marks no module as core, the text says so and `core` is `null` in the JSON. It is `false` only in a registry that marks the modules that are core. Inside a project it adds the installed version and the compatibility. It takes `--module-registry`, `--refresh` and `--json`.

A name that matches nothing exits with 1 and prints the closest names.

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
    {
      "role": "backend",
      "kind": "drupal",
      "path": "drupal",
      "engine": "ddev",
      "database": "mariadb"
    }
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

A backend part also records the `engine` chosen at `init`, its `database` where the engine has one, and for the `none` engine the `baseUrl` of the backend. A file written before engines existed has none of the three and still reads. `drx info` prints them.

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
      "tools": ["PHP 8.3 or newer with Composer, or DDEV, or Lando"]
    },
    "maintained": "2026-11-15",
    "default": true,
    "steps": ["npm run setup", "npm run dev"],
    "backendUrl": {
      "file": ".env",
      "template": ".env.example",
      "variable": "BASE_URL"
    },
    "engines": [
      {
        "name": "ddev",
        "label": "DDEV",
        "commands": ["ddev"],
        "databases": ["mariadb"],
        "baseUrl": "http://quickstart-druxtsite.ddev.site",
        "steps": [
          "npm run setup",
          { "run": "ddev start", "dir": "drupal" },
          { "run": "ddev drupal-install", "dir": "drupal" },
          { "run": "ddev druxt-add-consumer", "dir": "drupal" },
          "npm run dev"
        ],
        "notes": [
          "ddev druxt-add-consumer prints OAUTH_CLIENT_ID. Copy it into .env before npm run dev."
        ],
        "files": ["drupal/.ddev"]
      }
    ],
    "install": {
      "runs": ["npm run setup"],
      "notes": ["npm run dev starts the backend again when it is not running."]
    }
  }
}
```

`name`, `tar`, `defaultDir`, `url`, `subdir` and `headers` are giget's fields. giget ignores the `druxt` object, so the same file works with `GIGET_REGISTRY=<url> npx giget quickstart`.

| Key in `druxt`      | What it holds                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `line`              | The Druxt release line                                                                                              |
| `layout`            | The layout the starter has                                                                                          |
| `parts`             | The parts of the starter, as in the project configuration                                                           |
| `requires.node`     | The Node version the site runs on: a full version, or a major such as `22`                                          |
| `requires.tools`    | What else the site needs, each as a phrase to show the user                                                         |
| `requires.commands` | Superseded by `engines`. Still read from an entry that has no `engines`                                             |
| `maintained`        | The date the starter was last checked to work, as `YYYY-MM-DD`                                                      |
| `default`           | `true` for the starter `init` uses when none is named                                                               |
| `steps`             | Optional. The commands to run in the new site, in order, when no engine is chosen and for the `none` engine         |
| `engines`           | Optional. The ways the backend can be run, described below                                                          |
| `backendUrl`        | Optional. The `file` and `variable` the starter reads its backend URL from, and a `template` to start the file from |
| `install.runs`      | Optional. The steps the install runs itself, left out of "Next" after one, from an engine's steps too               |
| `install.notes`     | Optional. Lines printed under "Note" after an install                                                               |

`index.json` is `{ "revision": 2, "starters": ["quickstart"] }`. The revision is a whole number that goes up whenever the entries gain something a version of `drx` depends on. A `drx` whose bundled copy has a higher revision than the default registry reads the bundled copy, so a build made ahead of what is published keeps working.

An entry in `engines` has:

| Key         | What it holds                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------ |
| `name`      | The name `--engine` takes. Lower case. `none` is taken                                                             |
| `label`     | What the prompt shows, and what `init` prints under "It needs"                                                     |
| `commands`  | The commands the engine needs on `PATH`, as bare names                                                             |
| `databases` | Optional. The databases it can be set up with, the default first                                                   |
| `steps`     | What to run in the new site, in order. A step is a command, or `{ "run", "dir" }` for a command run in a directory |
| `notes`     | Optional. What to do by hand, printed after the steps                                                              |
| `files`     | Optional. Paths in the starter that the engine needs, relative to its root                                         |
| `baseUrl`   | Optional. The URL the engine serves the backend at, when it is fixed                                               |

`init` removes the `files` of the engines that were not chosen. A path that two engines list is kept when either is chosen, and a directory that holds a kept path loses the rest of its contents. An absolute path, or one that leaves the starter, is refused when the entry is read, and again before anything is removed, which also stops a link in the starter from leading outside the site.

`init` looks each of the chosen engine's commands up on `PATH` without running it. On Windows it tries the extensions in `PATHEXT`. When one is missing it prints one warning and still creates the site:

```text
Warning: The ddev engine needs ddev. Not found on PATH: ddev. Install what is missing before you set up the site.
```

With `--json` the result has `engine`, `database`, `baseUrl`, `removed`, `notes` and a `commands` object with `satisfied`, `alternatives`, `found` and `missing`.

`requires.commands`, a list of alternatives such as `[["php", "composer"], ["ddev"]]`, is what an entry used before `engines`. It is read only from an entry with no `engines`, and warns when no alternative is complete.

`init` checks an entry before it downloads anything, and fails with a message naming the field that is wrong. It warns when the starter was last maintained more than a year ago, and when the running Node is not the one the starter needs.

The package includes a copy of the public registry. When the public registry cannot be read, `init` uses the copy and says so. A registry you name with `--registry` is never replaced by the copy.

## The module registry

The module commands read `https://cdn.jsdelivr.net/gh/druxt/modules@main/modules.json`, which the [druxt/modules](https://github.com/druxt/modules) repository publishes. The CLI reads `schemaVersion` 1. It refuses any other version with a message saying so, and ignores fields it has no use for.

The names in an entry become arguments of a package manager or a backend tool, so each is checked as the registry is read. A package name has to be one npm takes, and the name of a Drupal module has to be a machine name. Anything else, such as a name that starts with a hyphen, makes the registry invalid, and the message names the entry and the field.

The registry is cached on disk:

- A copy under an hour old is used without a request. `--refresh` reads the registry anyway.
- An older copy is replaced by a new read.
- When the registry cannot be read, the copy is used whatever its age, and the command says so and how old it is.
- With no copy and no registry, the command fails.

The copy is kept in `~/.cache/drx`, or under `XDG_CACHE_HOME` when that is set. `DRX_CACHE_DIR` names another directory.

## The user configuration

`~/.config/drx/config.json` names starter registries, module registries and sources of your own. `DRX_CONFIG` points at another file, and `XDG_CONFIG_HOME` is used when it is set.

```json
{
  "registries": {
    "team": "https://example.com/starters"
  },
  "moduleRegistries": {
    "team": "https://example.com/modules.json"
  },
  "sources": {
    "next": { "type": "npm", "tag": "next" },
    "branch": { "type": "git", "url": "https://example.com/druxt.git", "ref": "main" }
  }
}
```

- `--registry team` reads starters from that URL. `GIGET_AUTH` is giget's own variable, and giget sends it as a bearer token with every tarball it downloads. The CLI also sends it to a registry you name, and never to the public registry.
- `--module-registry team` reads modules from that URL, with `GIGET_AUTH` sent to it in the same way.
- `--source` takes `npm`, `git:<url>#<ref>`, or a name defined here. Only `npm` creates a site in this version. The others are read and answer that they are not available yet.

## Not there yet

- The `split` and `workspace` layouts. `--layout` accepts them and fails with a message.
- Sources other than `npm`.
- `drx module add`, `drx module remove` and `drx module configure`. The commands exist and fail with a message.
- Making a wrapper component and upgrading a site.
- Kinds other than `nuxt` and `drupal`.
- `init --setup`, which would run the engine's steps. The flag exists and fails with a message, and `init` prints the steps.
- A database other than the one each quickstart engine is set up for. `--database` records the choice and does not change a file.
- A version check of the commands an engine needs. `init` checks that `php` is on `PATH`, not that it is 8.3 or newer.
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
