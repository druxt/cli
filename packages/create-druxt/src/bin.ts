#!/usr/bin/env node
import { createDruxt } from './index.js'

process.exitCode = await createDruxt(process.argv.slice(2))
