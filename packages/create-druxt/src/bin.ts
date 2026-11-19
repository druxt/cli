#!/usr/bin/env node
import { homedir } from 'node:os'
import { launchProcess } from '@druxt/cli/launch'

// The command is named, not imported: @druxt/cli does not load on an old Node.
process.exitCode = await launchProcess(
  process,
  homedir(),
  new URL('./index.js', import.meta.url).href,
  'createDruxt'
)
