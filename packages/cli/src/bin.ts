#!/usr/bin/env node
import { homedir } from 'node:os'
import { launchProcess } from './launch.js'

// The commands are named, not imported: their libraries do not load on an old Node.
process.exitCode = await launchProcess(
  process,
  homedir(),
  new URL('./cli.js', import.meta.url).href,
  'runCli'
)
