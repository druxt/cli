#!/usr/bin/env node
import { launch } from './launch.js'

process.exitCode = await launch(
  process.versions.node,
  process.argv.slice(2),
  process.stderr
)
