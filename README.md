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
| `--no-banner`               | Do not draw the wordmark at the start of a guided run                                                       | Draw it                                                     |
| `--install`, `--no-install` | Install the site's dependencies after creating it, or do not                                                | Asked for, or no                                            |
| `--force`                   | Write into a directory that exists and is not empty                                                         | Refuse                                                      |
| `--yes`, `-y`               | Accept the default for everything not given, and ask nothing                                                |                                                             |
| `--json`                    | Print the result as JSON on stdout                                                                          |                                                             |

At a terminal, `init` is a guided run. It asks for whatever the flags left out, then shows a summary and waits for a yes before it writes. See [At a terminal](#at-a-terminal). A flag answers each question, so the command runs unattended:

```bash
npx @druxt/cli init my-site --yes --json
```

With no terminal, `init` uses the defaults and never waits for input. It needs the directory or `--yes`, and fails with a message saying so when it has neither. The message names what kept it from asking: no terminal, `--json`, or the flag or variable that turned the questions off. See [CI and scripts](#ci-and-scripts).

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
- **`--force` into a project that exists.** `--force` writes the starter's files into a directory that holds files, and a file the starter also has is replaced by the starter's. It deletes nothing. The files of the engines you did not choose stay, since any of them may be your own. `init` warns with their paths, and a guided run says so in its summary before it asks. Commit or copy the project first.
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

An option of a `drx module` command goes before or after the command's name: `drx module --json list` is `drx module list --json`.

### `drx module search <text>`

The same table, for the modules whose name, package name or description contains the text. Case is ignored. It takes the options of `drx module list`.

### `drx add <module...>`

Adds one or more modules to the project, by registry name or package name. `drx module add` is the same command.

```bash
npx @druxt/cli add breadcrumb
npx @druxt/cli add breadcrumb --dry-run
```

For each module it does two things:

- **Frontend.** It installs the package with the package manager of the part's lock file, and adds the package to the `modules` array of `nuxt.config`. The rest of the file stays as you wrote it. When the config is a function, or its `modules` is not an array written out in the file, the package is installed, the file is left alone and the line to add is printed.
- **Backend.** For each Drupal module the entry lists, a contributed one is required with Composer and enabled with Drush, and a core one is only enabled. The commands run through the part's engine: `ddev composer`, `lando drush`, or `composer` and `vendor/bin/drush` for the `php` engine.

It first asks the backend which modules are enabled, with `drush pm:list`, and leaves one that is enabled as it is. A dry run asks too, since asking changes nothing. Once the steps have run it asks again, because Drupal enables the modules a module depends on along with it, and those go on the record as enabled by `add` too. A package that `package.json` or `composer.json` already has is not installed again, and a module the config already lists is not listed twice. What `add` did, and what it found in place, goes on the [record](#the-project-configuration).

| Option                                           | What it does                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `--dry-run`                                      | Print every step, with each command line and what is left to you, and change nothing |
| `--force`                                        | Add a module that is archived, or whose range does not admit the Druxt in the part   |
| `--no-patches`                                   | Leave out the patches the module needs, with a warning naming each                   |
| `--yes`, `-y`                                    | Ask nothing                                                                          |
| `--module-registry <url>`, `--refresh`, `--json` | As for `drx module list`                                                             |

What it refuses, before it takes any step:

- An archived module, and one whose Druxt range excludes the Druxt in the frontend part. `--force` adds either. A module whose range is `unknown` is added with a warning.
- A module with no package, which is not released. `--force` does not change that.
- A Drupal module it cannot place as core or contributed. See below.
- A patch whose URL is not `https`. Composer does not fetch a patch over `http`, so `add` refuses, naming the patch and the module, before it writes anything. `--no-patches` adds the module without it.

**Where the backend is not run from here.** With the `none` engine, or in a project that does not record an engine, the frontend is done and the Composer and Drush lines are printed under "Left to do", for you to run where the backend is. `add` cannot look in such a backend. Where the registry does not say whether a module is part of core, the `composer require` line names it, and a note says that a core module needs the enable line only.

**Patches.** A Drupal module in the registry may list patches. `add` shows each with its issue and writes it to `extra.patches` in the site's `composer.json`. It then runs `composer patches-relock`, and `composer patches-repatch` when the patched package is installed already, whether the site requires it or another package brought it in. When the site lacks `cweagans/composer-patches`, it allows the plugin and requires it. A patch is skipped when the installed package is at or past the version that has the fix, and when the site already has the same patch.

**Setup.** Steps a module needs done by hand, such as creating a consumer, are printed under "Left to do". They are not run.

**When a tool fails.** The run stops there. The tool's output is printed, then what was done and what was not. Nothing is recorded for that module. With `--json` the error has the code `step-failed`, and next to the message a `failed` object with the `part`, the `step`, its `exitCode` and its `output`, and the `done` and `notDone` steps as arrays.

**Core or contributed.** The registry marks a core module with `core: true`, and a registry that marks any module is taken to mark them all. Against a registry that marks none, which is the published one today, `add` looks in the core the site has installed, under `web/core/modules`, and treats a package the site already requires as contributed. With no core installed it refuses that module and says to install the backend's dependencies first, since the CLI does not keep a list of core modules to guess from. A backend that is not run from here is the exception, described above.

At a terminal with no name, `drx add` lists the modules to pick from, shows the steps and asks before it changes anything.

### `drx remove <module...>`

Undoes what `drx add` did for a module, and nothing else. `drx module remove` is the same command. It takes `--dry-run`, `--yes`, `--module-registry`, `--refresh` and `--json`.

It works from the record in `drx.config.json`:

- The package is uninstalled when `add` installed it, and taken out of the `modules` array when `add` listed it. A package or an entry the site had before stays, with a line saying so. The rest of the config file stays as you wrote it.
- A module with no record is refused, and the exit code is 1: `add` did nothing for it, so there is nothing to undo. That goes for a module the project does not have, and for one you installed yourself.
- A record written by an earlier version does not say who installed the package. `remove` then leaves the frontend alone and prints the lines that take it out.

The backend is left alone unless `--backend` is given. With it, `remove` undoes the rest of the record:

- It uninstalls the Drupal modules `add` enabled. A module that was enabled before `add` ran is not uninstalled.
- It takes out the Composer requirements `add` added, and the patches it wrote. A package that another package still requires only leaves `composer.json`. A package that loses a patch and stays installed is reinstalled without it.
- A package stays required while a module in it is still enabled, so no enabled module loses its files. `remove` names the module.
- Before it uninstalls a module it asks Drupal what else that would uninstall, with `drush pm:uninstall <module> --simulate`. Drupal uninstalls the modules that depend on one along with it. So a module that another enabled module depends on stays, with its requirement and its patches, and `remove` names what depends on it.
- When Drupal cannot be asked, nothing is uninstalled and the command is printed under "Left to do".
- A Drupal module that another Druxt module in the project needs stays. It moves to the record of that module when it has one, along with anything Drupal holds on to because of it, so removing that module takes it all out.

Whatever stays in place stays on the record, so a later `drx remove <module> --backend` can finish the job.

### `drx module`

With no command, at a terminal: a list of the modules that narrows as you type. Pick one and it is shown as `drx module info` shows it. Anywhere else it fails and names the commands.

### `drx module info <name>`

Shows one module, found by its registry name or its package name: the package, type, status, category, Druxt range, repository and website, and the backend modules it needs, with the ones that are part of Drupal core marked. When the registry marks no module as core, the text says so and `core` is `null` in the JSON. It is `false` only in a registry that marks the modules that are core. Inside a project it adds the installed version and the compatibility. It takes `--module-registry`, `--refresh` and `--json`.

A name that matches nothing exits with 1 and prints the closest names.

### `drx --help`, `drx <command> --help`, `drx --version`

Usage for the CLI or one command, and the version.

### Output and exit codes

- The result of a command goes to stdout: text, or one JSON document with `--json`.
- Progress, warnings, errors and prompts go to stderr.
- A command that fails exits with 1. With `--json` it also prints `{ "ok": false, "error": { "code", "message" } }` on stdout.

## At a terminal

`drx` with no command opens a menu when a person is at the terminal. It names the project you are in, which it reads from `drx.config.json`. Below that are the actions for where you are:

- Outside a project: create a site.
- Inside one: list, search or show modules, and show the project. Add or remove modules. Configuring a module and managing patches are listed as not available yet.

Each entry runs the command it stands for, so the menu and the commands cannot differ.

`drx init` with values missing is a guided run:

1. It asks for the directory, the starter when the registry has more than one, the layout, the engine with its database or URL, and whether to install.
2. It lists what it will do, from the directory it will create to the files it will remove.
3. It asks before it writes. Answer no, or press Ctrl-C at any prompt, and nothing has been written. The exit code is 1.

Every run that asked for something ends with the command that repeats it, with each choice as a flag:

```text
Repeat this with: drx init my-site --starter quickstart --layout monorepo --engine ddev --database mariadb --no-install --yes
```

### The wordmark and the header

The Druxt wordmark is drawn in two places only: at the start of a guided `init`, and above the menu. Other commands that print a report start with one line, `druxt` and the version. Both go to stderr.

The wordmark is not drawn with `--json`, without a terminal, under `CI`, or in a terminal narrower than its 58 columns. To turn it off yourself:

- `--no-banner` on `drx` or `drx init`, for one run.
- `"banner": false` in the [user configuration](#the-user-configuration), for every run.

### Colour and marks

Blue is the backend and green is the frontend: the wordmark runs from one to the other, and a part is printed in the colour of its role wherever parts are listed. The role is always there in words too. Each line on stderr starts with a mark, and the marks differ in shape as well as colour. A running step has one, a finished step another, and a warning and a failure have their own. `Warning:` and `Error:` are spelled out beside them.

| Setting              | What it does                                                              |
| -------------------- | ------------------------------------------------------------------------- |
| `NO_COLOR=1`         | No colour anywhere. It wins over `FORCE_COLOR`                            |
| `FORCE_COLOR=1`      | Colour with no terminal. `2` is 256 colours and `3` is 24-bit, `0` is off |
| `--json`             | Plain text, without marks or the wordmark                                 |
| No terminal, or `CI` | Plain text, without marks or the wordmark                                 |

A terminal with 16 colours gets its own blue and green. One that cannot draw Unicode gets `*`, `+`, `!` and `x` for the marks.

## CI and scripts

The CLI never asks anything when nobody is there to answer. Each of these is enough:

| Condition              | How                                              |
| ---------------------- | ------------------------------------------------ |
| No terminal            | stdin or stderr is not a terminal                |
| `CI` is set            | Most CI services set it                          |
| `DRX_NO_INTERACTIVE=1` | For a script run from a terminal                 |
| `--no-interactive`     | The same, as a flag, before or after the command |
| `--json`               | The command prints JSON and asks nothing         |

Prompts, the menu, the wordmark and animation are then all off. A value with a default takes it, and a value with none fails with a message naming the flag to pass. Bare `drx` prints its usage. `--yes` accepts the defaults and can be combined with any of them. `init` needs it only when no directory is given.

A complete unattended `init`:

```bash
npx @druxt/cli init my-site \
  --starter quickstart \
  --layout monorepo \
  --engine ddev \
  --no-install \
  --no-interactive \
  --json > result.json
```

stdout is the JSON result and nothing else. stderr has one plain line per step.

| Exit code | Meaning                                    |
| --------- | ------------------------------------------ |
| `0`       | The command did what it was asked          |
| `1`       | It did not. The message on stderr says why |

With `--json`, a failure prints `{ "ok": false, "error": { "code", "message" } }` on stdout, and `code` says which kind it was: `usage`, `not-available`, `registry`, `invalid-entry`, `unknown-starter`, `unknown-source`, `unknown-module`, `directory-not-empty`, `config`, `download`, `install`, `refused`, `step-failed` or `cancelled`. `refused` is `drx add` or `drx remove` declining before it takes a step. `step-failed` is a tool failing part way through one of them, and its error has the fields described under [`drx add`](#drx-add-module).

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

`drx add` keeps a record under `modules`, one entry for each module it added, of what it did and what it found in place:

```json
{
  "name": "breadcrumb",
  "package": "druxt-breadcrumb",
  "frontend": [{ "path": "nuxt", "installed": true, "listed": true }],
  "backend": [
    {
      "path": "drupal",
      "modules": [
        {
          "name": "decoupled_router",
          "package": "drupal/decoupled_router",
          "enabled": true,
          "required": false
        }
      ],
      "patches": []
    }
  ]
}
```

| Key                  | What it holds                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `frontend.installed` | `true` when `add` installed the package, `false` when the part had it                                                           |
| `frontend.listed`    | `true` when `add` wrote the entry in the config, `false` when it was there                                                      |
| `modules.enabled`    | `true` when `add` enabled the Drupal module, or Drupal enabled it along with one `add` did. `false` when it was enabled already |
| `modules.required`   | `true` when `add` added the Composer requirement. A core module has no `package`                                                |
| `patches`            | Each patch `add` wrote: its `package`, `description` and `url`, and the `module` it was written for                             |

Adding a module again adds to its entry and takes nothing from it. `drx remove` undoes what the entry says and keeps an entry for whatever it leaves behind. An entry written by an earlier version, with no `frontend` and no `enabled` or `required`, still reads: its modules count as both enabled and required by `add`.

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

`index.json` is `{ "starters": ["quickstart"] }`.

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

`drx add` reads four optional fields of a Drupal module in an entry, and works without them:

| Field      | What it holds                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| `core`     | `true` for a module that is part of Drupal core                                                                           |
| `composer` | The `package`, and a `constraint`, when the package is not `drupal/<name>`                                                |
| `patches`  | Each a `description` and a `url`, with the `package` it applies to, its `issue` and the version it is fixed in as `until` |
| `setup`    | Steps to do by hand once the module is enabled, each with a `title` and optionally a `command` and a `url`                |

The copy is kept in `~/.cache/drx`, or under `XDG_CACHE_HOME` when that is set. `DRX_CACHE_DIR` names another directory.

## The user configuration

`~/.config/drx/config.json` names starter registries, module registries and sources of your own. `DRX_CONFIG` points at another file, and `XDG_CONFIG_HOME` is used when it is set.

```json
{
  "registries": {
    "team": "https://example.com/starters"
  },
  "banner": false,
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
- `"banner": false` stops the wordmark being drawn.
- `--source` takes `npm`, `git:<url>#<ref>`, or a name defined here. Only `npm` creates a site in this version. The others are read and answer that they are not available yet.

## Not there yet

- The `split` and `workspace` layouts. `--layout` accepts them and fails with a message.
- Sources other than `npm`.
- `drx module configure`. The command exists and fails with a message. `drx add` does not ask for a module's options.
- Commands to list, check and relock patches.
- Running a module's setup steps. They are printed.
- Adding to a Nuxt 4 site through Nuxt's own CLI. `drx add` edits `nuxt.config` itself, for Nuxt 2 and later alike.
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
