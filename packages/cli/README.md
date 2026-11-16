# @druxt/cli

> The command-line tool for [Druxt](https://druxtjs.org), the fully decoupled Drupal and Nuxt framework.

```bash
npx @druxt/cli init my-site
npx @druxt/cli info
```

The binary is `drx`. Install the package in a project to use that name: `npm install -D @druxt/cli`, then `drx <command>` in a package script. `npx drx` without the package installed downloads another package that holds the name on npm.

| Command                             | What it does                                                              |
| ----------------------------------- | ------------------------------------------------------------------------- |
| `drx init [dir]`                    | Creates a site from a starter and records its layout in `drx.config.json` |
| `drx info`                          | Prints the versions of the CLI, Node and the packages of each part        |
| `drx module list`, `search`, `info` | Lists, searches and shows the modules in the Druxt module registry        |

The options, the registry format and the configuration files are in the [repository README](https://github.com/druxt/cli#readme).

## Licence

[MIT](LICENSE)
