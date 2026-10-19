import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, openSync, closeSync, lstatSync } from 'node:fs'
import { dirname } from 'node:path'
import { fail } from './protocol.mjs'
export function privateDatabase (filename) {
  if (filename !== ':memory:') {
    mkdirSync(dirname(filename), { recursive: true, mode: 0o700 })
    if (!existsSync(filename)) closeSync(openSync(filename, 'wx', 0o600))
    if (!lstatSync(filename).isFile() || lstatSync(filename).isSymbolicLink()) fail('invalid_database')
  }
  return new DatabaseSync(filename, { timeout: 1000 })
}
